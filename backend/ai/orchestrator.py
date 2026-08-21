"""The agent loop and its SSE event stream.

One user turn drives: provider call -> tool_use -> run tools -> feed results
back -> repeat until the model stops asking for tools. Every tool invocation is
persisted so the finished conversation still shows what the answer was built
from.

**History is replayed as text only.** Tool calls are recorded for the UI but not
fed back into the next turn's context. That keeps history compact and always
wire-valid, and it means each turn re-reads the database — which is the correct
behaviour when the user edits their tree between questions.
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime
from typing import Any, AsyncIterator

from sqlalchemy.orm import Session

from ..database import ChatMessage, ChatThread, ChatToolCall
from . import config as ai_config
from .primer import build_system_blocks
from .provider import (
    ProviderError,
    TextDelta,
    TurnComplete,
    build_provider,
)
from .tools import REGISTRY, ToolContext
from .web_tools import WEB_REGISTRY, WEB_TOOL_NAMES

# Gathering evidence before answering costs rounds: a profile, its documents,
# the branch's notes and events is already four or five. Eight was tuned for a
# lookup-shaped question and truncated the research-shaped ones.
MAX_ITERATIONS = 14
DEFAULT_MAX_TOKENS = 16000
TITLE_MAX_CHARS = 60


def _sse(event: str, payload: dict[str, Any]) -> str:
    return f"data: {json.dumps({'type': event, **payload}, ensure_ascii=False)}\n\n"


def _history_for_provider(db: Session, thread_id: int) -> list[dict[str, Any]]:
    msgs = (
        db.query(ChatMessage)
        .filter(ChatMessage.thread_id == thread_id)
        .order_by(ChatMessage.id)
        .all()
    )
    out: list[dict[str, Any]] = []
    for m in msgs:
        if not (m.content or "").strip():
            continue
        out.append({"role": m.role, "content": m.content})
    return out


def derive_title(text: str) -> str:
    t = " ".join((text or "").split())
    if len(t) <= TITLE_MAX_CHARS:
        return t or "…"
    return t[:TITLE_MAX_CHARS].rstrip() + "…"


async def run_turn(
    *,
    write_db: Session,
    read_db: Session,
    thread_id: int,
    user_text: str,
    docs_dir: Any = None,
    lang: str = "en",
    name_order: str = "en",
    style: str = "structured",
    proband_id: int | None = None,
) -> AsyncIterator[str]:
    """Yield SSE frames for one user turn."""
    settings = ai_config.get_settings()
    if not settings["api_key"]:
        yield _sse("error", {"message": "No API key configured.", "kind": "auth"})
        return

    thread = write_db.get(ChatThread, thread_id)
    if thread is None:
        yield _sse("error", {"message": "Thread not found.", "kind": "bad_request"})
        return

    model = settings["model"]
    caps = ai_config.model_caps(model)
    max_tokens = min(DEFAULT_MAX_TOKENS, int(caps.get("max_output") or DEFAULT_MAX_TOKENS))

    now = datetime.now().isoformat()

    # Persist the user turn first, so a crash mid-stream still leaves a coherent
    # transcript rather than an answer with no question.
    user_msg = ChatMessage(thread_id=thread_id, role="user", content=user_text, created_at=now)
    write_db.add(user_msg)
    if not thread.title:
        thread.title = derive_title(user_text)
    if not thread.model:
        thread.model = model
        thread.provider = settings["provider"]
    thread.updated_at = now
    write_db.commit()
    yield _sse("user_saved", {"message_id": user_msg.id, "title": thread.title})

    messages = _history_for_provider(write_db, thread_id)
    system = build_system_blocks(
        read_db, lang=lang, name_order=name_order, style=style,
        allow_private=settings["allow_private"], proband_id=proband_id,
    )
    # Web research is a second, independent opt-in (its own key, its own daily
    # quota — see ai/config.py) — its tool *definitions* are withheld entirely
    # when off, so a user who never turned it on never sees it exist and no
    # prompt tokens are spent explaining a capability that would just refuse.
    web_settings = ai_config.get_web_settings()
    web_ready = bool(web_settings["enabled"] and web_settings["api_key"])
    tools = REGISTRY.definitions()
    if web_ready:
        tools = sorted(tools + WEB_REGISTRY.definitions(), key=lambda t: t["name"])
    ctx = ToolContext(db=read_db, allow_private=settings["allow_private"], docs_dir=docs_dir)
    provider = build_provider(settings["provider"], settings["api_key"], settings.get("base_url"))

    answer_parts: list[str] = []
    recorded_calls: list[dict[str, Any]] = []
    totals = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
    failed = False

    for _iteration in range(MAX_ITERATIONS):
        turn: TurnComplete | None = None
        errored = False

        async for ev in provider.stream_turn(
            model=model, system=system, messages=messages, tools=tools, max_tokens=max_tokens,
        ):
            if isinstance(ev, TextDelta):
                answer_parts.append(ev.text)
                yield _sse("text", {"text": ev.text})
            elif isinstance(ev, ProviderError):
                errored = True
                failed = True
                yield _sse("error", {"message": ev.message, "kind": ev.kind, "retryable": ev.retryable})
            elif isinstance(ev, TurnComplete):
                turn = ev

        if errored or turn is None:
            break

        totals["input"] += turn.usage.input_tokens
        totals["output"] += turn.usage.output_tokens
        totals["cache_read"] += turn.usage.cache_read_tokens
        totals["cache_write"] += turn.usage.cache_write_tokens

        if not turn.tool_uses:
            break

        messages.append({
            "role": "assistant",
            "content": turn.text,
            "tool_calls": [{"id": t.id, "name": t.name, "input": t.input} for t in turn.tool_uses],
        })

        results = []
        for call in turn.tool_uses:
            yield _sse("tool_start", {"id": call.id, "name": call.name, "input": call.input})
            started = time.monotonic()
            is_error = False
            try:
                # A local tool is a fast SQLite read, always has been — but a
                # web tool is a real network round trip (1-5s+), and this loop
                # runs inside the request's own event loop. Running it inline
                # would stall every other request this single-process app is
                # serving for that whole duration; to_thread keeps it off the
                # loop regardless of which registry handles it.
                registry = WEB_REGISTRY if call.name in WEB_TOOL_NAMES else REGISTRY
                result = await asyncio.to_thread(registry.execute, call.name, call.input, ctx)
            except Exception as exc:  # a tool crash must not kill the turn
                result = {"error": f"{type(exc).__name__}: {exc}"}
                is_error = True
            duration_ms = int((time.monotonic() - started) * 1000)
            payload = json.dumps(result, ensure_ascii=False, default=str)

            results.append({"id": call.id, "content": payload, "is_error": is_error})
            recorded_calls.append({
                "tool_name": call.name,
                "arguments_json": json.dumps(call.input, ensure_ascii=False),
                "result_json": payload,
                "duration_ms": duration_ms,
                "is_error": is_error,
            })
            yield _sse("tool_end", {
                "id": call.id, "name": call.name, "result": result,
                "duration_ms": duration_ms, "is_error": is_error,
            })

        # All results for one assistant turn go back together.
        messages.append({"role": "tool_results", "results": results})
    else:
        yield _sse("notice", {"message": f"Stopped after {MAX_ITERATIONS} tool rounds."})

    answer = "".join(answer_parts).strip()
    if answer or recorded_calls:
        assistant_msg = ChatMessage(
            thread_id=thread_id,
            role="assistant",
            content=answer,
            created_at=datetime.now().isoformat(),
            input_tokens=totals["input"],
            output_tokens=totals["output"],
            cache_read_tokens=totals["cache_read"],
        )
        write_db.add(assistant_msg)
        write_db.flush()
        for rc in recorded_calls:
            write_db.add(ChatToolCall(message_id=assistant_msg.id, **rc))
        thread.updated_at = datetime.now().isoformat()
        write_db.commit()
        yield _sse("saved", {"message_id": assistant_msg.id})

    yield _sse("done", {
        "usage": totals,
        "failed": failed,
        "estimated_cost_usd": _estimate_cost(model, totals),
    })


def _estimate_cost(model: str, totals: dict[str, int]) -> float | None:
    pricing = ai_config.model_pricing(model)
    if not pricing:
        return None
    per_m = 1_000_000
    cost = (
        totals["input"] * (pricing.get("in", 0) / per_m)
        + totals["output"] * (pricing.get("out", 0) / per_m)
        + totals["cache_read"] * (pricing.get("cache_read", 0) / per_m)
        + totals["cache_write"] * (pricing.get("cache_write", 0) / per_m)
    )
    return round(cost, 6)

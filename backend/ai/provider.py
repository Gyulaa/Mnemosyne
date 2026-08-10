"""Provider abstraction — the seam that keeps new models cheap to adopt.

Nothing provider-specific may leak above `LLMProvider`. The orchestrator speaks
only the neutral message shape and the `ProviderEvent` union defined here, so a
second adapter (OpenAI-compatible: OpenAI, OpenRouter, Ollama, LM Studio) can be
dropped in later without touching the tool layer, the agent loop, or the UI.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Literal, Protocol, runtime_checkable


# ── neutral wire shapes ───────────────────────────────────────────────────────
#
# messages: list of dicts, one of
#   {"role": "user",         "content": str}
#   {"role": "assistant",    "content": str, "tool_calls": [{id, name, input}]}
#   {"role": "tool_results", "results": [{id, content, is_error}]}


@dataclass
class TextDelta:
    text: str


@dataclass
class ToolUseRequested:
    id: str
    name: str
    input: dict[str, Any]


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0


@dataclass
class TurnComplete:
    stop_reason: str | None
    tool_uses: list[ToolUseRequested] = field(default_factory=list)
    text: str = ""
    usage: Usage = field(default_factory=Usage)


@dataclass
class ProviderError:
    message: str
    kind: Literal["auth", "rate_limit", "connection", "overloaded", "bad_request", "other"] = "other"
    retryable: bool = False


ProviderEvent = TextDelta | ToolUseRequested | TurnComplete | ProviderError


@runtime_checkable
class LLMProvider(Protocol):
    async def stream_turn(
        self,
        *,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        max_tokens: int,
    ) -> AsyncIterator[ProviderEvent]:
        ...


# ── Anthropic ─────────────────────────────────────────────────────────────────


class AnthropicProvider:
    """Anthropic Messages API, streaming, with adaptive thinking.

    Deliberately omits `temperature`, `top_p` and `budget_tokens` — all three are
    rejected with a 400 on current models; depth is controlled with `effort`.
    """

    def __init__(self, api_key: str, effort: str = "high"):
        self._api_key = api_key
        self._effort = effort

    def _client(self):
        import anthropic
        return anthropic.AsyncAnthropic(api_key=self._api_key)

    @staticmethod
    def _to_anthropic_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for m in messages:
            role = m.get("role")
            if role == "user":
                out.append({"role": "user", "content": m.get("content") or ""})
            elif role == "assistant":
                blocks: list[dict[str, Any]] = []
                if m.get("content"):
                    blocks.append({"type": "text", "text": m["content"]})
                for tc in m.get("tool_calls") or []:
                    blocks.append({
                        "type": "tool_use",
                        "id": tc["id"],
                        "name": tc["name"],
                        "input": tc.get("input") or {},
                    })
                if blocks:
                    out.append({"role": "assistant", "content": blocks})
            elif role == "tool_results":
                blocks = []
                for r in m.get("results") or []:
                    block: dict[str, Any] = {
                        "type": "tool_result",
                        "tool_use_id": r["id"],
                        "content": r.get("content") or "",
                    }
                    if r.get("is_error"):
                        block["is_error"] = True
                    blocks.append(block)
                # All results for one assistant turn go back in a *single* user
                # message — splitting them trains the model out of parallel calls.
                if blocks:
                    out.append({"role": "user", "content": blocks})
        return out

    async def stream_turn(
        self,
        *,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        max_tokens: int = 16000,
    ) -> AsyncIterator[ProviderEvent]:
        import anthropic

        client = self._client()
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": self._to_anthropic_messages(messages),
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": self._effort},
        }
        if tools:
            kwargs["tools"] = tools

        try:
            async with client.messages.stream(**kwargs) as stream:
                async for event in stream:
                    if event.type == "content_block_delta" and event.delta.type == "text_delta":
                        yield TextDelta(event.delta.text)

                final = await stream.get_final_message()

            tool_uses = [
                ToolUseRequested(id=b.id, name=b.name, input=dict(b.input or {}))
                for b in final.content if b.type == "tool_use"
            ]
            text = "".join(b.text for b in final.content if b.type == "text")
            u = final.usage
            yield TurnComplete(
                stop_reason=final.stop_reason,
                tool_uses=tool_uses,
                text=text,
                usage=Usage(
                    input_tokens=getattr(u, "input_tokens", 0) or 0,
                    output_tokens=getattr(u, "output_tokens", 0) or 0,
                    cache_read_tokens=getattr(u, "cache_read_input_tokens", 0) or 0,
                    cache_write_tokens=getattr(u, "cache_creation_input_tokens", 0) or 0,
                ),
            )

        except anthropic.AuthenticationError:
            yield ProviderError("Invalid API key.", kind="auth")
        except anthropic.PermissionDeniedError:
            yield ProviderError("The API key lacks access to this model.", kind="auth")
        except anthropic.NotFoundError:
            yield ProviderError(f"Unknown model: {model}", kind="bad_request")
        except anthropic.RateLimitError:
            yield ProviderError("Rate limited — try again shortly.", kind="rate_limit", retryable=True)
        except anthropic.BadRequestError as e:
            yield ProviderError(f"Rejected request: {getattr(e, 'message', str(e))}", kind="bad_request")
        except anthropic.APIConnectionError:
            yield ProviderError("Could not reach the API — check the connection.", kind="connection", retryable=True)
        except anthropic.APIStatusError as e:
            retryable = getattr(e, "status_code", 500) >= 500
            kind = "overloaded" if getattr(e, "status_code", 0) == 529 else "other"
            yield ProviderError(f"API error ({getattr(e, 'status_code', '?')}).", kind=kind, retryable=retryable)
        finally:
            try:
                await client.close()
            except Exception:
                pass


# ── OpenAI-compatible ─────────────────────────────────────────────────────────


class OpenAICompatProvider:
    """Any endpoint speaking OpenAI's Chat Completions API.

    One adapter, several providers: OpenAI itself today, and OpenRouter /
    Ollama / LM Studio later by changing `base_url` alone.

    Three things differ from Anthropic and are handled here rather than leaking
    upwards: the system prompt is an ordinary message instead of a separate
    parameter, tools are wrapped in a `function` envelope, and streamed tool
    arguments arrive as fragments that have to be reassembled per index.
    """

    def __init__(self, api_key: str, base_url: str | None = None):
        self._api_key = api_key
        self._base_url = base_url

    def _client(self):
        import openai
        kwargs: dict[str, Any] = {"api_key": self._api_key}
        if self._base_url:
            kwargs["base_url"] = self._base_url
        return openai.AsyncOpenAI(**kwargs)

    @staticmethod
    def _to_openai_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t.get("description") or "",
                    "parameters": t.get("input_schema") or {"type": "object", "properties": {}},
                },
            }
            for t in tools
        ]

    @staticmethod
    def _to_openai_messages(
        system: list[dict[str, Any]], messages: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        # OpenAI caches long prompt prefixes automatically, so the Anthropic
        # cache_control markers are simply dropped here.
        system_text = "\n\n".join(b.get("text", "") for b in system if b.get("text"))
        out: list[dict[str, Any]] = []
        if system_text:
            out.append({"role": "system", "content": system_text})

        for m in messages:
            role = m.get("role")
            if role == "user":
                out.append({"role": "user", "content": m.get("content") or ""})
            elif role == "assistant":
                msg: dict[str, Any] = {"role": "assistant", "content": m.get("content") or None}
                calls = m.get("tool_calls") or []
                if calls:
                    msg["tool_calls"] = [
                        {
                            "id": tc["id"],
                            "type": "function",
                            "function": {
                                "name": tc["name"],
                                "arguments": json.dumps(tc.get("input") or {}, ensure_ascii=False),
                            },
                        }
                        for tc in calls
                    ]
                out.append(msg)
            elif role == "tool_results":
                # Unlike Anthropic, each result is its own message.
                for r in m.get("results") or []:
                    out.append({
                        "role": "tool",
                        "tool_call_id": r["id"],
                        "content": r.get("content") or "",
                    })
        return out

    async def stream_turn(
        self,
        *,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        max_tokens: int = 16000,
    ) -> AsyncIterator[ProviderEvent]:
        import openai

        client = self._client()
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": self._to_openai_messages(system, messages),
            "stream": True,
            # Usage is omitted from streamed responses unless asked for.
            "stream_options": {"include_usage": True},
            "max_completion_tokens": max_tokens,
        }
        if tools:
            kwargs["tools"] = self._to_openai_tools(tools)

        text_parts: list[str] = []
        # index -> {id, name, args}; streamed arguments arrive in fragments.
        partial: dict[int, dict[str, str]] = {}
        usage = Usage()
        finish_reason: str | None = None

        try:
            stream = await client.chat.completions.create(**kwargs)
            async for chunk in stream:
                if getattr(chunk, "usage", None):
                    u = chunk.usage
                    cached = 0
                    details = getattr(u, "prompt_tokens_details", None)
                    if details is not None:
                        cached = getattr(details, "cached_tokens", 0) or 0
                    usage = Usage(
                        input_tokens=(getattr(u, "prompt_tokens", 0) or 0) - cached,
                        output_tokens=getattr(u, "completion_tokens", 0) or 0,
                        cache_read_tokens=cached,
                    )

                if not chunk.choices:
                    continue
                choice = chunk.choices[0]
                if choice.finish_reason:
                    finish_reason = choice.finish_reason

                delta = choice.delta
                if delta is None:
                    continue

                if delta.content:
                    text_parts.append(delta.content)
                    yield TextDelta(delta.content)

                for tc in (delta.tool_calls or []):
                    slot = partial.setdefault(tc.index, {"id": "", "name": "", "args": ""})
                    if tc.id:
                        slot["id"] = tc.id
                    if tc.function and tc.function.name:
                        slot["name"] = tc.function.name
                    if tc.function and tc.function.arguments:
                        slot["args"] += tc.function.arguments

            tool_uses: list[ToolUseRequested] = []
            for _idx, slot in sorted(partial.items()):
                if not slot["name"]:
                    continue
                try:
                    args = json.loads(slot["args"]) if slot["args"].strip() else {}
                except json.JSONDecodeError:
                    args = {}
                tool_uses.append(ToolUseRequested(
                    id=slot["id"] or f"call_{_idx}", name=slot["name"], input=args,
                ))

            yield TurnComplete(
                stop_reason=finish_reason,
                tool_uses=tool_uses,
                text="".join(text_parts),
                usage=usage,
            )

        except openai.AuthenticationError:
            yield ProviderError("Invalid API key.", kind="auth")
        except openai.PermissionDeniedError:
            yield ProviderError("The API key lacks access to this model.", kind="auth")
        except openai.NotFoundError:
            yield ProviderError(f"Unknown model: {model}", kind="bad_request")
        except openai.RateLimitError:
            # OpenAI also returns 429 when a project is out of credit, which is
            # a different problem from being throttled — say both.
            yield ProviderError(
                "Rate limited, or the account is out of credit.",
                kind="rate_limit", retryable=True,
            )
        except openai.BadRequestError as e:
            yield ProviderError(f"Rejected request: {getattr(e, 'message', str(e))}", kind="bad_request")
        except openai.APIConnectionError:
            yield ProviderError("Could not reach the API — check the connection.", kind="connection", retryable=True)
        except openai.APIStatusError as e:
            status = getattr(e, "status_code", 500)
            yield ProviderError(f"API error ({status}).", kind="other", retryable=status >= 500)
        finally:
            try:
                await client.close()
            except Exception:
                pass


def build_provider(provider: str, api_key: str, base_url: str | None = None) -> LLMProvider:
    """Factory — the single place that maps a provider name to an adapter."""
    if provider == "anthropic":
        return AnthropicProvider(api_key)
    if provider in ("openai", "openai_compatible"):
        return OpenAICompatProvider(api_key, base_url=base_url)
    raise ValueError(f"Unsupported provider: {provider}")


async def discover_models(provider: str, api_key: str, base_url: str | None = None) -> list[str]:
    """Model ids the key can actually use, straight from the provider.

    Guards against this app's curated manifest going stale: a model released
    after the last manifest update still shows up in the picker.
    """
    if provider == "anthropic":
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=api_key)
        try:
            return [m.id async for m in client.models.list()]
        finally:
            await client.close()

    if provider in ("openai", "openai_compatible"):
        import openai
        kwargs: dict[str, Any] = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url
        client = openai.AsyncOpenAI(**kwargs)
        try:
            res = await client.models.list()
            return [m.id for m in res.data]
        finally:
            await client.close()

    raise ValueError(f"Unsupported provider: {provider}")


def json_dumps_stable(obj: Any) -> str:
    """Deterministic JSON — used wherever bytes must be reproducible so the
    prompt cache keeps hitting."""
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

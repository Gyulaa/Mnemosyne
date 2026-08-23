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


@dataclass
class AnalysisResult:
    """One non-streamed, tool-free call over a file. `error` set means nothing
    was read — callers must check it rather than treating "" as an empty page.
    """
    text: str = ""
    usage: Usage = field(default_factory=Usage)
    error: ProviderError | None = None


# file blocks handed to `analyze_files`, one of
#   {"type": "text",  "text": str}
#   {"type": "image", "media_type": "image/jpeg", "data": <base64 str>}
#   {"type": "pdf",   "media_type": "application/pdf", "data": <base64 str>}


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

    async def analyze_files(
        self,
        *,
        model: str,
        system: str,
        blocks: list[dict[str, Any]],
        max_tokens: int,
    ) -> AnalysisResult:
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


    async def analyze_files(
        self,
        *,
        model: str,
        system: str,
        blocks: list[dict[str, Any]],
        max_tokens: int = 8000,
    ) -> AnalysisResult:
        """One shot over one page: no tools, no streaming, no history.

        PDFs go up as a native `document` block rather than being rasterised
        here — the provider renders the pages itself, which is why this app
        needs no PDF renderer in the bundle (`PyMuPDF` would add a compiled
        binary and an AGPL question for exactly this one job).
        """
        import anthropic

        content: list[dict[str, Any]] = []
        for b in blocks:
            if b["type"] == "text":
                content.append({"type": "text", "text": b["text"]})
            elif b["type"] == "image":
                content.append({
                    "type": "image",
                    "source": {"type": "base64", "media_type": b["media_type"], "data": b["data"]},
                })
            elif b["type"] == "pdf":
                content.append({
                    "type": "document",
                    "source": {"type": "base64", "media_type": "application/pdf", "data": b["data"]},
                })

        client = self._client()
        try:
            msg = await client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": content}],
                thinking={"type": "adaptive"},
                output_config={"effort": self._effort},
            )
            u = msg.usage
            text = "".join(b.text for b in msg.content if b.type == "text")
            if not text.strip() and msg.stop_reason == "max_tokens":
                return AnalysisResult(error=ProviderError(
                    "The model hit its output limit before writing anything. "
                    "Raise the budget or lower the effort.",
                    kind="bad_request",
                ))
            return AnalysisResult(
                text=text,
                usage=Usage(
                    input_tokens=getattr(u, "input_tokens", 0) or 0,
                    output_tokens=getattr(u, "output_tokens", 0) or 0,
                    cache_read_tokens=getattr(u, "cache_read_input_tokens", 0) or 0,
                ),
            )
        except anthropic.AuthenticationError:
            return AnalysisResult(error=ProviderError("Invalid API key.", kind="auth"))
        except anthropic.PermissionDeniedError:
            return AnalysisResult(error=ProviderError("The API key lacks access to this model.", kind="auth"))
        except anthropic.NotFoundError:
            return AnalysisResult(error=ProviderError(f"Unknown model: {model}", kind="bad_request"))
        except anthropic.RateLimitError:
            return AnalysisResult(error=ProviderError("Rate limited — try again shortly.", kind="rate_limit", retryable=True))
        except anthropic.BadRequestError as e:
            return AnalysisResult(error=ProviderError(f"Rejected request: {getattr(e, 'message', str(e))}", kind="bad_request"))
        except anthropic.APIConnectionError:
            return AnalysisResult(error=ProviderError("Could not reach the API — check the connection.", kind="connection", retryable=True))
        except anthropic.APIStatusError as e:
            status = getattr(e, "status_code", 500)
            kind = "overloaded" if status == 529 else "other"
            return AnalysisResult(error=ProviderError(f"API error ({status}).", kind=kind, retryable=status >= 500))
        finally:
            try:
                await client.close()
            except Exception:
                pass


# ── OpenAI-compatible ─────────────────────────────────────────────────────────

# Some reasoning models refuse `reasoning_effort` on `/v1/chat/completions`
# *when the same request also carries function tools*, and say so in a 400. That
# hits the batch report — which is an agent loop with tools — while leaving
# transcription, which has none, working fine.
#
# Learned at runtime, never written down: the id that does this today is not the
# id that will do it in three months, and a hardcoded list is wrong the day the
# next model ships. The provider's own refusal is the authority, so the request
# is tried as normal, the refusal is believed, and the model is remembered for
# the life of the process so the next turn does not pay the failed round trip.
#
# The retry sets the field to `"none"` rather than dropping it. Dropping it was
# the first attempt and the same 400 came back: these models do not default to
# no reasoning, so an absent field is not the same as `none`. The error text
# says which it wants — "set reasoning_effort to 'none'" — and that is what it
# gets.
_NO_EFFORT_WITH_TOOLS: set[str] = set()

# What a model in that set is sent instead, when the request carries tools.
_EFFORT_NONE = "none"


def _rejects_effort_with_tools(message: str) -> bool:
    text = (message or "").lower()
    return "reasoning_effort" in text and "tool" in text


class OpenAICompatProvider:
    """Any endpoint speaking OpenAI's Chat Completions API.

    One adapter, several providers: OpenAI itself today, and OpenRouter /
    Ollama / LM Studio later by changing `base_url` alone.

    Three things differ from Anthropic and are handled here rather than leaking
    upwards: the system prompt is an ordinary message instead of a separate
    parameter, tools are wrapped in a `function` envelope, and streamed tool
    arguments arrive as fragments that have to be reassembled per index.
    """

    def __init__(self, api_key: str, base_url: str | None = None, effort: str = "high"):
        self._api_key = api_key
        self._base_url = base_url
        self._effort = effort

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
        from . import config as ai_config

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
        # Capability-gated, not id-gated (models.json's own rule): a non-
        # reasoning model rejects this field outright with a 400, so it is
        # only sent when the manifest says this model actually supports it.
        # Mirrors AnthropicProvider's `effort` — same default depth on both.
        if ai_config.model_caps(model).get("reasoning"):
            kwargs["reasoning_effort"] = (
                _EFFORT_NONE
                if tools and model in _NO_EFFORT_WITH_TOOLS
                else self._effort
            )

        text_parts: list[str] = []
        # index -> {id, name, args}; streamed arguments arrive in fragments.
        partial: dict[int, dict[str, str]] = {}
        usage = Usage()
        finish_reason: str | None = None

        try:
            try:
                stream = await client.chat.completions.create(**kwargs)
            except openai.BadRequestError as e:
                if not (
                    tools
                    and kwargs.get("reasoning_effort") not in (None, _EFFORT_NONE)
                    and _rejects_effort_with_tools(getattr(e, "message", str(e)))
                ):
                    raise
                # The provider has just said this model cannot reason *and* take
                # tools on this endpoint. Believe it, remember it, and send the
                # request again at no depth rather than failing a turn over a
                # parameter that only controls how hard the model thinks.
                _NO_EFFORT_WITH_TOOLS.add(model)
                kwargs["reasoning_effort"] = _EFFORT_NONE
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


    async def analyze_files(
        self,
        *,
        model: str,
        system: str,
        blocks: list[dict[str, Any]],
        max_tokens: int = 8000,
    ) -> AnalysisResult:
        """Images only.

        Chat Completions takes images as `image_url` data URIs, which is what
        this sends. Its file-input shape for PDFs is not something this
        adapter has been verified against, so a PDF is refused here with a
        message naming the two ways out, rather than guessed at — a wrong wire
        shape would surface as a 400 per page, mid-batch, for the user to
        decode. Anthropic takes the PDF natively; everyone else can fall back
        to the text layer.
        """
        import openai
        from . import config as ai_config

        content: list[dict[str, Any]] = []
        for b in blocks:
            if b["type"] == "text":
                content.append({"type": "text", "text": b["text"]})
            elif b["type"] == "image":
                content.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{b['media_type']};base64,{b['data']}"},
                })
            elif b["type"] == "pdf":
                return AnalysisResult(error=ProviderError(
                    "This provider cannot be sent a PDF page image. Either the PDF "
                    "has a text layer to extract, or switch the document reader to "
                    "Anthropic.",
                    kind="bad_request",
                ))

        client = self._client()
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": content},
            ],
            "max_completion_tokens": max_tokens,
        }
        # Capability-gated exactly as in stream_turn — a non-reasoning model
        # rejects this field with a 400 rather than ignoring it.
        if ai_config.model_caps(model).get("reasoning"):
            kwargs["reasoning_effort"] = self._effort

        try:
            res = await client.chat.completions.create(**kwargs)
            u = getattr(res, "usage", None)
            cached = 0
            if u is not None:
                details = getattr(u, "prompt_tokens_details", None)
                if details is not None:
                    cached = getattr(details, "cached_tokens", 0) or 0
            choice = res.choices[0] if res.choices else None
            text = (choice.message.content or "") if choice else ""
            finish = getattr(choice, "finish_reason", None) if choice else None
            # A reasoning model spends `max_completion_tokens` on thinking
            # first, so a budget that is merely tight comes back as a
            # *successful* response with an empty string in it. Reported as
            # "the model returned nothing", that reads as an unreadable page
            # and sends the user to re-scan a file that was fine.
            if not text.strip() and finish == "length":
                return AnalysisResult(error=ProviderError(
                    "The model used its whole output budget before writing anything — "
                    "on a reasoning model the thinking counts against it. Raise the "
                    "budget or lower the effort.",
                    kind="bad_request",
                ))
            return AnalysisResult(
                text=text,
                usage=Usage(
                    input_tokens=((getattr(u, "prompt_tokens", 0) or 0) - cached) if u else 0,
                    output_tokens=(getattr(u, "completion_tokens", 0) or 0) if u else 0,
                    cache_read_tokens=cached,
                ),
            )
        except openai.AuthenticationError:
            return AnalysisResult(error=ProviderError("Invalid API key.", kind="auth"))
        except openai.PermissionDeniedError:
            return AnalysisResult(error=ProviderError("The API key lacks access to this model.", kind="auth"))
        except openai.NotFoundError:
            return AnalysisResult(error=ProviderError(f"Unknown model: {model}", kind="bad_request"))
        except openai.RateLimitError:
            return AnalysisResult(error=ProviderError(
                "Rate limited, or the account is out of credit.", kind="rate_limit", retryable=True))
        except openai.BadRequestError as e:
            return AnalysisResult(error=ProviderError(f"Rejected request: {getattr(e, 'message', str(e))}", kind="bad_request"))
        except openai.APIConnectionError:
            return AnalysisResult(error=ProviderError("Could not reach the API — check the connection.", kind="connection", retryable=True))
        except openai.APIStatusError as e:
            status = getattr(e, "status_code", 500)
            return AnalysisResult(error=ProviderError(f"API error ({status}).", kind="other", retryable=status >= 500))
        finally:
            try:
                await client.close()
            except Exception:
                pass


def build_provider(
    provider: str, api_key: str, base_url: str | None = None, effort: str = "high",
) -> LLMProvider:
    """Factory — the single place that maps a provider name to an adapter.

    `effort` is a parameter rather than a constant because not every job is a
    reasoning job: transcribing a page is reading, and the depth that helps an
    ancestry question mostly buys reasoning tokens here (see `ai/doc_reader.py`).
    """
    if provider == "anthropic":
        return AnthropicProvider(api_key, effort=effort)
    # Gemini speaks OpenAI's Chat Completions API at an address of its own, so
    # it needs no adapter — only the base_url the manifest carries. This is the
    # case `OpenAICompatProvider` was written for.
    if provider in ("openai", "openai_compatible", "google"):
        return OpenAICompatProvider(api_key, base_url=base_url, effort=effort)
    raise ValueError(f"Unsupported provider: {provider}")


async def discover_models(
    provider: str, api_key: str, base_url: str | None = None,
) -> list[dict[str, Any]]:
    """What this key can actually use, described as far as the provider will.

    Returns records, not bare ids, because the providers differ in what they
    are willing to say and the picker should show whatever is on offer:

    * **Gemini** gives a display name, a prose description and token limits —
      but only from its *native* models endpoint, not the OpenAI-compatible
      one, so that is what this asks.
    * **Anthropic** gives a display name, a creation date and (on current API
      versions) limits and capabilities.
    * **OpenAI** gives an id and a creation date and nothing else. The date is
      still worth having: it is what orders the list newest-first.

    Anything absent is simply left out of the record — the caller falls back to
    the id and to the manifest's family rules. There is deliberately no curated
    list of models anywhere; this is the source of truth.
    """
    if provider == "anthropic":
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=api_key)
        try:
            out: list[dict[str, Any]] = []
            async for m in client.models.list():
                rec: dict[str, Any] = {"id": m.id}
                label = getattr(m, "display_name", None)
                if label:
                    rec["label"] = label
                created = getattr(m, "created_at", None)
                if created is not None:
                    rec["created"] = str(created)
                for src, dst in (("max_input_tokens", "context"), ("max_tokens", "max_output")):
                    val = getattr(m, src, None)
                    if isinstance(val, int) and val > 0:
                        rec[dst] = val
                out.append(rec)
            return out
        finally:
            await client.close()

    if provider == "google":
        # The compatibility layer answers /models with ids alone; the native
        # endpoint is the one that carries displayName and description.
        import json as _json
        import urllib.parse
        import urllib.request
        from . import config as ai_config

        info = (ai_config.list_providers_raw() or {}).get("google") or {}
        endpoint = info.get("metadata_url") or "https://generativelanguage.googleapis.com/v1beta/models"

        def _fetch() -> list[dict[str, Any]]:
            records: list[dict[str, Any]] = []
            token = ""
            for _ in range(10):                       # paginate, bounded
                params = {"key": api_key, "pageSize": "200"}
                if token:
                    params["pageToken"] = token
                url = f"{endpoint}?{urllib.parse.urlencode(params)}"
                with urllib.request.urlopen(url, timeout=30) as resp:
                    payload = _json.load(resp)
                for m in payload.get("models") or []:
                    name = (m.get("name") or "").split("/", 1)[-1]
                    if not name:
                        continue
                    methods = m.get("supportedGenerationMethods") or []
                    # Embedding and media-only endpoints are not chat models.
                    if methods and not any(x in methods for x in ("generateContent", "streamGenerateContent")):
                        continue
                    rec: dict[str, Any] = {"id": name}
                    if m.get("displayName"):
                        rec["label"] = m["displayName"]
                    if m.get("description"):
                        rec["description"] = m["description"]
                    if isinstance(m.get("inputTokenLimit"), int):
                        rec["context"] = m["inputTokenLimit"]
                    if isinstance(m.get("outputTokenLimit"), int):
                        rec["max_output"] = m["outputTokenLimit"]
                    records.append(rec)
                token = payload.get("nextPageToken") or ""
                if not token:
                    break
            return records

        import asyncio
        return await asyncio.to_thread(_fetch)

    if provider in ("openai", "openai_compatible"):
        import openai
        kwargs: dict[str, Any] = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url
        client = openai.AsyncOpenAI(**kwargs)
        try:
            res = await client.models.list()
            out = []
            for m in res.data:
                rec = {"id": m.id}
                created = getattr(m, "created", None)
                if isinstance(created, int) and created > 0:
                    rec["created"] = created
                out.append(rec)
            return out
        finally:
            await client.close()

    raise ValueError(f"Unsupported provider: {provider}")


def json_dumps_stable(obj: Any) -> str:
    """Deterministic JSON — used wherever bytes must be reproducible so the
    prompt cache keeps hitting."""
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

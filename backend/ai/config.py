"""Assistant settings and the model manifest.

Two directories, do not confuse them (see README → Auto-update):

* `models.json` is **bundled** — it ships with the build, so it is read from
  `MNEMOSYNE_BUNDLE_DIR`. Reading it from the app dir yields nothing in a
  packaged build, which is the exact bug `version.txt` once had.
* `config.json` is **user data** — it lives in `MNEMOSYNE_APP_DIR`, which is
  what the updater preserves across auto-updates. The API key goes here for
  that reason: a separate secrets file would be wiped by every update.
"""

import json
import os
import re
from pathlib import Path

BUNDLE_DIR = Path(os.environ.get("MNEMOSYNE_BUNDLE_DIR") or str(Path(__file__).parent.parent.parent))
APP_DIR = Path(os.environ.get("MNEMOSYNE_APP_DIR") or str(Path(__file__).parent.parent.parent))
CONFIG_FILE = APP_DIR / "config.json"

# The manifest sits next to this module in the source tree; in a frozen build the
# spec copies it to <bundle>/ai/models.json.
_MANIFEST_CANDIDATES = [
    BUNDLE_DIR / "ai" / "models.json",
    Path(__file__).parent / "models.json",
]

DEFAULT_PROVIDER = "anthropic"

# Applied to any model missing from the manifest, so a newly released model is
# usable the day it ships rather than blocked until we update the file.
UNKNOWN_MODEL_CAPS = {
    "tools": True,
    "vision": False,
    "streaming": True,
    "prompt_cache": False,
    # No context window: nothing branches on it, and a guess here would be
    # shown to the user as a fact about their model. It is filled in only from
    # what a provider states about itself.
    "max_output": 16000,
    # Conservative on purpose: an unknown model sending `reasoning_effort` to
    # an endpoint that rejects it fails the whole turn with a 400, whereas
    # just not sending it degrades quietly to the model's own default depth.
    "reasoning": False,
}


def _load_manifest() -> dict:
    for path in _MANIFEST_CANDIDATES:
        try:
            if path.exists():
                return json.loads(path.read_text(encoding="utf-8-sig"))
        except Exception:
            continue
    return {"default_provider": "anthropic", "providers": {}, "models": []}


def capability_rules() -> list[dict]:
    return _load_manifest().get("capability_rules") or []


def list_providers() -> list[dict]:
    """Providers the app knows about, in manifest order."""
    providers = _load_manifest().get("providers") or {}
    return [{"id": pid, **info} for pid, info in providers.items()]


def list_providers_raw() -> dict:
    """The manifest's provider block, keyed by id — for fields the public
    listing has no reason to carry (a provider's own metadata endpoint)."""
    return _load_manifest().get("providers") or {}


def default_provider() -> str:
    return _load_manifest().get("default_provider") or DEFAULT_PROVIDER


def default_model(provider: str | None = None) -> str:
    manifest = _load_manifest()
    pid = provider or default_provider()
    info = (manifest.get("providers") or {}).get(pid) or {}
    if info.get("default_model"):
        return info["default_model"]
    for m in manifest.get("models", []):
        if m.get("provider") == pid:
            return m["id"]
    return "claude-opus-5"


def _matching_rule(model_id: str) -> dict | None:
    """First capability rule whose pattern matches, or None.

    Rules are family-level (`^gpt-5`, `^gemini-`) rather than per model, so a
    point release inherits its family's capabilities. A hand-kept list of model
    ids is stale the day the next one ships — that is exactly what this avoids.
    """
    for rule in capability_rules():
        pattern = rule.get("match")
        if not pattern:
            continue
        try:
            if re.search(pattern, model_id or ""):
                return rule
        except re.error:
            continue
    return None


def model_caps(model_id: str) -> dict:
    """Capabilities for a model id — never raises, never blocks an unknown id."""
    rule = _matching_rule(model_id)
    if rule is None:
        return dict(UNKNOWN_MODEL_CAPS)
    return {**UNKNOWN_MODEL_CAPS, **(rule.get("caps") or {})}


def model_known(model_id: str) -> bool:
    """True when a capability rule covers this id, i.e. its caps are trustworthy.

    Anything that *refuses* to run must ask this first: an id no rule matches
    falls back to the conservative `UNKNOWN_MODEL_CAPS`, and refusing on those
    would turn away every model released after this build.
    """
    return _matching_rule(model_id) is not None


def model_pricing(model_id: str) -> dict | None:
    """Indicative price, or None. No provider exposes pricing over its API, so
    this is the one thing here that has to be hand-kept — and a miss showing no
    estimate is the right failure, where a guess would misinform."""
    return (_load_manifest().get("pricing") or {}).get(model_id)


# ── settings (config.json → "ai" block) ───────────────────────────────────────

def _read_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _write_config(cfg: dict) -> None:
    CONFIG_FILE.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


def _ai_block() -> dict:
    """The stored `ai` block, with the pre-multi-provider shape upgraded.

    Keys and models are kept *per provider* so switching between Anthropic and
    OpenAI does not mean re-entering credentials each time.
    """
    ai = dict(_read_config().get("ai") or {})
    ai.setdefault("keys", {})
    ai.setdefault("models", {})
    ai.setdefault("base_urls", {})
    # Migrate the single-provider layout written before OpenAI support.
    legacy_key = ai.pop("api_key", None)
    legacy_model = ai.pop("model", None)
    provider = ai.get("provider") or default_provider()
    if legacy_key and not ai["keys"].get(provider):
        ai["keys"][provider] = legacy_key
    if legacy_model and not ai["models"].get(provider):
        ai["models"][provider] = legacy_model
    # …and the single shared base_url written before a provider needed one of
    # its own. A URL entered for a local endpoint must not be sent to Gemini.
    legacy_base = ai.pop("base_url", None)
    if legacy_base and not ai["base_urls"].get(provider):
        ai["base_urls"][provider] = legacy_base
    return ai


def get_settings() -> dict:
    """Full settings for the active provider, including the raw key.

    Server-side use only — nothing here may be returned over HTTP unmasked.
    """
    ai = _ai_block()
    provider = ai.get("provider") or default_provider()
    return {
        "provider": provider,
        "model": ai["models"].get(provider) or default_model(provider),
        "api_key": ai["keys"].get(provider) or "",
        "base_url": provider_base_url(provider),
        "allow_private": bool(ai.get("allow_private", False)),
        "enabled": bool(ai.get("enabled", True)),
    }


def save_settings(
    *,
    provider: str | None = None,
    model: str | None = None,
    api_key: str | None = None,
    allow_private: bool | None = None,
    enabled: bool | None = None,
    base_url: str | None = None,
) -> dict:
    """Patch the `ai` block.

    Omitted fields keep their stored value. `api_key` and `model` apply to the
    provider being set in this same call (or the active one), so switching
    provider and pasting its key in one request does the right thing. An
    `api_key` of "" clears that provider's key — how the UI disconnects.
    """
    cfg = _read_config()
    ai = _ai_block()

    if provider is not None:
        ai["provider"] = provider
    target = ai.get("provider") or default_provider()

    if model is not None:
        ai["models"][target] = model
    if api_key is not None:
        if api_key == "":
            ai["keys"].pop(target, None)
        else:
            ai["keys"][target] = api_key
    if allow_private is not None:
        ai["allow_private"] = bool(allow_private)
    if enabled is not None:
        ai["enabled"] = bool(enabled)
    if base_url is not None:
        if base_url.strip():
            ai["base_urls"][target] = base_url.strip()
        else:
            ai["base_urls"].pop(target, None)

    cfg["ai"] = ai
    _write_config(cfg)
    return get_settings()


def configured_providers() -> dict[str, bool]:
    """Which providers already have a key stored — drives the UI's badges."""
    keys = _ai_block().get("keys") or {}
    return {p["id"]: bool(keys.get(p["id"])) for p in list_providers()}


def provider_key(provider: str) -> str:
    return (_ai_block().get("keys") or {}).get(provider) or ""


def provider_base_url(provider: str) -> str | None:
    """Where this provider's OpenAI-compatible endpoint lives.

    A user-entered override wins, then the manifest's own `base_url` — which is
    how Gemini works at all: it speaks OpenAI's Chat Completions API at a URL of
    its own, so it needs no adapter of its own, only an address. Anything
    OpenAI-compatible (OpenRouter, Ollama, LM Studio) can be added the same way.
    """
    stored = (_ai_block().get("base_urls") or {}).get(provider)
    if stored:
        return stored
    info = (_load_manifest().get("providers") or {}).get(provider) or {}
    return info.get("base_url") or None


# ── discovered model cache ────────────────────────────────────────────────────
#
# The manifest is metadata (labels, notes, prices), not a gate. What a model
# *is* comes from the provider's own /models endpoint, so a model released after
# this build still appears. Results are cached in config.json — small, and it
# survives auto-updates, so the picker is populated instantly on next launch.

CACHE_MAX_AGE_DAYS = 7

# Providers list every model on the account, most of which cannot hold a
# conversation. Substring match, deliberately conservative — it is better to
# show one odd id than to hide a usable model.
_NON_CHAT_MARKERS = (
    "embedding", "whisper", "tts", "dall-e", "moderation", "audio",
    "realtime", "transcribe", "image", "sora", "davinci", "babbage",
    "rerank", "guard",
)


def is_chat_model(model_id: str) -> bool:
    low = model_id.lower()
    return not any(marker in low for marker in _NON_CHAT_MARKERS)


def get_cached_models(provider: str) -> dict:
    """Records as the provider described them, plus when they were fetched.

    Tolerates the pre-record cache (a bare list of ids) written by an older
    build, so an upgrade does not empty the picker until the next refresh.
    """
    entry = (_ai_block().get("discovered") or {}).get(provider) or {}
    records = entry.get("records")
    if records is None:
        records = [{"id": i} for i in (entry.get("ids") or [])]
    return {
        "records": records,
        "ids": [r["id"] for r in records if r.get("id")],
        "fetched_at": entry.get("fetched_at"),
    }


def set_cached_models(provider: str, records: list[dict]) -> dict:
    """Store what the provider said about each model.

    Ordering is the provider's own where it supplies a release date (newest
    first, so a new release is the first thing in the list rather than
    something to scroll for), and alphabetical where it does not.
    """
    from datetime import datetime
    cfg = _read_config()
    ai = _ai_block()

    clean: dict[str, dict] = {}
    for r in records:
        mid = (r or {}).get("id")
        if not mid or not is_chat_model(mid):
            continue
        clean[mid] = {k: v for k, v in r.items() if v not in (None, "")}

    dated = [r for r in clean.values() if r.get("created")]
    undated = [r for r in clean.values() if not r.get("created")]
    ordered = (
        sorted(dated, key=lambda r: r["created"], reverse=True)
        + sorted(undated, key=lambda r: r["id"])
    )

    discovered = dict(ai.get("discovered") or {})
    discovered[provider] = {
        "records": ordered,
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
    }
    ai["discovered"] = discovered
    cfg["ai"] = ai
    _write_config(cfg)
    return get_cached_models(provider)


def cache_is_stale(provider: str) -> bool:
    from datetime import datetime, timedelta
    entry = get_cached_models(provider)
    if not entry["records"] or not entry["fetched_at"]:
        return True
    try:
        age = datetime.now() - datetime.fromisoformat(entry["fetched_at"])
    except ValueError:
        return True
    return age > timedelta(days=CACHE_MAX_AGE_DAYS)


def merged_models(provider: str) -> list[dict]:
    """What the picker shows: the provider's own list, decorated locally.

    Labels and descriptions come from the provider where it supplies them
    (Gemini gives both, Anthropic a display name, OpenAI neither), capabilities
    come from the family rules, and price from the hand-kept table. Nothing
    here is a curated list of models, because that is the thing that goes
    stale — before the first successful discovery this falls back to the
    provider's default model alone, which is enough to make a first call.
    """
    records = get_cached_models(provider)["records"]
    if not records:
        fallback = default_model(provider)
        return [{
            "id": fallback, "provider": provider, "label": fallback,
            "caps": model_caps(fallback), "pricing": model_pricing(fallback),
            "live": False,
        }]

    # The provider's own default goes first — a starting point, not a ranking;
    # everything after it keeps the provider's order (newest first where it
    # gives dates). Anything more opinionated would be curation by the back door.
    preferred = default_model(provider)
    records = sorted(records, key=lambda r: 0 if r.get("id") == preferred else 1)

    out: list[dict] = []
    for r in records:
        mid = r["id"]
        caps = dict(model_caps(mid))
        # Limits the provider states outrank the family rule's estimate.
        if r.get("context"):
            caps["context"] = r["context"]
        if r.get("max_output"):
            caps["max_output"] = r["max_output"]
        out.append({
            "id": mid,
            "provider": provider,
            "label": r.get("label") or mid,
            "description": r.get("description"),
            "caps": caps,
            "pricing": model_pricing(mid),
            "known": model_known(mid),
            "live": True,
        })
    return out


def mask_key(key: str) -> str:
    """`sk-ant-api03-abc…9f2a` — enough to recognise, useless to steal.

    The raw key must never leave the backend; every GET goes through this.
    """
    if not key:
        return ""
    if len(key) <= 12:
        return "•" * len(key)
    return f"{key[:10]}…{key[-4:]}"


def public_settings() -> dict:
    """Settings safe to send to the client."""
    s = get_settings()
    return {
        "provider": s["provider"],
        "model": s["model"],
        "api_key_masked": mask_key(s["api_key"]),
        "configured": bool(s["api_key"]),
        "configured_providers": configured_providers(),
        "providers": list_providers(),
        "allow_private": s["allow_private"],
        "enabled": s["enabled"],
        "caps": model_caps(s["model"]),
    }


# ── web research settings (config.json → "web_research" block) ────────────────
#
# Deliberately a sibling of the "ai" block, not a field inside it: enabling
# this sends specific names, dates and places to a *third* party (a search
# engine), which is a different disclosure than talking to the LLM provider
# the user already chose, and needs its own explicit, off-by-default consent
# — folding it into `allow_private` would be wrong, since that toggle answers
# a different question (visibility of the user's own private data to the
# assistant, not whether anything leaves the machine to a new destination).

DEFAULT_WEB_DAILY_LIMIT = 20


def _web_block() -> dict:
    web = dict(_read_config().get("web_research") or {})
    web.setdefault("enabled", False)
    web.setdefault("provider", "tavily")
    web.setdefault("api_key", "")
    web.setdefault("daily_limit", DEFAULT_WEB_DAILY_LIMIT)
    web.setdefault("usage", {})
    return web


def get_web_settings() -> dict:
    """Full web-research settings, including the raw key. Server-side only."""
    web = _web_block()
    return {
        "enabled": bool(web["enabled"]),
        "provider": web["provider"],
        "api_key": web["api_key"] or "",
        "daily_limit": int(web["daily_limit"]),
    }


def save_web_settings(
    *,
    enabled: bool | None = None,
    api_key: str | None = None,
    daily_limit: int | None = None,
) -> dict:
    """Patch the `web_research` block. Omitted fields keep their stored value.

    An `api_key` of "" clears the key — same disconnect convention as the AI
    provider keys.
    """
    cfg = _read_config()
    web = _web_block()

    if enabled is not None:
        web["enabled"] = bool(enabled)
    if api_key is not None:
        web["api_key"] = api_key
    if daily_limit is not None:
        web["daily_limit"] = int(daily_limit)

    cfg["web_research"] = web
    _write_config(cfg)
    return get_web_settings()


def _today() -> str:
    from datetime import date
    return date.today().isoformat()


def web_quota_status() -> dict:
    """Today's usage against the configured limit — resets on date rollover."""
    web = _web_block()
    usage = web.get("usage") or {}
    used = int(usage.get("count") or 0) if usage.get("date") == _today() else 0
    limit = int(web["daily_limit"])
    return {"used": used, "limit": limit, "remaining": max(0, limit - used)}


def try_consume_web_quota() -> bool:
    """Check-and-increment in one read-modify-write.

    Called from inside a web tool handler *before* the outbound request, so
    the cap is structural — enforced in code, not left to a prompt
    instruction the model could ignore or forget under pressure. Mirrors the
    date-rollover idiom `cache_is_stale()` / `set_cached_models()` already use
    for the discovered-model cache below: no new table, no lock beyond the
    read-modify-write every other `config.json` writer in this file already
    does (fine for a single-user desktop app).
    """
    cfg = _read_config()
    web = _web_block()
    usage = web.get("usage") or {}
    today = _today()
    used = int(usage.get("count") or 0) if usage.get("date") == today else 0
    limit = int(web["daily_limit"])
    if used >= limit:
        return False
    web["usage"] = {"date": today, "count": used + 1}
    cfg["web_research"] = web
    _write_config(cfg)
    return True


def public_web_settings() -> dict:
    """Web-research settings safe to send to the client."""
    s = get_web_settings()
    quota = web_quota_status()
    return {
        "enabled": s["enabled"],
        "api_key_masked": mask_key(s["api_key"]),
        "configured": bool(s["api_key"]),
        "daily_limit": s["daily_limit"],
        "usage_today": quota["used"],
    }


# ── document reading settings (config.json → "document_ai" block) ─────────────
#
# A third sibling of "ai" and "web_research", off by default, for the same
# reason web research got its own block: enabling it sends *the scans
# themselves* — a photograph of a page that may carry names, dates and
# marginalia nobody has read yet — to the model provider. That is a materially
# larger disclosure than the tree skeleton the assistant already sends, so it
# is its own consent, with its own model choice and its own page budget.
#
# The model is stored separately from the assistant's, because the two jobs
# reward different models: reading two-hundred-year-old handwriting is not the
# same skill as reasoning over a family tree, and being able to point them at
# different models is the only way to find out which reads a given hand best.

DEFAULT_DOC_MONTHLY_PAGES = 1000


def _doc_block() -> dict:
    doc = dict(_read_config().get("document_ai") or {})
    doc.setdefault("enabled", False)
    doc.setdefault("provider", "")      # "" → follow the assistant's provider
    doc.setdefault("model", "")         # "" → follow the assistant's model
    doc.setdefault("monthly_pages", DEFAULT_DOC_MONTHLY_PAGES)
    doc.setdefault("usage", {})
    return doc


def get_doc_settings() -> dict:
    """Full document-reading settings, resolved against the `ai` block.

    Falls back to the assistant's provider/model when none is chosen here, so
    a user who never opens the picker still gets a working default rather than
    an error — and the key always comes from the `ai` block's per-provider
    store, since it is the same account either way.
    """
    doc = _doc_block()
    ai = get_settings()
    provider = doc["provider"] or ai["provider"]
    model = doc["model"] or (ai["model"] if provider == ai["provider"] else default_model(provider))
    return {
        "enabled": bool(doc["enabled"]),
        "provider": provider,
        "model": model,
        "api_key": provider_key(provider),
        "base_url": provider_base_url(provider),
        "monthly_pages": int(doc["monthly_pages"]),
        "follows_assistant": not doc["provider"] and not doc["model"],
    }


def save_doc_settings(
    *,
    enabled: bool | None = None,
    provider: str | None = None,
    model: str | None = None,
    monthly_pages: int | None = None,
) -> dict:
    """Patch the `document_ai` block. Omitted fields keep their stored value.

    A `provider` or `model` of "" resets that choice to "follow the
    assistant", which is how the UI offers "same as the assistant".
    """
    cfg = _read_config()
    doc = _doc_block()

    if enabled is not None:
        doc["enabled"] = bool(enabled)
    if provider is not None:
        doc["provider"] = provider.strip()
    if model is not None:
        doc["model"] = model.strip()
    if monthly_pages is not None:
        doc["monthly_pages"] = max(1, int(monthly_pages))

    cfg["document_ai"] = doc
    _write_config(cfg)
    return get_doc_settings()


def _this_month() -> str:
    from datetime import date
    return date.today().strftime("%Y-%m")


def doc_quota_status() -> dict:
    """This month's page usage against the configured cap."""
    doc = _doc_block()
    usage = doc.get("usage") or {}
    used = int(usage.get("count") or 0) if usage.get("month") == _this_month() else 0
    limit = int(doc["monthly_pages"])
    return {"used": used, "limit": limit, "remaining": max(0, limit - used)}


def try_consume_doc_page() -> bool:
    """Check-and-increment one page, called before each outbound request.

    Same reasoning as `try_consume_web_quota`: a batch job that has been told
    to be economical is still a loop, and a loop with a bug reads a thousand
    pages. The cap has to be structural — a counter in code that the job
    cannot talk its way past — not a sentence in a prompt.
    """
    cfg = _read_config()
    doc = _doc_block()
    usage = doc.get("usage") or {}
    month = _this_month()
    used = int(usage.get("count") or 0) if usage.get("month") == month else 0
    limit = int(doc["monthly_pages"])
    if used >= limit:
        return False
    doc["usage"] = {"month": month, "count": used + 1}
    cfg["document_ai"] = doc
    _write_config(cfg)
    return True


def public_doc_settings() -> dict:
    """Document-reading settings safe to send to the client."""
    s = get_doc_settings()
    stored = _doc_block()
    quota = doc_quota_status()
    return {
        "enabled": s["enabled"],
        "provider": s["provider"],
        "model": s["model"],
        "provider_choice": stored["provider"],
        "model_choice": stored["model"],
        "follows_assistant": s["follows_assistant"],
        "configured": bool(s["api_key"]),
        "vision": bool(model_caps(s["model"]).get("vision")),
        "monthly_pages": s["monthly_pages"],
        "usage_month": quota["used"],
    }

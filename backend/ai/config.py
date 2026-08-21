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
    "context": 200000,
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


def list_models(provider: str | None = None) -> list[dict]:
    models = _load_manifest().get("models", [])
    if provider:
        return [m for m in models if m.get("provider") == provider]
    return models


def list_providers() -> list[dict]:
    """Providers the app knows about, in manifest order."""
    providers = _load_manifest().get("providers") or {}
    return [{"id": pid, **info} for pid, info in providers.items()]


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


def model_caps(model_id: str) -> dict:
    """Capabilities for a model id — never raises, never blocks an unknown id."""
    for m in list_models():
        if m.get("id") == model_id:
            return {**UNKNOWN_MODEL_CAPS, **(m.get("caps") or {})}
    return dict(UNKNOWN_MODEL_CAPS)


def model_pricing(model_id: str) -> dict | None:
    for m in list_models():
        if m.get("id") == model_id:
            return m.get("pricing")
    return None


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
    # Migrate the single-provider layout written before OpenAI support.
    legacy_key = ai.pop("api_key", None)
    legacy_model = ai.pop("model", None)
    provider = ai.get("provider") or default_provider()
    if legacy_key and not ai["keys"].get(provider):
        ai["keys"][provider] = legacy_key
    if legacy_model and not ai["models"].get(provider):
        ai["models"][provider] = legacy_model
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
        "base_url": ai.get("base_url") or None,
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
        ai["base_url"] = base_url.strip() or None

    cfg["ai"] = ai
    _write_config(cfg)
    return get_settings()


def configured_providers() -> dict[str, bool]:
    """Which providers already have a key stored — drives the UI's badges."""
    keys = _ai_block().get("keys") or {}
    return {p["id"]: bool(keys.get(p["id"])) for p in list_providers()}


def provider_key(provider: str) -> str:
    return (_ai_block().get("keys") or {}).get(provider) or ""


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
    entry = (_ai_block().get("discovered") or {}).get(provider) or {}
    return {"ids": entry.get("ids") or [], "fetched_at": entry.get("fetched_at")}


def set_cached_models(provider: str, ids: list[str]) -> dict:
    from datetime import datetime
    cfg = _read_config()
    ai = _ai_block()
    discovered = dict(ai.get("discovered") or {})
    discovered[provider] = {
        "ids": sorted({i for i in ids if is_chat_model(i)}),
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
    }
    ai["discovered"] = discovered
    cfg["ai"] = ai
    _write_config(cfg)
    return get_cached_models(provider)


def cache_is_stale(provider: str) -> bool:
    from datetime import datetime, timedelta
    entry = get_cached_models(provider)
    if not entry["ids"] or not entry["fetched_at"]:
        return True
    try:
        age = datetime.now() - datetime.fromisoformat(entry["fetched_at"])
    except ValueError:
        return True
    return age > timedelta(days=CACHE_MAX_AGE_DAYS)


def merged_models(provider: str) -> list[dict]:
    """What the picker shows: live model ids, decorated by the manifest.

    Curated entries come first and keep their labels, notes and prices;
    everything else the account can use follows, with fallback capabilities.
    Falls back to the manifest alone before the first successful discovery.
    """
    curated = list_models(provider)
    discovered = get_cached_models(provider)["ids"]
    if not discovered:
        return curated

    by_id = {m["id"]: m for m in curated}
    out: list[dict] = []
    # Curated first, in manifest order, but only those the account can see.
    for m in curated:
        if m["id"] in discovered:
            out.append({**m, "curated": True})
    seen = {m["id"] for m in out}
    for mid in discovered:
        if mid in seen:
            continue
        out.append({
            "id": mid,
            "provider": provider,
            "label": by_id.get(mid, {}).get("label") or mid,
            "caps": model_caps(mid),
            "curated": False,
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

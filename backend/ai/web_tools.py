"""Web research tools — the assistant's only path outside the project.

A second, independent registry from `tools.py`'s `REGISTRY`, deliberately not
merged into it. Every tool in `tools.py` reads the local, already-consented-to
project database; these two send a query to a third-party search engine and
fetch pages from the open internet — a materially different disclosure that
needs its own opt-in, its own API key, and its own daily quota, all stored in
`config.json`'s `web_research` block (see `ai/config.py`). `orchestrator.py`
includes this registry's tool definitions only when that block is enabled and
holds a key, so a user who never turned this on never even sees the tools
exist, and it dispatches to it separately for execution.

The split mirrors the project's own document tools: `search_text` finds,
`get_document` reads one in full. Here, `search_web` finds candidate pages,
`read_web_page` reads exactly one — the model must never report a search
snippet as if it were the content of the page.

Both handlers re-check the settings themselves before doing anything, rather
than trusting that the caller only reaches them when enabled — the same
defence-in-depth reasoning behind the assistant's read-only guarantee: don't
rely on one gate alone.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from bs4 import BeautifulSoup

from . import config as ai_config
from .pdf_text import extract_text as extract_pdf_text
from .tools import Tool, ToolContext, ToolRegistry

TAVILY_SEARCH_URL = "https://api.tavily.com/search"

#: Outbound request budget. A search or a page fetch is a real network round
#: trip, not a local query — generous enough for a slow archive server,
#: short enough that one bad host can't stall a whole conversation.
REQUEST_TIMEOUT_SECONDS = 20

#: Refuse to pull an arbitrarily large file into memory. A scanned register
#: is usually a few MB; anything past this is not a document to read inline.
MAX_DOWNLOAD_BYTES = 20_000_000

#: Longest page text returned inline — same order of magnitude as
#: `tools.MAX_BODY_CHARS`, for the same reason: past this the model is
#: reading a book through a keyhole and an excerpt serves it better than a
#: silent cutoff.
MAX_BODY_CHARS = 12000

#: A browser-shaped User-Agent. Plenty of archive and library sites reject a
#: generic Python client outright, which would otherwise read as "the page
#: doesn't exist" rather than "the site said no."
USER_AGENT = (
    "Mozilla/5.0 (compatible; MnemosyneFamilyResearch/1.0; "
    "+https://github.com/) genealogy-research-assistant"
)


def _t_search_web(ctx: ToolContext, a: dict[str, Any]) -> Any:
    settings = ai_config.get_web_settings()
    if not (settings["enabled"] and settings["api_key"]):
        return {"error": "Web research is not enabled. The user can turn it on in Settings."}

    if not ai_config.try_consume_web_quota():
        quota = ai_config.web_quota_status()
        return {
            "error": "quota_exceeded",
            "quota": quota,
            "note": (
                f"The daily web search quota ({quota['limit']}) is used up. Tell the "
                "user plainly and stop — do not retry with different queries."
            ),
        }

    query = str(a.get("query") or "").strip()
    if not query:
        return {"error": "query must not be empty"}
    max_results = max(1, min(int(a.get("max_results") or 5), 10))

    body = json.dumps({
        "query": query,
        "max_results": max_results,
        "search_depth": "basic",
    }).encode("utf-8")
    req = urllib.request.Request(
        TAVILY_SEARCH_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {settings['api_key']}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
            payload = json.loads(resp.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        return {"error": f"Search provider returned HTTP {exc.code}: {detail}"}
    except (urllib.error.URLError, TimeoutError) as exc:
        return {"error": f"Could not reach the search provider: {exc}"}
    except (json.JSONDecodeError, OSError) as exc:
        return {"error": f"Search provider returned an unreadable response: {exc}"}

    results = [
        {
            "title": r.get("title") or "",
            "url": r.get("url") or "",
            "snippet": r.get("content") or "",
            "published_date": r.get("published_date") or None,
        }
        for r in (payload.get("results") or [])
    ]
    quota = ai_config.web_quota_status()
    return {
        "query": query,
        "results": results,
        "count": len(results),
        "quota": quota,
        "note": (
            "These are snippets, not the pages themselves. Call read_web_page on "
            "anything you intend to actually use before stating what it says."
        ),
    }


def _extract_html_text(data: bytes, encoding: str | None) -> tuple[str, str]:
    html = data.decode(encoding or "utf-8", errors="replace")
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    title = (soup.title.string or "").strip() if soup.title and soup.title.string else ""
    text = soup.get_text(separator="\n", strip=True)
    return title, text


def _t_read_web_page(ctx: ToolContext, a: dict[str, Any]) -> Any:
    settings = ai_config.get_web_settings()
    if not (settings["enabled"] and settings["api_key"]):
        return {"error": "Web research is not enabled. The user can turn it on in Settings."}

    url = str(a.get("url") or "").strip()
    if not url.lower().startswith(("http://", "https://")):
        return {"error": "url must be a full http(s) address"}

    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
            content_type = (resp.headers.get_content_type() or "").lower()
            charset = resp.headers.get_content_charset()
            data = resp.read(MAX_DOWNLOAD_BYTES + 1)
            if len(data) > MAX_DOWNLOAD_BYTES:
                return {
                    "url": url,
                    "error": f"The file is larger than {MAX_DOWNLOAD_BYTES // 1_000_000} MB — too large to read inline.",
                }
    except urllib.error.HTTPError as exc:
        return {"url": url, "error": f"The page returned HTTP {exc.code} — it may require a login or no longer exist."}
    except (urllib.error.URLError, TimeoutError) as exc:
        return {"url": url, "error": f"Could not reach that page: {exc}"}

    is_pdf = "pdf" in content_type or url.lower().endswith(".pdf")
    title = ""
    if is_pdf:
        try:
            text = extract_pdf_text(data)
        except Exception as exc:
            return {"url": url, "content_type": "pdf", "error": f"Could not parse this PDF: {exc}"}
        if not text.strip():
            return {
                "url": url,
                "content_type": "pdf",
                "text": "",
                "note": (
                    "This PDF has no extractable text — it is very likely a scanned "
                    "image with no OCR layer underneath, which this tool cannot read. "
                    "Say that plainly rather than guessing at its contents from the "
                    "title or the search snippet."
                ),
            }
    else:
        title, text = _extract_html_text(data, charset)

    out: dict[str, Any] = {
        "url": url,
        "title": title,
        "content_type": "pdf" if is_pdf else "html",
    }
    # A long source is read in windows rather than cut off once. A research
    # paper or a digitised register index runs to tens of thousands of
    # characters, and a tool that can only ever show the opening turns the rest
    # of the source into something the model has no way to know it has not
    # read. Continuing costs another fetch and no quota — only `search_web`
    # spends that.
    total = len(text)
    start = max(0, min(int(a.get("offset") or 0), total))
    chunk = text[start:start + MAX_BODY_CHARS]
    out["text"] = chunk
    out["body_total_chars"] = total
    if start:
        out["body_offset"] = start
    if start + len(chunk) < total:
        out["body_truncated"] = True
        out["next_offset"] = start + len(chunk)
        out["note"] = (
            f"Showing characters {start}–{start + len(chunk)} of {total}. Call "
            f"read_web_page on the same url with offset={start + len(chunk)} to "
            "continue; if the part you need may be further in, read on rather than "
            "treating this excerpt as the whole document."
        )
    elif start:
        out["note"] = f"Showing characters {start}–{total} of {total} — the end of it."
    return out


def build_web_registry() -> ToolRegistry:
    r = ToolRegistry()

    r.register(Tool(
        name="search_web",
        description=(
            "Search the open internet for pages that might corroborate this "
            "family's history beyond what this project records — historical "
            "records, archives, name variants, place history. Returns titles, "
            "URLs and short snippets only, never full content: call "
            "read_web_page on anything before reporting what it says. Only "
            "available when the user has turned web research on in Settings; "
            "each call spends part of a daily quota they set themselves, so use "
            "a small number of specific queries (a name with a place or a year) "
            "rather than one per candidate."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "A specific query — a name plus a place or year works far better than a bare surname.",
                },
                "max_results": {"type": "integer", "description": "Default 5, max 10."},
            },
            "required": ["query"],
        },
        handler=_t_search_web,
    ))

    r.register(Tool(
        name="read_web_page",
        description=(
            "Read one web page or PDF in full — normally a URL returned by "
            "search_web. Extracts the actual text, including from PDFs; a "
            "scanned PDF with no OCR text layer is reported as unreadable "
            "rather than returned empty. A long source comes back one window at "
            "a time with the offset that continues it, so read on rather than "
            "stopping at the first excerpt. This is the only way to know what a "
            "page actually says — a search snippet is not enough to report as "
            "fact."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "The exact URL to fetch."},
                "offset": {
                    "type": "integer",
                    "description": (
                        "Character offset to read from, for a source longer than one "
                        "response. The result carries the total length and the "
                        "`next_offset` that continues it. Default 0."
                    ),
                },
            },
            "required": ["url"],
        },
        handler=_t_read_web_page,
    ))

    return r


WEB_REGISTRY = build_web_registry()
WEB_TOOL_NAMES = frozenset(t["name"] for t in WEB_REGISTRY.definitions())

"""A PDF's own text layer — one extractor, every caller.

A PDF is two different objects wearing one extension. A born-digital one — an
archive's search result saved to disk, a civil-registry printout, a local
history paper — carries its text inside the file, and pulling that out costs
nothing, sends nothing anywhere and cannot be misread. A photographed page
saved as a PDF carries no text at all, and the only way to read it is to show
it to a vision model: the document reader's paid, separately consented job.

Everything here is about the first kind. `pypdf` does no OCR, so an empty
result is the signal that a file is the *second* kind — never that the document
is empty. `MIN_TEXT_LAYER_CHARS` is where that line is drawn: a scanner leaves
the odd stray character or page-number artefact behind, and a handful of
characters is not a text layer.

Three callers share this so the threshold cannot drift apart between them:
`doc_reader` (skip the paid vision call when the text is already in the file),
`web_tools` (a PDF fetched from the open internet), and `tools` (a PDF attached
to a document in the project, read during a conversation).

**The cache is not an optimisation, it is what makes the chat paths viable.**
`search_text` with no query walks every document in the project, and so does
the written-material listing; without a cache each of those re-parses the whole
PDF library. The key carries the file's mtime and size as well as its path, so
a re-uploaded or corrected file is re-read rather than served stale, and the
cache is bounded so a large library cannot pin the whole corpus in memory.
"""

from __future__ import annotations

import io
from collections import OrderedDict
from pathlib import Path

from pypdf import PdfReader

#: Below this many characters the text layer is treated as absent rather than
#: as an empty document. See the module docstring.
MIN_TEXT_LAYER_CHARS = 120

#: Extraction stops here. Both are far past any single record a family
#: historian attaches, and they exist so one 4000-page book cannot stall a
#: conversation or fill memory. A stop is reported, never silently applied.
MAX_PAGES = 200
MAX_CHARS = 400_000

#: Files kept in the cache. Each entry is at most MAX_CHARS of text.
_CACHE_ENTRIES = 48

_cache: "OrderedDict[tuple[str, int, int], str]" = OrderedDict()


def is_pdf(mime_type: str | None, filename: str | None) -> bool:
    """A PDF by declared type or by name — either alone is unreliable.

    `mime_type` is whatever the browser sent at upload and is occasionally
    empty or `application/octet-stream`; a filename can be anything. Accepting
    either is what stops a perfectly readable file being written off.
    """
    if (mime_type or "").strip().lower() in {"application/pdf", "application/x-pdf"}:
        return True
    return (filename or "").strip().lower().endswith(".pdf")


def has_text_layer(text: str) -> bool:
    return len((text or "").strip()) >= MIN_TEXT_LAYER_CHARS


def _read(reader: PdfReader) -> str:
    if reader.is_encrypted:
        # An empty owner password is the common case for a PDF exported by an
        # archive with printing restrictions set: the text is not actually
        # protected, the file just declares itself encrypted. Anything with a
        # real password raises here and the caller reports it unreadable.
        reader.decrypt("")

    parts: list[str] = []
    total = 0
    for page in reader.pages[:MAX_PAGES]:
        try:
            chunk = page.extract_text() or ""
        except Exception:
            # One malformed page is not a reason to lose the other two hundred.
            continue
        if not chunk.strip():
            continue
        parts.append(chunk)
        total += len(chunk)
        if total >= MAX_CHARS:
            break
    return "\n\n".join(parts).strip()[:MAX_CHARS]


def extract_text(data: bytes) -> str:
    """Text layer of a PDF held in memory. Raises if the file cannot be parsed.

    The raising variant, for the caller that wants to tell the user *why* a
    fetched PDF could not be read.
    """
    return _read(PdfReader(io.BytesIO(data)))


def text_layer(path: Path) -> str:
    """Text layer of a PDF on disk, or "" — cached on (path, mtime, size).

    Never raises: an unreadable, encrypted or truncated file is indistinguishable
    from a scan here, and both mean the same thing to every caller — there is no
    text to be had without showing the page to a model.
    """
    try:
        st = path.stat()
    except OSError:
        return ""

    key = (str(path), st.st_mtime_ns, st.st_size)
    hit = _cache.get(key)
    if hit is not None:
        _cache.move_to_end(key)
        return hit

    try:
        text = _read(PdfReader(str(path)))
    except Exception:
        text = ""

    _cache[key] = text
    _cache.move_to_end(key)
    while len(_cache) > _CACHE_ENTRIES:
        _cache.popitem(last=False)
    return text

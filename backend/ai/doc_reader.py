"""Reading one scanned page, and reporting on a batch of them.

Two jobs live here, and they are deliberately different in kind:

* `read_file()` sends **one** file to the model and gets back a transcript.
  One shot, no tools, no history — see `provider.analyze_files`.
* `write_batch_report()` sends **no files at all**. By the time it runs, every
  page is already text and every candidate match against the tree has already
  been computed in Python (`transcriber.py`). The model is handed that finished
  table and asked only to write it up.

That split is the same discipline `tools.py` follows with `get_ancestors`: a
model chaining its own lookups across a family tree conflates same-named
people and drops generations, so the walk happens in code and the model gets
the result. Here the matching happens in code for the same reason — a page's
`relevance` is never something the model decided.

The transcript is stored as text and nothing re-reads the image afterwards.
That is what makes every existing path — `search_text`, `get_document`, the
primer's `material` marks — pick it up for free once a page is imported, and
it means the expensive call happens once per page rather than once per
question.
"""

from __future__ import annotations

import base64
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import config as ai_config
from .pdf_text import MIN_TEXT_LAYER_CHARS, text_layer as pdf_text_layer
from .provider import AnalysisResult, ProviderError, TurnComplete, build_provider

# Resolution *is* legibility here. A scan is sent **as it is** whenever it
# fits the budget below, because downscaling a register page is exactly the
# operation that turns a readable hand into a smear — and the obvious economy
# (shrink it, it is mostly paper) is the wrong trade for the one thing this
# feature exists to do. Only an image too large to send is resized, and then
# only as far as it has to be.
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_EDGE = 3000
JPEG_QUALITY = 92

# Formats a provider takes directly. Anything else (HEIC, TIFF, BMP) is
# re-encoded even when it is small enough to send.
PASSTHROUGH_MEDIA = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}

# The provider's own request ceiling is 32 MB; stay under it with room for the
# base64 expansion (~4/3) and the prompt.
MAX_UPLOAD_BYTES = 20 * 1024 * 1024

# A transcript of one dense page is maybe 1–2k tokens. The budget is an order
# of magnitude larger than that because **a reasoning model's thinking is
# charged against the same ceiling**: a real register photograph measured ~7.5k
# reasoning tokens before the first character of output, so a ceiling sized for
# the answer alone returns an empty string and a `length` stop. Clamped to what
# the chosen model actually allows.
MAX_OUTPUT_TOKENS = 32000

# The report's agent loop. Small on purpose: it is writing up a table it
# already has, so a handful of lookups on the strongest matches is the useful
# amount and anything more is the model exploring the tree on the user's money.
REPORT_MAX_ITERATIONS = 8
BATCH_TOOL_NAMES = {"read_page", "search_pages"}
STEP_PREVIEW_CHARS = 600

# A question is answered from the pages, so it needs room to open several — but
# it is one question, not a survey of the folder, and a loop that keeps going is
# a bill that keeps growing. Six rounds is enough to search, read two or three
# pages and check a person against the tree.
ASK_MAX_ITERATIONS = 6
# How many turns of the conversation travel back with the next question. Enough
# for "and the third entry?" to mean something; short enough that a long session
# does not quietly re-send an essay on every turn.
ASK_HISTORY_TURNS = 6

# Reading a page is not a reasoning task. High effort mostly buys thinking
# tokens here, which cost money and, on a tight ceiling, crowd out the answer.
READ_EFFORT = "medium"

PDF_EXTENSIONS = {".pdf"}
READABLE_IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp", ".heic", ".heif",
}


def supported_extensions() -> set[str]:
    return READABLE_IMAGE_EXTENSIONS | PDF_EXTENSIONS


@dataclass
class PageRead:
    """What one page yielded. `error` set means nothing was read."""
    text: str = ""
    extraction: dict[str, Any] | None = None
    language: str = ""
    method: str = ""            # 'text_layer' | 'vision'
    input_tokens: int = 0
    output_tokens: int = 0
    error: str = ""
    # Set when the provider said the failure was worth another go — an
    # overloaded endpoint (503) or a rate limit, not a bad request. The batch
    # job retries these rather than burning the page.
    retryable: bool = False


# ── prompts ───────────────────────────────────────────────────────────────────

TRANSCRIBE_SYSTEM = """You are transcribing a scanned historical record for a family historian.

The page is most likely a parish or civil register entry, a certificate, a letter or a page of an old book, in any of the scripts and languages such records were kept in — Latin, Hungarian, German (including Kurrent and Fraktur), Slovak, Church Slavonic. Read what is on the page. Do not translate the transcript, do not modernise its spelling, and do not tidy its grammar.

Answer in exactly this form, with the markers on their own lines and nothing before or after:

<<<LANG>>>
the document's own language, one word, lowercase

<<<ENTRIES>>>
A single number: how many separate entries or blocks of text this page holds. A register page usually rules them off from one another. A title page, a cover or a page with one continuous passage is `1`. Count what is on the page before you transcribe it, and then transcribe exactly that many.

<<<TRANSCRIPT>>>
**Every line on the page, from the first to the last.** This is the requirement that matters most: a page of forty lines yields forty lines here. Do not stop at the first entry, do not summarise a later one because it resembles an earlier one, and do not trail off with an ellipsis — a partial transcript is worse than none, because it looks complete to whoever reads it next.

Transcribe line by line, exactly as written. Keep the original spelling, abbreviations and word order. Mark an illegible word `[?]`, and a word you are reading but are not sure of `word[?]`. Do not fill a gap with what would plausibly have been there. Separate the entries you counted above with a blank line, in the order they appear on the page.

<<<DATA>>>
One JSON object, and nothing else, holding only what the page actually states:

{{
  "kind": "birth" | "baptism" | "marriage" | "death" | "burial" | "census" | "other" | "unknown",
  "date": "YYYY-MM-DD" or "YYYY-MM" or "YYYY" or null,
  "place": string or null,
  "register": string or null,
  "persons": [
    {{
      "role": "child" | "father" | "mother" | "groom" | "bride" | "godparent" | "witness" | "deceased" | "spouse" | "officiant" | "other",
      "first_name": string or null,
      "last_name": string or null,
      "age": number or null,
      "occupation": string or null,
      "religion": string or null,
      "residence": string or null,
      "note": string or null
    }}
  ],
  "remarks": string or null
}}

Rules for the JSON, and they matter more than completeness:

* **Keep each entry on its own line in the transcript, opening with the number the register prints beside it.** That numbering is what separates one record from the next downstream: a groom from the third entry and a bride from the seventh are not a couple, and only the line they sit on says so. A record that runs over several printed lines is still one line here.
* Give names in **parts**. A name you can only read as one blob goes in `first_name` with `last_name` null — never invent the split.
* Hungarian registers write the surname first. Put the surname in `last_name` whichever order the page uses.
* Give each name in its **nominative** form, even where the page inflects it. Latin registers decline names — a page reading `filius Stephani Nagyfalvi` records a father whose name is `Stephanus Nagyfalvi`. The transcript above keeps the page's own wording; this JSON is what gets matched against a family tree, and an inflected name matches nothing. Do not translate the name into another language while you do it.
* A field the page does not state is `null`. Never infer an age from a date, a religion from a parish, or a place from a surname.
* A name you could not read confidently keeps its `[?]` marks in the JSON too, so nothing downstream mistakes a guess for a reading.
* If the image is not a readable document at all — a blank page, a cover, a photograph — set `kind` to `"other"`, leave `persons` empty, and say so in `remarks`."""


REPORT_SYSTEM = """You are helping a family historian triage a folder of freshly transcribed records.

Every page has been read, and the application has already compared the names on each page against the family tree. **You are not being asked to match anyone.** The groups below were decided in code, from evidence you can see, and your job is to write them up honestly.

**Each page carries its full transcript in `transcript`, and the transcript is the only description of the page you have.** The fields beside it do not summarise it: `relevance`, `years_on_page` and `tree_matches` are what the application computed, not what the page says. Nothing tells you what an entry is, who is in it or what it records except the text — so read it. Where a page is marked `transcript_truncated`, call `read_page` before describing it. `search_pages` finds a word across the whole batch, and with no query lists every page — use it when a name in one entry seems to turn up in another.

**A page is not a record.** One page routinely holds a dozen numbered entries, each with its own date and its own people. Never speak of "the page" as though it were a single record, never carry a fact from one entry to another, and where you name a match say which entry it stands in — `tree_matches` gives `entry_no` for exactly that.

## What the groups mean — do not move a page between them

* `corroborated` — **two** people on the page matched by full name, in roles that assert a relationship (a father and his child, a bride and groom), and the tree already records that same relationship between them. This is the only group where a page may be described as being about people in the tree, and it is rare on purpose: it is the one kind of agreement a coincidence of naming cannot produce.

  `corroboration_summary` is that finding **already written in the answer's language, with both people already linked**. Use it as your reason — reproduce it, or fold it into your own sentence keeping its links intact. Do not re-describe it from the raw `corroboration` object beside it, and never quote a field name or an English value at the reader.
* `candidates` — one full name matched and a year on the page fits that person's lifespan. Worth a look, no more. Two facts agreeing is not an identification when one of them is a name.
* `weak` — a full name matched but nothing dates it: no usable year on the page, or none recorded for the person.
* `unrelated` — only a surname matched, or the dates **contradict** the match. Names in these rows still carry a `dates_note`; that is what tells the reader which lead to stop following.
* `unread` — not transcribed. Say so; do not characterise what it might contain.

## An age in the record dates the person, not just names them

An entry that calls someone 23 in 1876 has placed their birth around 1853 — a fact reached without reference to their name, and therefore the one piece of evidence on the page that a coincidence of naming cannot supply. Where the record states an age and the tree records a birth year, the arithmetic has already been done for you: `age_check` on a tree match holds `stated_age`, `record_year`, `implied_birth_year`, `recorded_birth_year`, `off_by` and a `verdict`.

* `agrees` — **say it, in the sentence that names the person.** "the entry calls him 23 in 1876, which puts his birth at 1853 — the year recorded for @[…](#pid-…)" tells the reader something a name never could. This is the strongest thing most pages will offer, and burying it in a list of names wastes it.
* `conflicts` — the match is ruled out by its own record. Say so plainly; a reader who stops following a false lead has been helped as much as one handed a true one.
* `unclear` — the two are a few years apart. Register ages are approximate, so this settles nothing: do not present it as agreement and do not present it as a refutation.
* No `age_check` at all — the record gave no age, or the tree holds no birth year. **Nothing follows from that.** An absent age is not agreement.

Read the ages of the *other* people in the same entry too — a father, a spouse, a witness — and use them the same way where the transcript states them. The arithmetic is only pre-computed for people the matching found.

**None of this moves a page between the groups above.** Those are decided in code. An age you checked is a reason you write, not a rung you climb.

## What to write

Answer in {lang_name}, in Markdown.

1. **Worth importing** — the `corroborated` pages only. One line each: what the entry is, its date, and — as the reason — **the relationship the record and the tree agree on, with both people named as links.** That agreement is the finding; the names alone would not be.
2. **Worth a look** — the `candidates`. Say plainly for each what is *missing*: a name and a plausible year agree, and nothing else does. Never write these as if the person were identified, and do not stack several weak agreements into a strong one — three namesakes on a page is what a village register looks like, not a discovery.
   Keep this section **short**: one line per page. If there are more than eight, give the strongest few and a count for the rest.
3. **Namesakes and near misses** — `weak` and `unrelated` pages worth a warning, especially anything carrying a `dates_note`. Summarise: this section is useful because it tells the reader what to stop chasing, not because it lists everything. A count plus the two or three most tempting false leads is right.
4. **What the batch contains** — a few sentences on the span of years, the places and the kinds of entry.
5. **Gaps** — pages that **failed**, named with their error so they can be retried. Pages merely not read yet get **one line with a count**, never a list: naming twenty files nobody has looked at buries the four that went wrong.

Where `coverage.partial` is true, **open with it**: how many pages of the batch have been read and how many have not, before anything else.

## Hard rules

* **A name match is not a link.** Write `@[Name](#pid-ID)` for a person in the tree so the reader can click through and check — but the surrounding sentence must make the strength clear. "matches the name of @[…](#pid-7), though nothing else places him there" is right; "belongs to @[…](#pid-7)" for the same evidence is wrong, and it is wrong even with a hedge attached, because the sentence still asserts the link.
* **Never write a name without its id.** Names repeat; the id is how the reader checks which person is meant.
* **Name pages by their filename.** They are turned into links afterwards, so write the filename plainly and do not wrap it in markup yourself.
* **Arithmetic before adjectives.** Where a year, an age or a span settles something, give the numbers and let them carry the sentence. "23 in 1876, so born about 1853" is checkable; "the dates are consistent" is not.
* **Write for the reader, not from the data.** Field names, group keys and their English values (`corroborated`, `dates_note`, `transcript_truncated`) are how this input is structured; none of them belong in the answer.
* Render every name as {name_order_hint} — the parts are stored in no particular display order.
* You have two sets of read-only tools. `read_page` and `search_pages` reach the batch's own transcripts — use them freely, they cost nothing and reading the record is the job. The project tools (`get_person` and the rest) look up what is *already recorded* about someone: a baptism you already hold as a fact is not a find, and a person whose page is empty is where a new record matters most. Two or three project lookups is the right amount; the tools are for **context about a match**, never for finding new ones.
* **Quote the record where it settles something.** A short phrase from the transcript, in its own words, is worth more than your summary of it — it lets the reader judge the reading as well as the conclusion.
* If a group is empty, say so in one line and move on.
* Do not add historical or regional colour, and do not infer a relationship between two people on a page because their names would fit one. Everything you write must come from the rows and the lookups."""


ASK_SYSTEM = """You are answering a family historian's question about one folder of scanned records they are reading.

{inventory}

That is the whole of what this folder holds. You have not been shown the pages — **you have to open them.** `search_pages` finds a word across every transcript in the folder, and with no query lists all of them with their filenames and sizes; `read_page` returns one page in full. Use them before answering anything about what the records say. The project tools (`get_person`, `get_ancestors`, `search_text` and the rest) look up what the family tree already records, which is how you tell a new record from one they already hold.

## How to answer

Answer in {lang_name}, in Markdown, at the length the question deserves — a factual question gets a short answer, not an essay with headings.

* **Read before you answer.** A question about the records is answered from the records. If you have not opened a page, you do not know what is on it, and "the folder does not contain that" is a claim about pages you have read — never about pages you have not.
* **Quote the record.** A short phrase in the register's own words is worth more than your summary of it, and it lets the reader judge the reading as well as the conclusion.
* **Name every page you refer to by its filename**, plainly. They become links afterwards; do not wrap them in markup yourself.
* **Write a person from the tree as `@[Name](#pid-ID)`**, so the reader can click through and check who is meant. Never a name without its id — names repeat.
* Render every name as {name_order_hint} — the parts are stored in no particular display order.

## What not to do

* **A name is not an identification.** A surname repeats across a village and a given name repeats within a family, so a page carrying a familiar name is a lead, not a find. Say what would settle it — a stated age against a recorded birth year, a relationship the entry asserts and the tree already holds — and say plainly when nothing does.
* **A page is not a record.** One page routinely holds a dozen numbered entries, each with its own date and its own people. Never carry a fact from one entry to another, and where you name something, say which entry it is in.
* **An age dates a person.** Where an entry states an age, subtract it from that entry's year and compare the result with the birth year the tree records. Agreement is worth stating; a gap of a few years settles nothing, because register ages are approximate; a large gap rules the person out.
* **Do not fill a gap.** An illegible word stays illegible, an entry that does not say something says nothing, and a page that has not been transcribed has no contents you may guess at.
* Do not add historical or regional colour, and do not infer a relationship between two people because their names would fit one."""


_LANG_NAMES = {"hu": "Hungarian", "en": "English"}


def _lang_name(lang: str) -> str:
    return _LANG_NAMES.get(lang, "English")


def _output_budget(model: str) -> int:
    """`MAX_OUTPUT_TOKENS`, never above what the model accepts."""
    cap = int(ai_config.model_caps(model).get("max_output") or MAX_OUTPUT_TOKENS)
    return max(4000, min(MAX_OUTPUT_TOKENS, cap))


# ── file → provider blocks ────────────────────────────────────────────────────

def _image_block(path: Path) -> dict[str, Any]:
    """The scan, at full resolution where that fits; resized only if it must be."""
    from PIL import Image
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:
        pass
    import io as _io

    suffix = path.suffix.lower()
    raw = path.read_bytes()

    # The common case: a JPEG or PNG straight off a scanner, small enough to
    # send untouched. No re-encode, no generation loss, nothing to tune.
    if suffix in PASSTHROUGH_MEDIA and len(raw) <= MAX_IMAGE_BYTES:
        return {
            "type": "image",
            "media_type": PASSTHROUGH_MEDIA[suffix],
            "data": base64.standard_b64encode(raw).decode("ascii"),
        }

    with Image.open(path) as im:
        im = im.convert("RGB")

        # Try full size first even for a format that must be re-encoded — a
        # 30 MB TIFF is often a 3 MB JPEG at the same pixel dimensions.
        def encode(image) -> bytes:
            buf = _io.BytesIO()
            image.save(buf, format="JPEG", quality=JPEG_QUALITY)
            return buf.getvalue()

        data = encode(im)
        edge = max(im.size)
        # Step down only as far as the budget requires, rather than jumping to
        # a fixed small size the moment the file is one byte too big.
        while len(data) > MAX_IMAGE_BYTES and edge > 1200:
            edge = min(int(edge * 0.8), MAX_IMAGE_EDGE)
            w, h = im.size
            scale = edge / max(w, h)
            resized = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
            data = encode(resized)

    return {
        "type": "image",
        "media_type": "image/jpeg",
        "data": base64.standard_b64encode(data).decode("ascii"),
    }


# ── response parsing ──────────────────────────────────────────────────────────

_SECTION_RE = re.compile(r"<<<(LANG|ENTRIES|TRANSCRIPT|DATA)>>>")


def parse_response(raw: str) -> tuple[str, str, dict[str, Any] | None]:
    """Split the delimited answer. Missing sections come back empty, never raise.

    The format is markers rather than a provider-native structured-output mode
    because it has to parse identically on both adapters, and because a
    response that runs long still yields a usable transcript instead of
    unparseable JSON — the transcript is the part worth salvaging.
    """
    sections: dict[str, str] = {}
    parts = _SECTION_RE.split(raw or "")
    # split() gives [preamble, NAME, body, NAME, body, ...]
    for i in range(1, len(parts) - 1, 2):
        sections[parts[i]] = parts[i + 1].strip()

    language = sections.get("LANG", "").split("\n")[0].strip().lower()[:40]
    transcript = sections.get("TRANSCRIPT", "")

    declared = None
    m = re.search(r"\d+", sections.get("ENTRIES", ""))
    if m:
        try:
            declared = max(0, min(int(m.group(0)), 200))
        except ValueError:
            declared = None

    extraction: dict[str, Any] | None = None
    data_raw = sections.get("DATA", "").strip()
    if data_raw:
        # Models occasionally wrap the object in a fence despite the instruction.
        fenced = re.search(r"```(?:json)?\s*(.+?)\s*```", data_raw, re.S)
        if fenced:
            data_raw = fenced.group(1)
        start, end = data_raw.find("{"), data_raw.rfind("}")
        if start != -1 and end > start:
            try:
                parsed = json.loads(data_raw[start:end + 1])
                if isinstance(parsed, dict):
                    extraction = parsed
            except json.JSONDecodeError:
                extraction = None

    # A model that ignored the markers entirely still read the page — keep what
    # it said rather than storing nothing.
    if not transcript and (raw or "").strip():
        transcript = (raw or "").strip()

    # What the model said was on the page, against what it actually wrote. The
    # instruction above is only an instruction; this is the part that makes a
    # short transcript *visible* instead of looking finished. Blocks are
    # blank-line separated, which is the separator the prompt asks for.
    if extraction is None and declared is not None:
        extraction = {}
    if extraction is not None:
        written = len([b for b in re.split(r"\n\s*\n", transcript.strip()) if b.strip()]) if transcript.strip() else 0
        coverage: dict[str, Any] = {"blocks_written": written}
        if declared is not None:
            coverage["entries_on_page"] = declared
            coverage["complete"] = written >= declared
        extraction["coverage"] = coverage

    return language, transcript, extraction


# ── the one public entry point per page ───────────────────────────────────────

async def read_file(path: Path, *, lang: str = "en") -> PageRead:
    """Read one file. Consumes one page of quota only when the model is called."""
    settings = ai_config.get_doc_settings()
    if not settings["enabled"]:
        return PageRead(error="Document reading is switched off.")
    if not settings["api_key"]:
        return PageRead(error="No API key configured for the document reader.")

    if not path.exists():
        return PageRead(error="File not found.")

    suffix = path.suffix.lower()
    if suffix not in supported_extensions():
        return PageRead(error=f"Unsupported file type: {suffix or '(none)'}")

    # A PDF that already carries its text costs nothing and cannot be misread.
    # `pdf_text` is shared with the chat assistant, which reads the same layer
    # out of an attached document — one threshold, one extractor.
    if suffix in PDF_EXTENSIONS:
        layer = pdf_text_layer(path)
        if len(layer) >= MIN_TEXT_LAYER_CHARS:
            return PageRead(text=layer, method="text_layer", language="")

    try:
        size = path.stat().st_size
    except OSError as e:
        return PageRead(error=f"Could not read the file: {e}")

    if suffix in PDF_EXTENSIONS:
        if size > MAX_UPLOAD_BYTES:
            return PageRead(error=(
                f"This PDF is {size // (1024 * 1024)} MB, over the "
                f"{MAX_UPLOAD_BYTES // (1024 * 1024)} MB the provider accepts. "
                "Split it into fewer pages."
            ))
        blocks = [{
            "type": "pdf",
            "media_type": "application/pdf",
            "data": base64.standard_b64encode(path.read_bytes()).decode("ascii"),
        }]
    else:
        # Only turn away a model the manifest *knows* cannot see. An id it has
        # never heard of is tried: a model released after this build would
        # otherwise be refused by the conservative unknown-model defaults, and
        # a provider that genuinely cannot take an image says so itself.
        if ai_config.model_known(settings["model"]) and not ai_config.model_caps(settings["model"]).get("vision"):
            return PageRead(error=(
                f"{settings['model']} is not a vision model — it cannot be shown a scan. "
                "Pick another model for the document reader."
            ))
        try:
            blocks = [_image_block(path)]
        except Exception as e:
            return PageRead(error=f"Could not open the image: {e}")

    # Structural, not advisory: checked here, before the outbound request, so a
    # runaway batch cannot spend past the cap however it is driven.
    if not ai_config.try_consume_doc_page():
        quota = ai_config.doc_quota_status()
        return PageRead(error=(
            f"This month's page budget is used up ({quota['used']}/{quota['limit']}). "
            "Raise it in the assistant settings to continue."
        ))

    blocks.append({"type": "text", "text": f"Transcribe this page. Filename: {path.name}"})

    provider = build_provider(
        settings["provider"], settings["api_key"], settings["base_url"], effort=READ_EFFORT,
    )
    result: AnalysisResult = await provider.analyze_files(
        model=settings["model"],
        system=TRANSCRIBE_SYSTEM.format(lang_name=_lang_name(lang)),
        blocks=blocks,
        max_tokens=_output_budget(settings["model"]),
    )
    if result.error is not None:
        return PageRead(error=result.error.message, retryable=result.error.retryable)

    language, transcript, extraction = parse_response(result.text)
    if not transcript:
        return PageRead(error="The model returned nothing for this page.")

    return PageRead(
        text=transcript,
        extraction=extraction,
        language=language,
        method="vision",
        input_tokens=result.usage.input_tokens,
        output_tokens=result.usage.output_tokens,
    )


def _text_job_settings() -> tuple[dict[str, Any] | None, str]:
    """Which provider does a text-in, text-out job.

    The split that matters here is perception versus prose. Reading a
    two-hundred-year-old hand is the first, and the document reader was chosen
    for it. Writing up a finished table is the second — that is the
    assistant's job,
    and the user picked that provider for exactly this. Falls back to the
    reader when the assistant has no key, so neither job simply stops.
    """
    assistant = ai_config.get_settings()
    if assistant["api_key"]:
        # `medium`, not `high`. Writing up a table that has already been decided
        # is not a reasoning task, and at high effort the report's agent loop
        # ran for minutes on a folder of two dozen transcripts — long enough
        # that the user could not tell it from a hang, which is its own defect.
        return assistant, "medium"
    reader = ai_config.get_doc_settings()
    if reader["api_key"]:
        return reader, READ_EFFORT
    return None, "high"


# ── the batch report ──────────────────────────────────────────────────────────

def build_batch_registry(read_db: Any, batch_id: int):
    """Tools that reach the batch's own transcripts.

    The report is handed the transcripts inline, but a folder can outgrow any
    inline budget, and a page trimmed to fit must not become a page that cannot
    be read. So the model gets the same two shapes the project tools already
    use: one that finds (`search_pages`) and one that opens (`read_page`).

    Read-only like everything else here — these only select.
    """
    from .tools import Tool, ToolContext, ToolRegistry, _norm
    from ..database import TranscriptPage

    registry = ToolRegistry()

    def _page(pid: int):
        return (
            read_db.query(TranscriptPage)
            .filter(TranscriptPage.id == pid, TranscriptPage.batch_id == batch_id)
            .first()
        )

    def _t_read_page(_ctx: ToolContext, a: dict[str, Any]) -> Any:
        pid = int(a["page_id"])
        page = _page(pid)
        if page is None:
            return {"error": f"No page with id {pid} in this batch"}
        if page.status != "done" or not (page.text or "").strip():
            return {
                "page_id": pid, "filename": page.filename, "status": page.status,
                "error": "This page has not been transcribed.",
                "note": "Say it has not been read; do not describe what it might contain.",
            }
        out: dict[str, Any] = {
            "page_id": pid, "filename": page.filename, "language": page.language,
            "transcript": page.text, "chars": len(page.text),
            "edited_by_hand": bool(page.edited),
        }
        if page.extraction:
            try:
                out["extraction"] = json.loads(page.extraction)
            except json.JSONDecodeError:
                pass
        return out

    def _t_search_pages(_ctx: ToolContext, a: dict[str, Any]) -> Any:
        query = _norm(a.get("query"))
        pages = (
            read_db.query(TranscriptPage)
            .filter(TranscriptPage.batch_id == batch_id, TranscriptPage.status == "done")
            .order_by(TranscriptPage.sort_order, TranscriptPage.id).all()
        )
        if not query:
            return {
                "pages": [
                    {"page_id": p.id, "filename": p.filename, "chars": len(p.text or ""),
                     "opening": " ".join((p.text or "").split())[:160]}
                    for p in pages
                ],
                "note": "Every transcribed page in this batch. read_page opens one in full.",
            }
        hits = []
        for p in pages:
            body = _norm(p.text or "")
            idx = body.find(query)
            if idx < 0:
                continue
            raw = p.text or ""
            start = max(0, idx - 100)
            hits.append({
                "page_id": p.id, "filename": p.filename,
                "excerpt": ("…" if start else "") + raw[start:idx + 260].strip() + "…",
            })
        if not hits:
            return {
                "hits": [], "searched_pages": len(pages),
                "note": (
                    "No transcript in this batch contains that wording. It searches "
                    "words, so a miss means this spelling is absent — old records "
                    "spell names many ways. Try another form, or read_page directly."
                ),
            }
        return {"hits": hits, "count": len(hits), "searched_pages": len(pages)}

    registry.register(Tool(
        name="read_page",
        description=(
            "Read one page of this batch of scans in full — its whole transcript, "
            "plus what was extracted from it. Use this for any page whose text was "
            "only partly included, and whenever you are about to describe a page's "
            "contents in detail."
        ),
        input_schema={
            "type": "object",
            "properties": {"page_id": {"type": "integer", "description": "Page id from the rows you were given"}},
            "required": ["page_id"],
        },
        handler=_t_read_page,
    ))
    registry.register(Tool(
        name="search_pages",
        description=(
            "Search the transcripts of this batch for a word or name, "
            "accent-insensitively. With no query, lists every transcribed page in "
            "the batch with its opening line."
        ),
        input_schema={
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Word or name; omit to list every page"}},
        },
        handler=_t_search_pages,
    ))
    return registry


async def _run_agent(
    *, system: str, first_message: str, history: list[dict[str, Any]] | None,
    settings: dict[str, Any], effort: str, read_db: Any, batch_id: int | None,
    max_iterations: int, should_stop: Any = None, what: str = "the report",
) -> tuple[str, str, list[dict[str, Any]]]:
    """The tool-use loop both the report and a question run through.

    Extracted the moment there were two callers rather than after they drifted:
    the loop owns four things that are easy to get subtly different — which
    registry a tool name is dispatched to, that a failing tool becomes a result
    instead of ending the run, that the stop flag is read between rounds and not
    mid-call, and that every call is recorded so the answer stays checkable.
    """
    from .tools import REGISTRY, ToolContext

    provider = build_provider(
        settings["provider"], settings["api_key"], settings["base_url"], effort=effort,
    )
    ctx = ToolContext(
        db=read_db,
        allow_private=ai_config.get_settings()["allow_private"],
    ) if read_db is not None else None

    # Two registries, not one merged constant: the project tools are the same
    # everywhere, while these are bound to one batch and exist only for the
    # length of this run.
    batch_registry = (
        build_batch_registry(read_db, batch_id)
        if ctx is not None and batch_id is not None else None
    )
    tools = REGISTRY.definitions() if ctx is not None else []
    if batch_registry is not None:
        tools = batch_registry.definitions() + tools

    messages: list[dict[str, Any]] = list(history or [])
    messages.append({"role": "user", "content": first_message})
    steps: list[dict[str, Any]] = []
    text_out = ""

    for _ in range(max_iterations):
        # Checked between rounds rather than mid-call: an HTTP request in flight
        # cannot be taken back, but a user who pressed stop should not have to
        # wait through seven more rounds of tool use to be heard.
        if should_stop is not None and should_stop():
            return text_out.strip(), f"Stopped before {what} was finished.", steps
        final = None
        error: ProviderError | None = None
        async for event in provider.stream_turn(
            model=settings["model"],
            system=[{"type": "text", "text": system}],
            messages=messages,
            tools=tools,
            max_tokens=_output_budget(settings["model"]),
        ):
            if isinstance(event, TurnComplete):
                final = event
            elif isinstance(event, ProviderError):
                error = event

        if error is not None:
            return text_out.strip(), error.message, steps
        if final is None:
            return text_out.strip(), f"The model returned nothing for {what}.", steps

        if final.text:
            text_out = final.text
        if not final.tool_uses:
            break

        messages.append({
            "role": "assistant", "content": final.text,
            "tool_calls": [{"id": tu.id, "name": tu.name, "input": tu.input} for tu in final.tool_uses],
        })
        results = []
        for tu in final.tool_uses:
            started = time.monotonic()
            try:
                if batch_registry is not None and tu.name in BATCH_TOOL_NAMES:
                    result = batch_registry.execute(tu.name, tu.input, ctx)
                else:
                    result = REGISTRY.execute(tu.name, tu.input, ctx)
                payload_out = json.dumps(result, ensure_ascii=False, default=str)
                is_error = False
            except Exception as exc:                       # a tool must not end the run
                payload_out = json.dumps({"error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False)
                is_error = True
            steps.append({
                "tool": tu.name,
                "input": tu.input,
                # A preview, not the payload: the steps are stored on the batch
                # row and a few full tool results would dwarf the report itself.
                "result_preview": payload_out[:STEP_PREVIEW_CHARS],
                "result_chars": len(payload_out),
                "is_error": is_error,
                "ms": int((time.monotonic() - started) * 1000),
            })
            results.append({"id": tu.id, "content": payload_out, "is_error": is_error})
        messages.append({"role": "tool_results", "results": results})

    return text_out.strip(), "", steps


async def write_batch_report(
    rows: dict[str, Any], *, lang: str = "en", name_order: str = "en",
    coverage: dict[str, Any] | None = None, read_db: Any = None,
    batch_id: int | None = None, should_stop: Any = None,
) -> tuple[str, str, list[dict[str, Any]]]:
    """Turn the finished per-page table into prose. Returns (report, error, steps).

    Unlike `read_file` this is an **agent loop**, not one shot: the table says
    which tree people a page matched, and what makes a match worth acting on is
    what is already recorded about them — which only the project can answer. So
    the model gets the same read-only tools the assistant uses and the calls it
    makes are recorded, both because the answer should stay checkable and
    because watching the lookups is how a user tells research from assertion.

    No file is sent here and no matching is asked for; see the module docstring.
    """
    if not rows:
        return "", "Nothing to report on.", []

    # Reading a page and writing up a batch are different jobs, so they use
    # different settings. The reader is chosen for how it reads handwriting;
    # the report is prose over text that has already been extracted, which is
    # the assistant's own job — and the user picked that provider for exactly
    # this kind of work. Falls back to the reader's provider when the
    # assistant has no key, so the batch still ends with a report.
    settings, effort = _text_job_settings()
    if settings is None:
        return "", "No API key configured.", []

    payload = json.dumps(
        {"coverage": coverage or {}, "groups": rows}, ensure_ascii=False, indent=1,
    )
    system = REPORT_SYSTEM.format(
        lang_name=_lang_name(lang),
        name_order_hint=("surname first, then given names" if name_order == "hu"
                         else "given names first, then surname"),
    )
    return await _run_agent(
        system=system, first_message=payload, history=None,
        settings=settings, effort=effort, read_db=read_db, batch_id=batch_id,
        max_iterations=REPORT_MAX_ITERATIONS, should_stop=should_stop,
        what="the report",
    )


async def answer_about_batch(
    question: str, *, history: list[dict[str, Any]] | None = None,
    lang: str = "en", name_order: str = "en", read_db: Any = None,
    batch_id: int | None = None, inventory: dict[str, Any] | None = None,
) -> tuple[str, str, list[dict[str, Any]]]:
    """One question about one folder of scans. Returns (answer, error, steps).

    The same loop and the same tools as the report, pointed at what the user
    actually wants to know rather than at a fixed write-up. It is deliberately
    **scoped to the batch** instead of being folded into the assistant: an
    un-imported page is working state, not project content — the export deletes
    it — and putting a folder of scans the user may yet throw away into the
    assistant's always-on corpus would change the answer to every unrelated
    question about the family.

    No new consent is involved. This sends transcript text to the provider
    already chosen for text work, which is what the report has always done; it
    is not a new kind of payload the way a photograph of a document is.
    """
    question = (question or "").strip()
    if not question:
        return "", "Ask a question first.", []

    settings, effort = _text_job_settings()
    if settings is None:
        return "", "No API key configured.", []

    system = ASK_SYSTEM.format(
        lang_name=_lang_name(lang),
        name_order_hint=("surname first, then given names" if name_order == "hu"
                         else "given names first, then surname"),
        inventory=json.dumps(inventory or {}, ensure_ascii=False),
    )
    return await _run_agent(
        system=system, first_message=question, history=history,
        settings=settings, effort=effort, read_db=read_db, batch_id=batch_id,
        max_iterations=ASK_MAX_ITERATIONS, what="the answer",
    )

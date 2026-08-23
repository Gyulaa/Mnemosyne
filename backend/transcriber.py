"""The batch job behind a folder of scans: read every page, then report.

Same shape as `scanner.py` — a daemon thread, progress in a lock-protected
dict, a `GET .../status` endpoint the UI polls — because a folder of register
photographs takes minutes to read and no request should be holding that open.

The run has three phases and they are strictly ordered:

1. **transcribe** — every pending page, one provider call each, committed as it
   goes so a crash costs one page rather than the batch.
2. **match** — pure Python. Every extracted name is compared against the tree
   and each page gets a `relevance` mark. No model is involved: given names
   repeat inside a family, and a model asked to rank two hundred pages against
   a tree it can only see in summary will conflate people confidently. The same
   reasoning put the ancestor walk in `ai/tools.py` rather than in the prompt.
3. **report** — the finished table goes to the model, which only writes it up.

Phase 3 starts on its own the moment phase 1 leaves no page unread. That is the
point of the batch: the user picks the folder, walks away, and comes back to a
report telling them which handful of entries are worth importing.

A stopped run does none of 2 and 3, and leaves the batch resumable — a partial
report over a partly-read folder is worse than no report, because it reads as a
statement about the whole folder.
"""

from __future__ import annotations

import asyncio
import json
import re
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from .ai import config as ai_config
from .ai import doc_reader
from .gedcom_import import _norm, _name_norms

# A page year this far outside a matched person's known lifespan is treated as
# a different person of the same name rather than as a new fact about them.
LIFESPAN_SLACK_YEARS = 5
# With no dates at all on either side there is nothing to check, so a name
# match still counts — but a match this far from any recorded year is noise.
MAX_YEAR_DISTANCE = 120

# How much transcript text the report may carry inline, in characters.
#
# This used to be 400 characters per page, which was a mistake worth naming:
# the point of the report is that something reads the records, and a dense
# register page cut to its first four hundred characters is 14% of the entry.
# The models this runs on hold hundreds of thousands of tokens, so a whole
# folder of transcripts is a small input — and input is the cheap half.
#
# Pages are still budgeted, because a folder can be arbitrarily large. What
# changed is that a page cut short says so *and* stays reachable: the report
# has a tool that fetches any page's full text on demand, so nothing in the
# batch is beyond it (the same reason `search_text` lists the whole corpus).
REPORT_TEXT_BUDGET = 200_000
REPORT_MIN_PAGE_CHARS = 1_200

# An overloaded endpoint is common on a free tier and says nothing about the
# page. Retrying in the job rather than leaving 28 pages half-read is the whole
# difference between "run it and walk away" and "sit and watch it".
PAGE_RETRIES = 2
RETRY_BACKOFF_SECONDS = (5, 20)

# Nothing here may run unbounded. The SDKs default to a ten-minute timeout and
# retry it twice, so a single hung call can hold the job — and the job holds a
# global "already running" flag — for half an hour. A daemon thread nobody can
# interrupt is worse than a call that fails and can be retried.
MAX_NOTE_CONFLICTS = 3
PAGE_TIMEOUT_SECONDS = 300
REPORT_TIMEOUT_SECONDS = 900


class _State:
    def __init__(self):
        self.lock = threading.Lock()
        self.running = False
        self.stop_requested = False
        self.batch_id: int | None = None
        self.phase = "idle"      # idle | transcribing | matching | analysing | done | failed
        self.processed = 0
        self.total = 0
        self.failed = 0
        self.current_name: str | None = None
        self.error: str | None = None
        self.started_at: float | None = None


_state = _State()
_thread: threading.Thread | None = None


def get_status() -> dict:
    with _state.lock:
        # Same reconciliation as `start_batch`, so the UI never shows a run
        # that no longer exists — and never disables the buttons because of one.
        alive = _thread is not None and _thread.is_alive()
        if _state.running and not alive:
            _state.running = False
            if _state.phase not in ("done", "failed"):
                _state.phase = "failed"
                _state.error = _state.error or "The run ended unexpectedly."
        return {
            "running": _state.running,
            "batch_id": _state.batch_id,
            "phase": _state.phase,
            "processed": _state.processed,
            "total": _state.total,
            "failed": _state.failed,
            "current_name": _state.current_name,
            "error": _state.error,
            # Elapsed seconds in the current phase. The analysis has no
            # progress to report between its rounds, so without this the UI
            # cannot tell "thinking" from "hung" — and neither could the user.
            "phase_seconds": int(time.time() - _state.started_at) if _state.started_at else None,
        }


def stop() -> tuple[bool, str]:
    with _state.lock:
        if not _state.running:
            return False, "No batch is running"
        _state.stop_requested = True
    return True, "Stop requested"


def start_batch(
    batch_id: int, session_factory, *, lang: str = "en", name_order: str = "en",
    analysis_only: bool = False, page_ids: list[int] | None = None,
) -> tuple[bool, str]:
    global _thread
    with _state.lock:
        if _state.running and _thread is not None and _thread.is_alive():
            return False, "A batch is already being read"
        if _state.running:
            # The flag outlived the worker: a crash before the `finally`, or a
            # process the reloader replaced under a daemon thread. Believing a
            # flag over the thread it describes locks the feature until the app
            # is restarted, with no way for the user to tell why.
            _state.error = None
            _state.phase = "idle"
        _state.running = True
        _state.stop_requested = False
        _state.batch_id = batch_id
        _state.phase = "analysing" if analysis_only else "transcribing"
        _state.processed = 0
        _state.total = 0
        _state.failed = 0
        _state.current_name = None
        _state.error = None
        _state.started_at = time.time()

    _thread = threading.Thread(
        target=_run,
        args=(batch_id, session_factory, lang, name_order, analysis_only, page_ids),
        daemon=True,
        name="doc-transcriber",
    )
    _thread.start()
    return True, "Started"


# ── given-name variants ───────────────────────────────────────────────────────
#
# A register writes the name the sentence needs, not the name the person had:
# `filius Stephani Nagyfalvi` is a page about a man called Stephanus. And the
# tree holds `István`, because that is what the family calls him. Neither
# matches the other as stored.
#
# The transcription prompt does ask for the nominative, and often gets it — but
# a prompt instruction is not a mechanism, and this one is ignored often enough
# to matter. So the normalisation happens here, in code, where it is the same
# every time: the same reasoning that keeps the relevance marks out of the
# model's hands.
#
# Everything below is **additive**. A variant is an extra key to match on, never
# a replacement, so a name these rules do not understand is left exactly as it
# was rather than mangled.

# Latin case endings, longest first so `-is` is tried before `-i`. Applied to
# given names only: Hungarian surnames ending in -i (a place-name suffix) are
# far too common to strip.
_LATIN_ENDINGS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("orum", ()),
    ("onis", ("o",)),
    ("ibus", ()),
    ("arum", ()),
    ("ae", ("a",)),               # Mariae    -> Maria
    ("is", ("es", "is")),         # Joannis   -> Joannes
    ("um", ("us",)),              # Josephum  -> Josephus
    ("o", ("us", "o")),           # Stephano  -> Stephanus
    ("i", ("us",)),               # Stephani  -> Stephanus
    ("am", ("a",)),               # Mariam    -> Maria
    ("e", ("a", "us")),           # Anne      -> Anna
)

# The vernacular equivalents that actually recur in Hungarian parish registers.
# Deliberately short: a long list of rare pairs buys little and every wrong pair
# is a false match. Latin form on the left, keyed lowercase and unaccented.
_LATIN_HU: dict[str, tuple[str, ...]] = {
    "stephanus": ("istvan",), "joannes": ("janos",), "johannes": ("janos",),
    "josephus": ("jozsef",), "georgius": ("gyorgy",), "andreas": ("andras",),
    "franciscus": ("ferenc",), "michael": ("mihaly",), "paulus": ("pal",),
    "petrus": ("peter",), "ladislaus": ("laszlo",), "carolus": ("karoly",),
    "nicolaus": ("miklos",), "martinus": ("marton",), "antonius": ("antal",),
    "adamus": ("adam",), "matthias": ("matyas",), "gregorius": ("gergely",),
    "emericus": ("imre",), "alexander": ("sandor",), "danielus": ("daniel",),
    "elias": ("illes",), "lucas": ("lukacs",), "thomas": ("tamas",),
    "maria": ("maria",), "anna": ("anna",), "elisabetha": ("erzsebet",),
    "catharina": ("katalin",), "helena": ("ilona",), "susanna": ("zsuzsanna",),
    "theresia": ("terezia",), "julianna": ("julianna",), "eva": ("eva",),
    "barbara": ("borbala",), "agnes": ("agnes",), "sophia": ("zsofia",),
    "rosalia": ("rozalia",), "margaretha": ("margit",), "veronica": ("veronika",),
    "clara": ("klara",), "magdalena": ("magdolna",), "apollonia": ("apollonia",),
}

# The same table read the other way, so a tree holding `István` reaches a page
# holding `Stephani` without either side having to be the canonical one.
_HU_LATIN: dict[str, list[str]] = {}
for _lat, _hus in _LATIN_HU.items():
    for _hu in _hus:
        _HU_LATIN.setdefault(_hu, []).append(_lat)


def _given_variants(given: str | None) -> set[str]:
    """Every normalised form one given name might be recorded under.

    Handles a name written as several given names by expanding each word, so
    `Anna Maria` reaches both `anna` and `maria` as well as the pair.
    """
    base = _norm(given)
    if not base:
        return set()

    out = {base}
    for word in base.split():
        forms = {word}
        for ending, replacements in _LATIN_ENDINGS:
            if len(word) > len(ending) + 1 and word.endswith(ending):
                stem = word[: -len(ending)]
                forms.update(stem + r for r in replacements)
                break                      # longest ending wins; do not cascade
        # Cross the language boundary in both directions, including from a form
        # that only appeared after undoing a case ending.
        for f in list(forms):
            forms.update(_LATIN_HU.get(f, ()))
            forms.update(_HU_LATIN.get(f, ()))
        out.update(forms)
    return {f for f in out if f}


def _match_norms(first: str | None, last: str | None, raw: str | None = None) -> set[str]:
    """`_name_norms` widened across the given-name variants.

    Surnames go through untouched — see the note on `-i` above.
    """
    norms = _name_norms(first, last, raw)
    for variant in _given_variants(first):
        norms |= _name_norms(variant, last, None)
    return norms


# ── the tree side of the match ────────────────────────────────────────────────

# Roles on a page that, taken as a pair, assert a relationship. This is the
# evidence that outranks a name: a name says "someone with this name"; a pair
# of names in the right roles says "these two, and they are connected", and a
# tree that already holds that connection is corroborating something a
# coincidence of naming cannot reach.
_PARENT_ROLES = {"father", "mother"}
_CHILD_ROLES = {"child"}
_SPOUSE_ROLES = {"groom", "bride", "spouse"}


def _relation_index(db) -> dict[str, dict[int, set[int]]]:
    """Parent, spouse and sibling edges, both directions, as id sets."""
    from .database import Relation as DBRelation

    parents: dict[int, set[int]] = {}
    children: dict[int, set[int]] = {}
    spouses: dict[int, set[int]] = {}
    siblings: dict[int, set[int]] = {}
    for r in db.query(DBRelation).all():
        a, b = r.person_a_id, r.person_b_id
        if r.type == "parent":                 # a is the parent of b
            parents.setdefault(b, set()).add(a)
            children.setdefault(a, set()).add(b)
        elif r.type == "spouse":
            spouses.setdefault(a, set()).add(b)
            spouses.setdefault(b, set()).add(a)
        elif r.type == "sibling":
            siblings.setdefault(a, set()).add(b)
            siblings.setdefault(b, set()).add(a)
    return {"parents": parents, "children": children, "spouses": spouses, "siblings": siblings}


def _corroborating_relation(
    matches: list[dict[str, Any]], rel: dict[str, dict[int, set[int]]],
) -> dict[str, Any] | None:
    """Does a pair of people on this page mirror an edge in the tree?

    Returns **who**, not a sentence: the kind of relationship, the two roles as
    the page gives them, and both people with their ids and name parts. A prose
    string could not be rendered in the user's language and could not be linked
    to the people it names — and a report that announces a corroborated pair
    without naming which pair is not checkable, which is the whole point.

    Only full-name matches count; a surname pair proves nothing about two
    particular people.
    """
    named = [m for m in matches if m.get("match") == "name" and m.get("dates") != "conflict"]

    def same_entry(a: dict[str, Any], b: dict[str, Any]) -> bool:
        """Are these two people part of the *same* record on the page?

        This guard is the difference between evidence and nonsense. A register
        page holds many entries, and pairing a groom from one with a bride from
        another found a couple who are indeed spouses in the tree and were never
        a couple on that page — the strongest signal the system has, made out of
        two unrelated lines.

        `entry_index` comes from the transcript itself, so a page that does not
        divide into records leaves it `None` on both sides and no pairing is
        made. Refusing is the right answer there: two names on a page nobody can
        cut into entries is precisely the case that produced the false find.
        """
        ia, ib = a.get("entry_index"), b.get("entry_index")
        return ia is not None and ia == ib

    def found(kind: str, a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
        return {
            "kind": kind,
            "roles": [a.get("role_on_page"), b.get("role_on_page")],
            # Which record on the page it was found in, as the register numbers
            # it — a page holding a dozen entries needs saying which.
            "entry_no": a.get("entry_no"),
            "persons": [
                {"person_id": x["person_id"], "first_name": x.get("first_name"),
                 "last_name": x.get("last_name"), "role_on_page": x.get("role_on_page")}
                for x in (a, b)
            ],
        }

    for i, a in enumerate(named):
        for b in named[i + 1:]:
            if a["person_id"] == b["person_id"] or not same_entry(a, b):
                continue
            ra, rb = (a.get("role_on_page") or ""), (b.get("role_on_page") or "")
            pair = {ra, rb}

            # a parent and a child, both named, and the tree holds that edge
            if pair & _PARENT_ROLES and pair & _CHILD_ROLES:
                parent = a if ra in _PARENT_ROLES else b
                child = b if ra in _PARENT_ROLES else a
                if parent["person_id"] in rel["parents"].get(child["person_id"], set()):
                    return found("parent_child", parent, child)

            # two spouses, and the tree holds the marriage
            if ra in _SPOUSE_ROLES and rb in _SPOUSE_ROLES:
                if b["person_id"] in rel["spouses"].get(a["person_id"], set()):
                    return found("spouses", a, b)

            # two children on one page who are siblings, or share a parent
            if ra in _CHILD_ROLES and rb in _CHILD_ROLES:
                if b["person_id"] in rel["siblings"].get(a["person_id"], set()):
                    return found("siblings", a, b)
                if rel["parents"].get(a["person_id"], set()) & rel["parents"].get(b["person_id"], set()):
                    return found("shared_parent", a, b)
    return None


def _tree_index(db) -> list[dict[str, Any]]:
    """Every person, with their name variants pre-normalised.

    `persons` has no `is_private` column — a person is never private, only
    their notes, documents and relations are (see README → Privacy
    enforcement) — so nothing is filtered out here.
    """
    from .database import Person as DBPerson

    out: list[dict[str, Any]] = []
    for p in db.query(DBPerson).all():
        norms = _match_norms(p.first_name, p.last_name, p.name)
        if not norms:
            continue
        out.append({
            "id": p.id,
            "first_name": p.first_name,
            "last_name": p.last_name,
            "birth_year": p.birth_year,
            "death_year": p.death_year,
            "norms": norms,
            "surname_norm": _norm(p.last_name),
        })
    return out


_YEAR_RE = re.compile(r"\b(1[4-9]\d{2}|20\d{2})\b")


def _page_years(extraction: dict[str, Any] | None, transcript: str) -> list[int]:
    """Every year this page could be about.

    The extraction's `date` is the best answer when it has one — but it often
    does not, and treating that as "the page has no date" is how a 19th-century
    register entry came to be scored against people born in the 20th. The
    transcript is right there and full of years, so it is read too: an absent
    field is not an absent fact, which is the rule the rest of this codebase
    already lives by.
    """
    years: list[int] = []
    raw = (extraction or {}).get("date")
    if isinstance(raw, str) and raw[:4].isdigit():
        years.append(int(raw[:4]))
    for match in _YEAR_RE.finditer(transcript or ""):
        year = int(match.group(0))
        if year not in years:
            years.append(year)
    return years


def _year_verdict(person: dict[str, Any], years: list[int]) -> tuple[str, str]:
    """Does this page's dating support, contradict, or say nothing about them?

    Returns one of "fits" | "unknown" | "conflict", with a note for the last.

    The three are deliberately not two. A name that matches with *nothing*
    corroborating it is a candidate, not a find — a surname repeats across a
    village and a given name repeats within a family — so "unknown" must never
    be scored as agreement. That conflation is what put a disciplinary record
    from the 1860s under "worth importing" against a man born in 1920.
    """
    birth, death = person.get("birth_year"), person.get("death_year")
    if not years or (birth is None and death is None):
        return "unknown", ""

    lo = (birth - LIFESPAN_SLACK_YEARS) if birth is not None else None
    hi = (death + LIFESPAN_SLACK_YEARS) if death is not None else None
    anchor = birth if birth is not None else death

    for year in years:
        if lo is not None and year < lo:
            continue
        if hi is not None and year > hi:
            continue
        if anchor is not None and abs(year - anchor) > MAX_YEAR_DISTANCE:
            continue
        return "fits", ""

    nearest = min(years, key=lambda y: abs(y - (anchor or y)))
    if birth is not None and nearest < birth:
        return "conflict", f"the page ({nearest}) predates the recorded birth ({birth})"
    if death is not None and nearest > death:
        return "conflict", f"the page ({nearest}) postdates the recorded death ({death})"
    return "conflict", f"the page ({nearest}) is generations away from this person's dates"


# ── the page, cut into the records it is made of ─────────────────────────────
#
# A register page is not a record. The page in front of the reader can hold a
# dozen separate marriages, and anything that pairs two people must establish
# they stand in the *same* entry — otherwise it manufactures relationships out
# of unrelated lines. That is not hypothetical: a groom from one entry and a
# bride from another, spouses in the tree and never a couple on that page, were
# reported as the strongest kind of evidence the system can produce.
#
# The entry number was first asked of the extraction, and the extraction is the
# wrong place to ask: it is an index of the page, written by the same model, and
# it does not exist for pages read before the question was added. The transcript
# carries the register's own numbering, in the register's own layout — one
# numbered line per entry — for every page ever read. So the segmentation is
# taken from the text, where the reader can check it against the scan by eye.

_ENTRY_LINE = re.compile(r"^\s*(\d{1,3})\s*[.)]?\s+(?=\S)")


_NON_WORD = re.compile(r"[^a-z0-9]+")


def _hay(text: str) -> str:
    """Normalised, punctuation-flattened and space-padded.

    Everything that is not a letter or a digit becomes a space, so a name
    matches on word boundaries and survives what a transcript actually contains
    around it: the `|` a table's columns are separated by, the comma between two
    witnesses, and the `[?]` an uncertain reading carries.
    """
    return " " + _NON_WORD.sub(" ", _norm(text)).strip() + " "


def _padded(norms) -> set[str]:
    return {_hay(n) for n in norms if n}


class _Entry:
    """One record on the page: its text, and the years written inside it.

    The years matter as much as the boundary. A page spanning several years
    gives every person on it a window that wide to "fit" into; an entry gives
    them the one year the entry was actually written in.
    """

    __slots__ = ("index", "number", "text", "hay", "years")

    def __init__(self, index: int, number, text: str):
        self.index = index
        self.number = number
        self.text = text
        self.hay = _hay(text)
        self.years = list(dict.fromkeys(int(m.group(0)) for m in _YEAR_RE.finditer(text)))


def _entry_blocks(transcript: str) -> "list[_Entry] | None":
    """The page cut into its numbered entries, or `None` where it does not divide.

    Numbering restarts at each year heading, so *position* identifies an entry
    and the printed number is only ever shown to the reader. A line not opening
    with a number continues the entry above it; the lines before the first
    number are the page's column headings, not a record. Fewer than two entries
    means the page did not divide — and an undivided page is not assumed to be
    one record, because that assumption is exactly the bug.
    """
    if not transcript:
        return None
    entries: "list[_Entry]" = []
    for line in transcript.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        m = _ENTRY_LINE.match(line)
        if m:
            entries.append(_Entry(len(entries), int(m.group(1)), stripped))
        elif entries:
            last = entries[-1]
            entries[-1] = _Entry(last.index, last.number, f"{last.text} {stripped}")
    return entries if len(entries) >= 2 else None


def _locate(padded: set[str], entries) -> list:
    """Which entries on the page actually spell this name out."""
    if not entries:
        return []
    return [e for e in entries if any(n in e.hay for n in padded)]


def _place(first, last, entries) -> "int | None":
    """The one entry on the page that spells this name out, or `None`.

    Not a substring search for the whole name: a transcript of a register is a
    **table**, and a person's surname and given name live in different columns
    with the row's other cells between them. What identifies the row is that
    both parts are written somewhere in it.

    Ambiguity is answered with `None` rather than a guess. A name whose parts
    appear in three entries places the person in none of them — everything this
    number is used for (which year dates the match, and whether two people stand
    in one record) is worse than useless when it is wrong.
    """
    if not entries:
        return None
    givens = _padded(_given_variants(first))
    surname = _hay(_norm(last)) if _norm(last) else None
    if not givens or not surname:
        return None
    hits = [e.index for e in entries if surname in e.hay and any(g in e.hay for g in givens)]
    return hits[0] if len(hits) == 1 else None


def _extracted_people(extraction, entries) -> list[dict]:
    """The extraction's people, each placed in an entry by the transcript.

    The extraction stays because it does something the text cannot be searched
    for: it reads a table and says which cells make up one person's name. What
    it no longer does is say which *record* that person belongs to — that is
    read back off the transcript, where the register's own numbering is, and
    where the reader can check it against the scan.
    """
    out: list[dict] = []
    for person in ((extraction or {}).get("persons") or []):
        if not isinstance(person, dict):
            continue
        norms = {n for n in _match_norms(person.get("first_name"), person.get("last_name")) if " " in n}
        if not norms:
            continue
        out.append({
            "norms": norms,
            "role": person.get("role"),
            "age": person.get("age"),
            "entry": _place(person.get("first_name"), person.get("last_name"), entries),
        })
    return out


# How far an implied birth year may sit from the recorded one and still agree.
# One year, because a register states the age someone had reached, not the age
# they were born into: a birthday later in the year moves the arithmetic by one.
# A stated age agrees with a recorded birth year within this many years. One,
# because a register states the age someone had reached, not the age they were
# born into: a birthday later in the year moves the arithmetic by one.
AGE_TOLERANCE = 1
# And it only *contradicts* one beyond this. Ages in a parish register are
# routinely approximate — rounded, remembered, or guessed by the clerk — so a
# gap of two or three years is a reason to say nothing, not a refutation. Same
# slack, and the same reasoning, as LIFESPAN_SLACK_YEARS.
AGE_SLACK_YEARS = 5


def _age_check(person: dict[str, Any], age: Any, record_year: int | None) -> dict[str, Any] | None:
    """What a stated age says about a match, where the record carries a year.

    An entry calling someone 23 in 1876 has dated their birth to about 1853 —
    a fact about that person arrived at without reference to their name. Where
    the tree records a birth year, the two can simply be compared, and that is
    the cheapest evidence on a page: it comes free with the reading, it is
    arithmetic rather than judgement, and it cuts both ways.

    Three outcomes, not two. `agrees` is a second fact standing beside the name.
    `conflicts` rules the match out however well the name fits. In between is
    `unclear`, and it has to exist: a register's ages are approximate, so a gap
    of two or three years is not evidence of anything and must not be allowed
    to look like either an agreement or a refutation.

    Returns `None` where nothing can be concluded at all — no age written, no
    year on the record, or no birth year recorded for the person. An absent age
    is not agreement, which is the rule the rest of this pass already lives by.
    """
    if not isinstance(age, (int, float)) or isinstance(age, bool):
        return None
    age = int(age)
    if not 0 <= age <= 120:
        return None
    birth = person.get("birth_year")
    if not record_year or not birth:
        return None
    implied = int(record_year) - age
    off_by = abs(implied - int(birth))
    if off_by <= AGE_TOLERANCE:
        verdict = "agrees"
    elif off_by > AGE_SLACK_YEARS:
        verdict = "conflicts"
    else:
        verdict = "unclear"
    return {
        "stated_age": age,
        "record_year": int(record_year),
        "implied_birth_year": implied,
        "recorded_birth_year": int(birth),
        "off_by": off_by,
        "verdict": verdict,
    }


def _match_page(
    extraction: dict[str, Any] | None, transcript: str, tree: list[dict[str, Any]],
    relations: dict[str, dict[int, set[int]]] | None = None,
) -> dict[str, Any]:
    """One page against the whole tree. Deterministic, no model involved.

    Names arrive from two places and are treated the same once they do: the
    extraction, which can assemble a name out of a table's columns, and the
    transcript itself, which carries names the extraction left out. Neither is
    trusted about *structure* — which record a person stands in, and what year
    that record was written, are read off the transcript's own numbering.
    """
    text = transcript or ""
    entries = _entry_blocks(text)
    if entries is None:
        # A page the model itself says holds a single entry *is* one record, and
        # is the only case where an undivided page may be treated as one.
        declared = ((extraction or {}).get("coverage") or {}).get("entries_on_page")
        if isinstance(declared, int) and declared <= 1:
            entries = [_Entry(0, None, text)]

    page_years = _page_years(extraction, text)
    hay = _hay(text)
    extracted = _extracted_people(extraction, entries)

    matches: list[dict[str, Any]] = []
    occurrences: set[tuple[int, Any]] = set()
    best = "none"
    notes: list[str] = []

    def add(person: dict[str, Any], entry_index, role, age=None) -> None:
        nonlocal best
        if (person["id"], entry_index) in occurrences:
            return
        occurrences.add((person["id"], entry_index))
        entry = entries[entry_index] if (entries and entry_index is not None) else None
        # An entry's own year, not the page's. A page spanning eight years lets
        # every person on it "fit" one of them; the record they are actually in
        # was written once.
        years = entry.years if (entry is not None and entry.years) else page_years
        # The year to date an age against has to be *this record's*. A page
        # spanning eight years has no single year, so an unplaced person gets
        # the age check only where the whole page carries one year anyway.
        if entry is not None and entry.years:
            record_year = entry.years[0]
        else:
            distinct = list(dict.fromkeys(page_years))
            record_year = distinct[0] if len(distinct) == 1 else None
        verdict, why = _year_verdict(person, years)
        # No level above `medium` is reachable from a name, however exactly it
        # agrees and however well the dates fit. Given names repeat within a
        # family and surnames across a village, so a name is a pointer, not a
        # finding — `high` is granted below, and only where the *record*
        # corroborates something the tree already holds.
        level = {"fits": "medium", "unknown": "low", "conflict": "none"}[verdict]
        # An age is more specific than a lifespan, so it overrules one. "A year
        # on this page falls somewhere inside their life" is nearly free; "the
        # record says 23 and the tree says born 1853" is a second fact.
        age_check = _age_check(person, age, record_year)
        if age_check is not None and age_check["verdict"] == "agrees":
            verdict, level = "age-fits", "medium"
            why = ""
        elif age_check is not None and age_check["verdict"] == "conflicts":
            verdict, level = "age-conflict", "none"
            why = (
                f"the record's age ({age_check['stated_age']}) in "
                f"{age_check['record_year']} implies a birth around "
                f"{age_check['implied_birth_year']}, not "
                f"{age_check['recorded_birth_year']}"
            )
        if why:
            notes.append(
                f"{person['last_name'] or ''} {person['first_name'] or ''}".strip() + f": {why}"
            )
        if level == "none":
            return
        matches.append({
            "person_id": person["id"],
            "first_name": person["first_name"],
            "last_name": person["last_name"],
            "birth_year": person["birth_year"],
            "death_year": person["death_year"],
            "role_on_page": role,
            # Which record on the page, and what the register numbers it.
            "entry_index": entry_index,
            "entry_no": entry.number if entry is not None else None,
            "match": "name",
            # What the level rests on, so the write-up can state it rather than
            # assert a link the reader has no way to weigh.
            "dates": verdict,
            "dates_note": why or None,
            # The arithmetic, so the write-up can state it instead of doing it.
            "age_check": age_check,
            "level": level,
        })
        best = _stronger(best, level)

    # 1. the names the extraction assembled out of the page's columns
    for record in extracted:
        for person in tree:
            if record["norms"] & person["norms"]:
                add(person, record["entry"], record["role"], record.get("age"))

    # 2. the names written plainly in the transcript. A page the extraction read
    #    thinly is still a page with names on it, and a prose entry — as opposed
    #    to a ruled table — spells them out where they can simply be found.
    for person in tree:
        hits = {n for n in person["norms"] if " " in n and _hay(n) in hay}
        if not hits:
            continue
        padded = _padded(hits)
        spots = [e.index for e in (entries or []) if any(n in e.hay for n in padded)]
        entry_index = spots[0] if len(spots) == 1 else None
        # Prefer an extracted record that actually assigns a role: the role is
        # what a pairing is made of, and a same-name record without one would
        # otherwise shadow the one that has it.
        candidates = [r for r in extracted if r["norms"] & hits]
        stated = next((r for r in candidates if r.get("role")), None) or (
            candidates[0] if candidates else {}
        )
        add(person, entry_index, stated.get("role"), stated.get("age"))

    # No full name anywhere — the transcript may still carry a family surname.
    # Worth surfacing the page, never enough to claim a match.
    if best == "none" and text:
        seen: set[int] = set()
        for person in tree:
            sn = person["surname_norm"]
            if sn and len(sn) >= 3 and _hay(sn) in hay and person["id"] not in seen:
                seen.add(person["id"])
                matches.append({
                    "person_id": person["id"],
                    "first_name": person["first_name"],
                    "last_name": person["last_name"],
                    "birth_year": person["birth_year"],
                    "death_year": person["death_year"],
                    "role_on_page": None,
                    "entry_index": None,
                    "entry_no": None,
                    "match": "surname-in-text",
                    "age_check": None,
                    "level": "none",
                })
        if seen:
            notes.append("only a surname matched on this page")

    # Corroboration runs over every occurrence, before they are collapsed: one
    # person can legitimately stand in two entries on a page, and it is the
    # occurrence — not the person — that a pairing is made of.
    corroboration = _corroborating_relation(matches, relations) if relations else None
    if corroboration:
        best = "high"

    # For display, the strongest occurrence per person is the whole story.
    deduped: dict[int, dict[str, Any]] = {}
    for m in matches:
        prev = deduped.get(m["person_id"])
        if prev is None or _stronger(prev["level"], m["level"]) == m["level"]:
            deduped[m["person_id"]] = m
    ordered = sorted(deduped.values(), key=lambda m: m["person_id"])

    # The reason for the mark goes first and is never trimmed away. One name on
    # a page can collide with a dozen namesakes, and a note that is a wall of
    # "predates the recorded birth" buries the one line saying why the page
    # matters at all — which is the line the user is reading the note for.
    conflicts = list(dict.fromkeys(notes))
    parts = conflicts[:MAX_NOTE_CONFLICTS]
    if len(conflicts) > MAX_NOTE_CONFLICTS:
        parts.append(f"…and {len(conflicts) - MAX_NOTE_CONFLICTS} further namesakes ruled out by date")

    return {
        "relevance": best,
        "note": "; ".join(parts)[:800] or None,
        "corroboration": corroboration,
        "matches": ordered,
    }


_ORDER = {"none": 0, "low": 1, "medium": 2, "high": 3}


def _stronger(a: str, b: str) -> str:
    return a if _ORDER.get(a, 0) >= _ORDER.get(b, 0) else b


def rematch(db, batch_id: int) -> int:
    """Re-score every read page of a batch. Returns how many marks changed.

    Pure Python over data already stored, so it runs inline on the request
    rather than through the job — there is nothing to poll and nothing to bill.
    """
    from .database import TranscriptPage

    tree = _tree_index(db)
    relations = _relation_index(db)
    changed = 0
    pages = db.query(TranscriptPage).filter(TranscriptPage.batch_id == batch_id).all()
    for page in pages:
        if page.status != "done":
            if page.relevance is not None:
                page.relevance = None
                page.relevance_note = None
                page.corroboration = None
                changed += 1
            continue
        extraction = None
        if page.extraction:
            try:
                extraction = json.loads(page.extraction)
            except json.JSONDecodeError:
                extraction = None
        verdict = _match_page(extraction, page.text or "", tree, relations)
        if page.relevance != verdict["relevance"]:
            changed += 1
        page.relevance = verdict["relevance"]
        page.relevance_note = verdict["note"]
        page.corroboration = (
            json.dumps(verdict["corroboration"], ensure_ascii=False)
            if verdict.get("corroboration") else None
        )
    return changed


# ── the run ───────────────────────────────────────────────────────────────────

def _run(batch_id: int, session_factory, lang: str, name_order: str,
         analysis_only: bool, page_ids: list[int] | None = None) -> None:
    try:
        asyncio.run(_arun(batch_id, session_factory, lang, name_order, analysis_only, page_ids))
    except Exception as e:                                   # never kill the thread silently
        with _state.lock:
            _state.error = str(e)
            _state.phase = "failed"
    finally:
        with _state.lock:
            _state.running = False
            _state.current_name = None


async def _arun(batch_id: int, session_factory, lang: str, name_order: str,
                analysis_only: bool, page_ids: list[int] | None = None) -> None:
    from .database import TranscriptBatch, TranscriptPage

    db = session_factory()
    try:
        batch = db.get(TranscriptBatch, batch_id)
        if batch is None:
            with _state.lock:
                _state.error = "Batch not found"
                _state.phase = "failed"
            return

        settings = ai_config.get_doc_settings()
        batch.provider = settings["provider"]
        batch.model = settings["model"]

        if not analysis_only:
            batch.status = "transcribing"
            db.commit()

            q = db.query(TranscriptPage).filter(TranscriptPage.batch_id == batch_id)
            if page_ids:
                # Named pages are read whatever state they are in — that is what
                # picking one means. The unnamed rest are left alone.
                q = q.filter(TranscriptPage.id.in_(page_ids))
            else:
                q = q.filter(TranscriptPage.status.in_(["pending", "running"]))
            pending = q.order_by(TranscriptPage.sort_order, TranscriptPage.id).all()
            with _state.lock:
                _state.total = len(pending)

            for page in pending:
                with _state.lock:
                    if _state.stop_requested:
                        break
                    _state.current_name = page.filename

                page.status = "running"
                db.commit()

                result = await _read_with_timeout(page, lang)
                for attempt in range(PAGE_RETRIES):
                    if not (result.error and result.retryable):
                        break
                    with _state.lock:
                        if _state.stop_requested:
                            break
                    await asyncio.sleep(RETRY_BACKOFF_SECONDS[min(attempt, len(RETRY_BACKOFF_SECONDS) - 1)])
                    result = await _read_with_timeout(page, lang)

                if result.error:
                    page.status = "failed"
                    page.error = result.error[:1000]
                    with _state.lock:
                        _state.failed += 1
                else:
                    page.status = "done"
                    page.error = None
                    page.text = result.text or None
                    page.extraction = json.dumps(result.extraction, ensure_ascii=False) if result.extraction else None
                    page.language = result.language or None
                    page.method = result.method
                    page.model = settings["model"]
                    page.input_tokens = result.input_tokens
                    page.output_tokens = result.output_tokens
                page.created_at = page.created_at or datetime.now().isoformat()
                db.commit()

                with _state.lock:
                    _state.processed += 1

            with _state.lock:
                stopped = _state.stop_requested

            if stopped:
                batch.status = "pending"
                db.commit()

        # ── phase 2: match, in Python ───────────────────────────────────────
        #
        # Always, after any amount of transcription: it is arithmetic over data
        # already on disk, it costs nothing, and it is what puts the marks on
        # the page list. Phase 3 is the one that spends money and minutes.
        with _state.lock:
            _state.phase = "matching"
            _state.current_name = None

        tree = _tree_index(db)
        relations = _relation_index(db)
        pages = (
            db.query(TranscriptPage)
            .filter(TranscriptPage.batch_id == batch_id)
            .order_by(TranscriptPage.sort_order, TranscriptPage.id)
            .all()
        )
        rows: list[dict[str, Any]] = []
        for page in pages:
            extraction = None
            if page.extraction:
                try:
                    extraction = json.loads(page.extraction)
                except json.JSONDecodeError:
                    extraction = None

            if page.status != "done":
                page.relevance = None
                page.relevance_note = None
            else:
                verdict = _match_page(extraction, page.text or "", tree, relations)
                page.relevance = verdict["relevance"]
                page.relevance_note = verdict["note"]
                page.corroboration = (
                    json.dumps(verdict["corroboration"], ensure_ascii=False)
                    if verdict.get("corroboration") else None
                )
                rows.append(_report_row(
                    page, extraction, verdict["matches"], verdict.get("corroboration"),
                    _lang=lang, _name_order=name_order,
                ))
        db.commit()

        for page in pages:
            if page.status != "done":
                rows.append({
                    "page_id": page.id,
                    "filename": page.filename,
                    "status": page.status,
                    "error": page.error,
                    "relevance": None,
                })

        # ── phase 3: the write-up, only when asked for ──────────────────────
        #
        # Not automatic. A folder is read in several sittings — a few pages,
        # some corrections, a retry of what failed — and a report fired after
        # each of those is a paid call producing a document about a batch that
        # is about to change again. The marks from phase 2 are what the user
        # actually needs in order to decide whether a report is worth asking
        # for, and they are already on screen by now.
        if not analysis_only:
            batch.status = "ready" if batch.analysis else "pending"
            db.commit()
            with _state.lock:
                _state.phase = "done"
            return

        with _state.lock:
            _state.phase = "analysing"
            _state.started_at = time.time()

        batch.status = "analysing"
        db.commit()

        # The report reads the project through the assistant's own tools, so it
        # gets the `query_only` pool rather than this job's writable session —
        # the structural half of the read-only guarantee is not something to
        # skip just because the caller happens to be trusted.
        from .project_manager import project_manager
        read_db = next(project_manager.get_readonly_db())
        texts = {p.id: (p.text or "") for p in pages if p.status == "done"}
        try:
            report, error, steps = await asyncio.wait_for(
                doc_reader.write_batch_report(
                    _capped_rows(rows, texts), lang=lang, name_order=name_order,
                    coverage=_batch_coverage(pages), read_db=read_db,
                    batch_id=batch_id, should_stop=_stop_requested,
                ),
                timeout=REPORT_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            report, steps = "", []
            error = (
                f"The report did not finish within {REPORT_TIMEOUT_SECONDS // 60} minutes "
                "and was abandoned. The pages are read; run the analysis again."
            )
        finally:
            read_db.close()
        batch.analysis = _link_page_names(report, pages) or None
        batch.analysis_steps = json.dumps(steps, ensure_ascii=False) if steps else None
        batch.analysis_error = error or None
        batch.analysed_at = datetime.now().isoformat()
        batch.status = "failed" if error and not report else "ready"
        db.commit()

        with _state.lock:
            _state.phase = "done"
            _state.error = error or None
    finally:
        db.close()


def _stop_requested() -> bool:
    with _state.lock:
        return _state.stop_requested


async def _read_with_timeout(page, lang: str):
    """One page, bounded. A timeout is reported as a retryable failure, because
    that is what it is: nothing about the page caused it."""
    try:
        return await asyncio.wait_for(
            doc_reader.read_file(Path(page.source_path or ""), lang=lang),
            timeout=PAGE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        return doc_reader.PageRead(
            error=f"Reading this page took longer than {PAGE_TIMEOUT_SECONDS}s and was abandoned.",
            retryable=True,
        )


# The finding, in the reader's language, with both people already linked.
#
# Handing the model `kind: "spouses"` and asking it to phrase that in Hungarian
# got a Hungarian sentence with the English rendering quoted inside it — the
# model composed the English itself, because English is what the field values
# look like. So the sentence is composed here instead, where the language and
# the name order are already known and the ids cannot be lost.
_CORROBORATION_TEXT = {
    "hu": {
        "parent_child": "a lapon szereplő szülő–gyermek pár a családfában is szülő és gyermek: {a} és {b}",
        "spouses": "a lapon szereplő vőlegény és menyasszony a családfában is házastársak: {a} és {b}",
        "siblings": "a lapon együtt szereplő két gyermek a családfában is testvér: {a} és {b}",
        "shared_parent": "a lapon együtt szereplő két gyermeknek a családfa szerint közös a szülője: {a} és {b}",
    },
    "en": {
        "parent_child": "the parent and child named on the page are a recorded parent and child in the tree: {a} and {b}",
        "spouses": "the groom and bride named on the page are recorded spouses in the tree: {a} and {b}",
        "siblings": "the two children named on the page are recorded siblings in the tree: {a} and {b}",
        "shared_parent": "the two children named on the page share a recorded parent in the tree: {a} and {b}",
    },
}


def _person_link(person: dict[str, Any], name_order: str) -> str:
    """`@[Name](#pid-N)` with the parts in the user's order."""
    first = (person.get("first_name") or "").strip()
    last = (person.get("last_name") or "").strip()
    parts = [last, first] if name_order == "hu" else [first, last]
    name = " ".join(p for p in parts if p) or f"#{person['person_id']}"
    return f"@[{name}](#pid-{person['person_id']})"


def _corroboration_sentence(corr: dict[str, Any] | None, lang: str, name_order: str) -> str | None:
    if not corr or len(corr.get("persons") or []) < 2:
        return None
    table = _CORROBORATION_TEXT.get(lang) or _CORROBORATION_TEXT["en"]
    template = table.get(corr.get("kind") or "")
    if not template:
        return None
    a, b = corr["persons"][0], corr["persons"][1]
    sentence = template.format(a=_person_link(a, name_order), b=_person_link(b, name_order))
    entry_no = corr.get("entry_no")
    if entry_no:
        suffix = f" (a lap {entry_no}. bejegyzése)" if lang == "hu" else f" (entry {entry_no} on the page)"
        sentence += suffix
    return sentence


def _link_page_names(report: str, pages) -> str:
    """Turn every bare filename in the report into a link to that page.

    Asked for in the prompt, and not reliably done — so it is done here. The
    filename-to-id map is known, the substitution is unambiguous, and a page
    the reader cannot open from the sentence naming it is a page they have to
    go and hunt for.
    """
    import re

    if not report:
        return report
    # Longest first, so a filename that is a prefix of another cannot win.
    for page in sorted(pages, key=lambda p: -len(p.filename or "")):
        name = page.filename
        if not name or name not in report:
            continue
        # Skip an occurrence already inside a markdown link's label or target.
        pattern = re.compile(r"(?<!\[)(?<!\()" + re.escape(name) + r"(?!\])(?!\))")
        report = pattern.sub(f"[{name}](#page-{page.id})", report)
    return report


def _batch_coverage(pages) -> dict[str, Any]:
    """How much of the folder this report is actually about.

    A report can be asked for as soon as one page is readable, which makes it
    useful early — and dangerous, because a report over three of two hundred
    pages reads exactly like a report over all of them unless it says so. The
    counts go into the prompt so the model has to open with them.
    """
    counts: dict[str, int] = {}
    for p in pages:
        counts[p.status] = counts.get(p.status, 0) + 1
    total = len(pages)
    read = counts.get("done", 0)
    return {
        "pages_in_batch": total,
        "pages_read": read,
        "pages_not_read": total - read,
        "by_status": counts,
        "partial": read < total,
    }


def _report_row(page, extraction: dict[str, Any] | None, matches: list[dict[str, Any]],
                corroboration: dict[str, Any] | None = None,
                _lang: str = "en", _name_order: str = "en") -> dict[str, Any]:
    """One page as the report model sees it.

    The row deliberately does **not** describe the page. It used to carry the
    extraction's `kind`, its single `date`, its `place` and its first twelve
    people — an index of a page that holds a dozen dated entries and four times
    that many names, presented beside the full transcript as though it were a
    summary of it. Where the two disagreed the model believed the index, because
    the index is short and definite and the transcript is long and messy; and
    where the index was silent the model wrote that the page was silent.

    What is left is what the transcript cannot supply: the marks this code
    computed, the years it read, and the tree ids a name in the text has no way
    to carry. Everything about what the page *says* comes from `transcript`.
    """
    return {
        "page_id": page.id,
        "filename": page.filename,
        "status": "done",
        "relevance": page.relevance,
        "relevance_note": page.relevance_note,
        "years_on_page": _page_years(extraction, page.text or "")[:6],
        "transcript_chars": len(page.text or ""),
        # `entry_index` is this module's own array index and means nothing to a
        # reader; `entry_no` is what the register prints and what the model must
        # cite. Sending both invites it to quote the wrong one.
        "tree_matches": [
            {k: v for k, v in m.items() if k != "entry_index"} for m in matches[:8]
        ],
        "corroboration": corroboration,
        # Already phrased and already linked — see _corroboration_sentence.
        "corroboration_summary": _corroboration_sentence(corroboration, _lang, _name_order),
        # `transcript` is filled by _capped_rows, which owns the budget.
    }


def _capped_rows(rows: list[dict[str, Any]], texts: dict[int, str]) -> dict[str, Any]:
    """Group by relevance and attach the transcripts, strongest group first.

    Grouped rather than sorted because the write-up's sections *are* these
    groups. Handing the model one flat list and asking it to sort by a field
    is asking it to make a judgement that has already been made in code — and
    it moved pages between sections when it disagreed, which is exactly the
    ranking this pass exists to keep out of the model's hands.

    The character budget is spent in the same order, so if a folder is too big
    to send whole, what survives intact is what the report is mostly about.
    Anything trimmed carries `transcript_truncated` and can still be fetched
    in full with the `read_page` tool.
    """
    buckets: dict[str, list[dict[str, Any]]] = {
        "corroborated": [], "candidates": [], "weak": [], "unrelated": [], "unread": [],
    }
    key_for = {"high": "corroborated", "medium": "candidates", "low": "weak", "none": "unrelated"}
    for r in rows:
        if r.get("status") != "done":
            buckets["unread"].append(r)
        else:
            buckets[key_for.get(r.get("relevance") or "none", "unrelated")].append(r)

    out: dict[str, Any] = {}
    budget = REPORT_TEXT_BUDGET
    trimmed = 0
    for name in ("corroborated", "candidates", "weak", "unrelated", "unread"):
        rows_here = buckets[name]
        for row in rows_here:
            text = texts.get(row.get("page_id"), "")
            if not text:
                continue
            if len(text) <= budget:
                row["transcript"] = text
                budget -= len(text)
            else:
                # Never send a stub: below a useful minimum, send nothing and
                # point at the tool, so the model reads the page properly or
                # knows it has not read it at all.
                keep = budget if budget >= REPORT_MIN_PAGE_CHARS else 0
                if keep:
                    row["transcript"] = text[:keep]
                    budget -= keep
                row["transcript_truncated"] = True
                row["transcript_chars"] = len(text)
                row["note"] = (
                    "Only part of this page is included. Call read_page with its "
                    "page_id before saying anything about its contents."
                )
                trimmed += 1
        out[name] = {"count": len(rows_here), "pages": rows_here}

    if trimmed:
        out["_note"] = (
            f"{trimmed} pages were too long to include whole. They are marked "
            "`transcript_truncated`; use read_page to read one before describing it."
        )
    return out

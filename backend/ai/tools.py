"""Read-only tools — the assistant's only path to the data.

Three independent layers keep this read-only:

1. The session comes from the `query_only` pool (`configure_readonly_engine`),
   so a write fails with SQLITE_READONLY even if something here is wrong.
2. These tools are the *only* data path — the model never gets to run SQL it
   wrote itself, in any form.
3. `Tool.mutates` is rejected at registration time. Write tools would land here
   behind a confirmation dialog; until then the registry refuses them outright.

Two conventions that are easy to get wrong:

* **Names.** Tools return name *parts*, never `persons.name` — that column is
  always composed in one fixed order by `_derive_display_name()`, so a client
  (or a model) that only sees it cannot honour the user's name-order setting.
  Same reason `_doc_person_dict` in main.py exists.
* **Privacy.** Everything filters `COALESCE(is_private,0)=0` unless the user
  turned on `allow_private`. `COALESCE` because databases predating the v5
  migration have NULLs there. Note `persons` has no `is_private` column — a
  person is never private, only their relations/notes/documents/events are.
"""

from __future__ import annotations

import json
import unicodedata
from collections import deque
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable

from sqlalchemy import or_, text as sql_text
from sqlalchemy.orm import Session

from ..database import (
    Citation as DBCitation,
    Cluster as DBCluster,
    Document as DBDocument,
    DocumentFile as DBDocumentFile,
    DocumentNote as DBDocumentNote,
    DocumentPerson as DBDocumentPerson,
    Event as DBEvent,
    EventPerson as DBEventPerson,
    Face as DBFace,
    Image as DBImage,
    Person as DBPerson,
    PersonNote as DBPersonNote,
    Relation as DBRelation,
    Source as DBSource,
)
from .pdf_text import has_text_layer, is_pdf, text_layer as pdf_text_layer
from .primer import PROFILE_FIELDS

MAX_RESULTS = 50

#: Longest document body returned inline. Past this the model is reading a book
#: through a keyhole anyway, and the excerpt plus a pointer serves it better.
MAX_BODY_CHARS = 12000


# ── context ───────────────────────────────────────────────────────────────────


@dataclass
class ToolContext:
    db: Session
    allow_private: bool = False
    docs_dir: Path | None = None


# ── registry ──────────────────────────────────────────────────────────────────


@dataclass
class Tool:
    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[[ToolContext, dict[str, Any]], Any]
    mutates: bool = False


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        if tool.mutates:
            raise ValueError(
                f"Tool '{tool.name}' declares mutates=True. The assistant is "
                "read-only; write tools need a confirmation flow first."
            )
        self._tools[tool.name] = tool

    def definitions(self) -> list[dict[str, Any]]:
        """Wire format for the provider. Sorted by name so the serialisation is
        byte-stable — tools render before the system prompt, so any reordering
        would invalidate the whole prompt cache."""
        return [
            {"name": t.name, "description": t.description, "input_schema": t.input_schema}
            for t in sorted(self._tools.values(), key=lambda t: t.name)
        ]

    def execute(self, name: str, args: dict[str, Any], ctx: ToolContext) -> Any:
        tool = self._tools.get(name)
        if tool is None:
            raise KeyError(f"Unknown tool: {name}")
        return tool.handler(ctx, args or {})


# ── helpers ───────────────────────────────────────────────────────────────────


def _norm(s: str | None) -> str:
    """Accent- and case-insensitive comparison key.

    SQLite's LIKE is only case-insensitive for ASCII, so an accented word would
    not match its lower-case form in SQL. Same NFD approach as `_make_id` in project_manager.py.
    """
    if not s:
        return ""
    stripped = "".join(
        c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c)
    )
    return stripped.casefold().strip()


def _priv_ok(ctx: ToolContext, obj: Any) -> bool:
    if ctx.allow_private:
        return True
    return not bool(getattr(obj, "is_private", False))


def _person_stub(p: DBPerson) -> dict[str, Any]:
    """Name parts, not the composed name — see module docstring."""
    return {
        "id": p.id,
        "title": p.title,
        "first_name": p.first_name,
        "middle_name": p.middle_name,
        "last_name": p.last_name,
        "nickname": p.nickname,
        "sex": p.sex,
        "birth_year": p.birth_year,
        "death_year": p.death_year,
    }


def _person_full(p: DBPerson) -> dict[str, Any]:
    d = _person_stub(p)
    d.update({f: getattr(p, f, None) for f in PROFILE_FIELDS})
    return {k: v for k, v in d.items() if v is not None}


def _missing_fields(p: DBPerson) -> list[str]:
    """The biographical fields this person has nothing in.

    `_person_full` drops empty keys, which leaves the caller unable to tell an
    unrecorded field from one it did not ask for — and that ambiguity is where
    "no occupation is recorded for anyone in this family" comes from. Naming the
    gaps explicitly turns them into something the answer can state precisely and
    the user can act on.
    """
    return [f for f in PROFILE_FIELDS if not (getattr(p, f, None) or "").strip()]


def _event_dict(e: DBEvent) -> dict[str, Any]:
    return {
        "id": e.id,
        "event_type": e.event_type,
        "title": e.title,
        "date": e.date,
        "year": e.year,
        "place": e.place,
        "description": e.description,
    }


def _doc_dict(ctx: ToolContext, d: DBDocument) -> dict[str, Any]:
    """Metadata only. `readable` says whether the contents can ever be reached.

    A document arrives here in one of four states, and which one it is travels
    with every response, because a title like "1908 register entry" is easy to
    mistake for having read the thing:

    * prose written inside the app - `get_document` returns it in full;
    * a scan that has been transcribed - `get_document` returns the transcript;
    * a PDF that carries its own text layer - `get_document` returns that text.
      It is pulled out of the file locally, costs nothing and never leaves the
      machine, so there is no reason for this kind to be unreadable;
    * everything else - a photograph, a recording, a PDF that is only pictures
      of pages. Nothing here can open those, and they say so.
    """
    transcript = getattr(d, "transcript", None)
    transcribed = bool(transcript is not None and (transcript.text or "").strip())
    # A transcript outranks the raw layer: it is the reading the user has been
    # able to correct by hand.
    pdf_text, other_files = ("", 0) if (bool(d.is_text) or transcribed) else _pdf_body(ctx, d)
    pdf_readable = has_text_layer(pdf_text)
    readable = bool(d.is_text) or transcribed or pdf_readable
    out = {
        "id": d.id,
        "title": d.title,
        "doc_type": d.doc_type,
        "year": d.year,
        "description": d.description,
        "is_text": bool(d.is_text),
        "filename": d.filename,
        "mime_type": d.mime_type,
        "readable": readable,
        "transcribed": transcribed,
    }
    if bool(d.is_text):
        out["note"] = "Written in the app — call get_document to read the whole text."
    elif transcribed:
        # A transcript is a reading of the page, not the page. Handwriting is
        # read with gaps, and the gaps are marked in the text itself — so the
        # note has to keep the distinction alive, or a `[?]` gets quoted back
        # as if it were what the register says.
        out["note"] = (
            "A scanned file that has been transcribed — call get_document to read "
            "the transcript. It is a reading of old handwriting, not a certified "
            "copy: `[?]` marks a word that could not be read, and `word[?]` a "
            "reading that is uncertain. Never quote one of those as settled."
        )
        if transcript.edited:
            out["note"] += " This transcript has been corrected by hand."
    elif pdf_readable:
        out["has_text_layer"] = True
        # The opposite failure from a transcript's. Nothing here is guessed —
        # the characters are the file's own — but a PDF stores words with
        # coordinates and no structure, so a two-column page or a ruled form
        # comes back in an order nobody wrote.
        out["note"] = (
            "A PDF carrying its own text layer — call get_document to read it. The "
            "text is the file's own, extracted from it rather than read off a "
            "picture, so the words are exact. Their *order* is not: a PDF stores "
            "no layout, so columns, form labels and marginal notes can come out "
            "interleaved. Quote it as written, and do not reconstruct a table, or "
            "decide which label belongs to which value, from the order alone."
        )
        if other_files:
            out["note"] += (
                f" This document has {other_files} further file(s) which are not "
                "PDFs and were not read."
            )
    elif is_pdf(d.mime_type, d.filename):
        out["note"] = (
            "A PDF with no text layer — pictures of pages with nothing written "
            "underneath them, which is what a scanner produces. Neither you nor any "
            "tool here can read it. Do not summarise or characterise it: tell the "
            "user it is there, and that the Documents tab can transcribe it if they "
            "want it read."
        )
    else:
        out["note"] = (
            "An attached file. Its contents cannot be read by you or by any tool "
            "here; only this metadata and the description exist. Do not summarise "
            "or characterise it — tell the user it is there and let them open it. "
            "It can be transcribed in the Documents tab if they want it read."
        )
    return out


def _event_with_persons(ctx: ToolContext, e: DBEvent) -> dict[str, Any]:
    d = _event_dict(e)
    rows = ctx.db.query(DBEventPerson).filter(DBEventPerson.event_id == e.id).all()
    people = {p.id: p for p in ctx.db.query(DBPerson).filter(
        DBPerson.id.in_([r.person_id for r in rows])).all()} if rows else {}
    d["persons"] = [
        {**_person_stub(people[r.person_id]), "role": r.role}
        for r in rows if r.person_id in people
    ]
    return d


def _parents_of(ctx: ToolContext, pid: int, relations: list[DBRelation]) -> list[int]:
    return [r.person_a_id for r in relations if r.type == "parent" and r.person_b_id == pid]


def _visible_relations(ctx: ToolContext) -> list[DBRelation]:
    q = ctx.db.query(DBRelation)
    rels = q.all()
    return [r for r in rels if _priv_ok(ctx, r)]


def _capped(payload: dict[str, Any], key: str, limit: int, total: int | None = None) -> dict[str, Any]:
    """Slice a result list and *say so* when something was left out.

    A silently truncated list is indistinguishable from a complete one, and a
    model that intersects or counts two truncated lists produces a confident
    wrong number. So the cap is always visible, and the true total travels with
    the result.
    """
    items = payload[key]
    real_total = len(items) if total is None else total
    payload[key] = items[:limit]
    payload["count"] = len(payload[key])
    payload["total"] = real_total
    if real_total > len(payload[key]):
        payload["truncated"] = True
        payload["note"] = (
            f"Showing {len(payload[key])} of {real_total}. This list is incomplete — "
            "do not count, intersect or draw conclusions from it as if it were the "
            "whole set. Narrow the filters, or use a tool that answers the question "
            "directly."
        )
    return payload


def _text_body(ctx: ToolContext, d: DBDocument) -> str:
    """Markdown body of an in-app text document (stored as a .md file)."""
    if not d.is_text or ctx.docs_dir is None:
        return ""
    try:
        p = ctx.docs_dir / d.stored_name
        return p.read_text(encoding="utf-8") if p.exists() else ""
    except Exception:
        return ""


def _transcript_body(d: DBDocument) -> str:
    """The stored transcript of a scanned document, verbatim reading first.

    Both renderings go in: the verbatim one is the evidence and carries the
    `[?]` marks, the modern one is what makes a Latin or Kurrent entry usable.
    Dropping either loses something the other cannot supply.
    """
    t = getattr(d, "transcript", None)
    if t is None:
        return ""
    parts = []
    if (t.text or "").strip():
        parts.append("[transcript, as written]\n" + t.text.strip())
    if (t.modern_text or "").strip():
        parts.append("[the same, in modern language]\n" + t.modern_text.strip())
    return "\n\n".join(parts)


def _pdf_body(ctx: ToolContext, d: DBDocument) -> tuple[str, int]:
    """(text of this document's PDF files, how many of its files were not PDFs).

    A document is one record with one or more files on it, so "the PDF" is not
    always a single thing: a certificate can arrive as one PDF per page. Every
    PDF among them is read and they are concatenated in upload order, each under
    its filename, because the alternative — reading the primary file only —
    silently drops page two onward of a document the user thinks is whole.

    The number of files left unread comes back with the text so the caller can
    say what was skipped. A document holding a PDF and a JPEG has been *partly*
    read, and "partly" is exactly the sort of qualifier that disappears from an
    answer unless something states it.
    """
    if bool(d.is_text) or ctx.docs_dir is None:
        return "", 0

    files: list[tuple[str, str]] = []
    others = 0
    if is_pdf(d.mime_type, d.filename):
        files.append((d.filename or "", d.stored_name))
    elif d.stored_name:
        others += 1
    extras = (
        ctx.db.query(DBDocumentFile)
        .filter(DBDocumentFile.document_id == d.id)
        .order_by(DBDocumentFile.sort_order, DBDocumentFile.id)
        .all()
    )
    for f in extras:
        if is_pdf(f.mime_type, f.filename):
            files.append((f.filename or "", f.stored_name))
        else:
            others += 1
    if not files:
        return "", others

    parts: list[str] = []
    for name, stored in files:
        text = pdf_text_layer(ctx.docs_dir / stored)
        if not text.strip():
            continue
        parts.append(f"[{name}]\n{text}" if len(files) > 1 and name else text)
    return "\n\n".join(parts).strip(), others


def _document_body(ctx: ToolContext, d: DBDocument) -> tuple[str, str]:
    """The document's text and where it came from: 'text', 'transcript', 'pdf' or ''.

    One place decides which readable kind a document is, so the listing, the
    search haystack and the reader cannot come to different conclusions about
    whether the same document can be opened.
    """
    if bool(d.is_text):
        return _text_body(ctx, d), "text"
    body = _transcript_body(d)
    if body:
        return body, "transcript"
    body, _others = _pdf_body(ctx, d)
    if has_text_layer(body):
        return body, "pdf"
    return "", ""


def _sliced_body(out: dict[str, Any], body: str, offset: int) -> dict[str, Any]:
    """Put a window of `body` in the payload and say what lies either side of it.

    One excerpt with no way to ask for the rest is how the first page of a long
    record gets reported as the whole record — the same reason the batch report
    was given `read_page` rather than a smaller slice. So the total length is
    always stated, and when there is more, so is the offset that continues it.
    """
    total = len(body)
    start = max(0, min(int(offset or 0), total))
    chunk = body[start:start + MAX_BODY_CHARS]
    out["body"] = chunk
    out["body_total_chars"] = total
    note = out.get("note", "")
    if start:
        out["body_offset"] = start
    if start + len(chunk) < total:
        out["body_truncated"] = True
        out["next_offset"] = start + len(chunk)
        note += (
            f" Showing characters {start}–{start + len(chunk)} of {total}. Call "
            f"get_document again with offset={start + len(chunk)} to continue; say "
            "you are working from an excerpt if you stop here."
        )
    elif start:
        note += f" Showing characters {start}–{total} of {total} — the end of it."
    out["note"] = note.strip()
    return out


def _doc_with_body(ctx: ToolContext, d: DBDocument, offset: int = 0) -> dict[str, Any]:
    """Metadata plus the text, for documents that have text."""
    out = _doc_dict(ctx, d)
    body, kind = _document_body(ctx, d)
    if not kind:
        return out
    if kind == "text" and not body:
        out["note"] = (
            "This document is marked as written in the app but its file could "
            "not be read. Report that rather than describing its contents."
        )
        return out
    return _sliced_body(out, body, offset)


# ── tool implementations ──────────────────────────────────────────────────────


def _t_search_persons(ctx: ToolContext, a: dict[str, Any]) -> Any:
    q = _norm(a.get("query"))
    place = _norm(a.get("place"))
    occ = _norm(a.get("occupation"))
    y_from, y_to = a.get("birth_year_from"), a.get("birth_year_to")
    limit = min(int(a.get("limit") or 25), MAX_RESULTS)
    # Without this, "who is missing a birth date?" is unanswerable: the only
    # available filter is a year *range*, so the question gets inverted into
    # "who has one" — a confident answer to a different question.
    missing = [str(f) for f in (a.get("missing") or [])]

    out = []
    for p in ctx.db.query(DBPerson).order_by(DBPerson.id).all():
        if q:
            hay = " ".join(_norm(x) for x in (
                p.name, p.first_name, p.last_name, p.middle_name, p.nickname, p.title,
            ))
            if q not in hay:
                continue
        if y_from is not None and (p.birth_year is None or p.birth_year < int(y_from)):
            continue
        if y_to is not None and (p.birth_year is None or p.birth_year > int(y_to)):
            continue
        if place:
            places = " ".join(_norm(x) for x in (
                p.birth_place, p.death_place, p.christening_place, p.burial_place,
            ))
            if place not in places:
                continue
        if occ and occ not in _norm(p.occupation):
            continue
        if missing and any(str(getattr(p, f, "") or "").strip() for f in missing):
            continue
        out.append(_person_stub(p))

    return _capped({"persons": out}, "persons", limit)


def _t_get_person(ctx: ToolContext, a: dict[str, Any]) -> Any:
    pid = int(a["person_id"])
    p = ctx.db.get(DBPerson, pid)
    if p is None:
        return {"error": f"No person with id {pid}"}

    include = set(a.get("include") or ["relations", "events", "documents", "notes", "photos", "sources"])
    result: dict[str, Any] = {
        "person": _person_full(p),
        # Say which fields are empty rather than leaving the caller to infer it
        # from what is absent — see _missing_fields.
        "missing_fields": _missing_fields(p),
    }

    if "relations" in include:
        by_id = {x.id: x for x in ctx.db.query(DBPerson).all()}
        parents, children, spouses, siblings = [], [], [], []
        rels = _visible_relations(ctx)
        parent_of: dict[int, list[int]] = {}
        for r in rels:
            if r.type == "parent":
                parent_of.setdefault(r.person_b_id, []).append(r.person_a_id)
        for r in rels:
            if r.type == "parent":
                if r.person_b_id == pid and r.person_a_id in by_id:
                    parents.append(_person_stub(by_id[r.person_a_id]))
                elif r.person_a_id == pid and r.person_b_id in by_id:
                    children.append(_person_stub(by_id[r.person_b_id]))
            elif r.type == "spouse" and pid in (r.person_a_id, r.person_b_id):
                other = r.person_b_id if r.person_a_id == pid else r.person_a_id
                if other in by_id:
                    s = _person_stub(by_id[other])
                    s["marriage_year"] = r.marriage_year
                    s["marriage_place"] = r.marriage_place
                    s["divorce_year"] = r.divorce_year
                    spouses.append(s)
        my_parents = set(parent_of.get(pid, []))
        if my_parents:
            for child_id, par_ids in parent_of.items():
                if child_id != pid and my_parents & set(par_ids) and child_id in by_id:
                    siblings.append(_person_stub(by_id[child_id]))
        result["relations"] = {
            "parents": parents, "children": children,
            "spouses": spouses, "siblings": siblings,
        }

    if "events" in include:
        ev_ids = [ep.event_id for ep in ctx.db.query(DBEventPerson).filter(DBEventPerson.person_id == pid).all()]
        evs = ctx.db.query(DBEvent).filter(DBEvent.id.in_(ev_ids)).all() if ev_ids else []
        # Attendees must come along. Returning the event without them reads as
        # "nobody was recorded", which is a different claim from "not asked for".
        result["events"] = [
            _event_with_persons(ctx, e)
            for e in sorted(evs, key=lambda e: (e.year or 9999, e.id))
            if _priv_ok(ctx, e)
        ]

    if "documents" in include:
        doc_ids = {dp.document_id for dp in ctx.db.query(DBDocumentPerson).filter(DBDocumentPerson.person_id == pid).all()}
        doc_ids |= {d.id for d in ctx.db.query(DBDocument).filter(DBDocument.person_id == pid).all()}
        docs = ctx.db.query(DBDocument).filter(DBDocument.id.in_(doc_ids)).all() if doc_ids else []
        # The text comes with the metadata. A separate round-trip to read the one
        # document a person has is a round-trip that often did not happen, and the
        # answer was then written from the title.
        result["documents"] = [
            _doc_with_body(ctx, d)
            for d in sorted(docs, key=lambda d: d.id) if _priv_ok(ctx, d)
        ]

    if "notes" in include:
        notes = ctx.db.query(DBPersonNote).filter(DBPersonNote.person_id == pid).order_by(DBPersonNote.sort_order, DBPersonNote.id).all()
        result["notes"] = [
            {"id": n.id, "title": n.title, "content": n.content}
            for n in notes if _priv_ok(ctx, n)
        ]
        # The legacy free-text field on the person row, written by older versions
        # and by the GEDCOM importer. Invisible to every other tool, and prose
        # that is invisible is prose the answer silently denies exists.
        if (p.notes or "").strip():
            result["profile_note"] = p.notes

    if "photos" in include:
        image_ids = _person_image_ids(ctx, pid)
        visible = [i for i in ctx.db.query(DBImage).filter(DBImage.id.in_(image_ids)).all()
                   if _priv_ok(ctx, i)] if image_ids else []
        result["photos"] = {
            "count": len(visible),
            "gallery_link": f"#people-{pid}" if visible else None,
            "note": (
                f"{len(visible)} photographs are linked to this person by face "
                f"recognition. Offer them as [caption](#people-{pid}); call "
                "find_photos or list_photos_of only if you need the individual images."
            ) if visible else "No face cluster is linked to this person yet.",
        }

    if "sources" in include:
        cites = ctx.db.query(DBCitation).filter(DBCitation.person_id == pid).order_by(DBCitation.id).all()
        src_ids = {c.source_id for c in cites}
        sources = {s.id: s for s in ctx.db.query(DBSource).filter(DBSource.id.in_(src_ids)).all()} if src_ids else {}
        result["sources"] = [
            {
                "citation_id": c.id, "fact": c.fact, "detail": c.detail, "notes": c.notes,
                "source_id": c.source_id,
                "source_title": sources[c.source_id].title if c.source_id in sources else None,
                "source_type": sources[c.source_id].source_type if c.source_id in sources else None,
            }
            for c in cites
        ]

    return result


def _t_get_relationship_path(ctx: ToolContext, a: dict[str, Any]) -> Any:
    """Shortest path between two people.

    The BFS runs here rather than in the model's head — the whole point of a
    fat tool: one call replaces a chain of graph lookups the model would
    otherwise have to reason through (and get wrong).
    """
    src, dst = int(a["person_a_id"]), int(a["person_b_id"])
    people = {p.id: p for p in ctx.db.query(DBPerson).all()}
    if src not in people or dst not in people:
        return {"error": "One or both persons not found"}
    if src == dst:
        return {"found": True, "steps": [], "note": "Same person"}

    adj: dict[int, list[tuple[int, str]]] = {}
    for r in _visible_relations(ctx):
        if r.type == "parent":
            adj.setdefault(r.person_a_id, []).append((r.person_b_id, "child"))
            adj.setdefault(r.person_b_id, []).append((r.person_a_id, "parent"))
        elif r.type == "spouse":
            adj.setdefault(r.person_a_id, []).append((r.person_b_id, "spouse"))
            adj.setdefault(r.person_b_id, []).append((r.person_a_id, "spouse"))

    prev: dict[int, tuple[int, str]] = {}
    seen = {src}
    queue = deque([src])
    while queue:
        cur = queue.popleft()
        if cur == dst:
            break
        for nxt, label in adj.get(cur, []):
            if nxt not in seen:
                seen.add(nxt)
                prev[nxt] = (cur, label)
                queue.append(nxt)

    if dst not in prev:
        return {"found": False, "note": "No path — the two are not connected in this tree"}

    chain: list[dict[str, Any]] = []
    node = dst
    while node != src:
        parent_node, label = prev[node]
        chain.append({
            "from": _person_stub(people[parent_node]),
            "to": _person_stub(people[node]),
            "relation": label,   # 'parent' | 'child' | 'spouse' — of `to` relative to `from`
        })
        node = parent_node
    chain.reverse()

    blood = all(step["relation"] != "spouse" for step in chain)
    return {"found": True, "degrees": len(chain), "blood_relation": blood, "steps": chain}


def _t_get_ancestors(ctx: ToolContext, a: dict[str, Any]) -> Any:
    """Walk the ancestor line(s) server-side.

    Genealogical trees repeat given names relentlessly, often between a father
    and his son. A model that tries to trace a line by chaining lookups will
    sooner or later collapse two same-named people into one and silently drop
    a generation. So the walk happens here, and the answer carries ids and
    generation numbers the model cannot mix up.
    """
    pid = int(a["person_id"])
    line = (a.get("line") or "paternal").lower()
    max_gen = min(int(a.get("max_generations") or 20), 40)

    people = {p.id: p for p in ctx.db.query(DBPerson).all()}
    if pid not in people:
        return {"error": f"No person with id {pid}"}
    relations = _visible_relations(ctx)

    def step(person_id: int, want_sex: str) -> tuple[int | None, str | None, list[int]]:
        """Next person up the line: (chosen id, note, unresolved candidates).

        A wrong or missing `sex` is one of the commonest defects in a real tree,
        and it must not make the line end silently — that produces a confident
        wrong answer ("this is your oldest ancestor") from what is really a data
        problem. So a failed match falls back to weaker signals and says which
        one it used, and when nothing can be chosen it hands back the candidates
        so the caller can report them.
        """
        parent_ids = [x for x in _parents_of(ctx, person_id, relations) if x in people]
        if not parent_ids:
            return None, None, []

        by_sex = [x for x in parent_ids if (people[x].sex or "").upper() == want_sex]

        # For a paternal line the surname is the stronger signal: `sex` is a
        # single field that is easy to mis-enter (this tree has several people
        # whose recorded sex is inverted), whereas a surname carrying from
        # father to child is corroborated by every other record.
        child_surname = _norm(people[person_id].last_name)
        by_surname = (
            [x for x in parent_ids if _norm(people[x].last_name) == child_surname]
            if want_sex == "M" and child_surname else []
        )

        agree = [x for x in by_sex if x in by_surname]
        if len(agree) == 1:
            return agree[0], None, []

        if len(by_surname) == 1:
            chosen = by_surname[0]
            note = None
            if chosen not in by_sex:
                note = (
                    f"followed id {chosen} because the surname continues the line; its "
                    f"recorded sex is {people[chosen].sex!r}, which contradicts a paternal "
                    f"line and is probably a data-entry error worth reporting to the user"
                )
            return chosen, note, []

        if len(by_sex) == 1:
            return by_sex[0], None, []
        if len(by_sex) > 1:
            return by_sex[0], (
                f"{len(by_sex)} parents recorded with sex {want_sex}: {by_sex}; followed {by_sex[0]}"
            ), []

        # Nothing decisive. Follow a lone parent only when their sex is simply
        # unrecorded — following one recorded as the *opposite* sex is how a
        # paternal line silently turns into a maternal one.
        if len(parent_ids) == 1 and not (people[parent_ids[0]].sex or "").strip():
            chosen = parent_ids[0]
            return chosen, (
                f"sex not recorded for id {chosen}; followed the only parent — verify in the data"
            ), []
        return None, None, parent_ids

    def walk(want_sex: str) -> dict[str, Any]:
        chain: list[dict[str, Any]] = []
        notes: list[str] = []
        seen = {pid}
        current = pid
        stopped: dict[str, Any] = {"reason": "no further parents recorded"}
        for generation in range(1, max_gen + 1):
            nxt, note, candidates = step(current, want_sex)
            if note:
                notes.append(f"generation {generation}: {note}")
            if nxt is None:
                if candidates:
                    stopped = {
                        "reason": "could not tell which parent continues this line",
                        "at_person_id": current,
                        "candidates": [_person_stub(people[c]) for c in candidates],
                    }
                break
            if nxt in seen:  # malformed data — never loop forever
                notes.append(f"cycle detected at id {nxt}; stopped")
                stopped = {"reason": "cycle in the data", "at_person_id": nxt}
                break
            seen.add(nxt)
            entry = _person_stub(people[nxt])
            entry["generation"] = generation
            chain.append(entry)
            current = nxt
        else:
            stopped = {"reason": f"reached the max_generations limit of {max_gen}"}
        return {
            "chain": chain,
            "generations": len(chain),
            "oldest": chain[-1] if chain else None,
            "stopped": stopped,
            "notes": notes,
        }

    result: dict[str, Any] = {"start": _person_stub(people[pid])}
    if line in ("paternal", "father", "male"):
        result["paternal"] = walk("M")
    elif line in ("maternal", "mother", "female"):
        result["maternal"] = walk("F")
    else:
        result["paternal"] = walk("M")
        result["maternal"] = walk("F")
    result["reporting"] = (
        "Report every generation in `chain` in order, including the people with no "
        "birth or death year — the earliest generations of a tree are usually the "
        "undated ones, and stopping at the last dated person reports someone as the "
        "oldest known ancestor who is not. Name the undated ones as undated instead. "
        "If `notes` or `stopped` mention a data problem, tell the user about it — a "
        "line that ends because of a bad record is not the same as a line that ends "
        "because the ancestor is unknown."
    )
    for key in ("paternal", "maternal"):
        walked = result.get(key)
        if walked and walked["chain"]:
            walked["undated_in_chain"] = [
                x["id"] for x in walked["chain"] if not x.get("birth_year") and not x.get("death_year")
            ]
    return result


def _children_of(pid: int, relations: list[DBRelation]) -> list[int]:
    return [r.person_b_id for r in relations if r.type == "parent" and r.person_a_id == pid]


def _t_get_descendants(ctx: ToolContext, a: dict[str, Any]) -> Any:
    """Everyone descending from a person, grouped by generation.

    The counterpart to `get_ancestors`. Without it the only way down the tree is
    repeated `get_person` calls, which is both slow and — for the undated older
    people who have dozens of descendants — where a model gives up and says the
    data is missing when it is merely one hop away.
    """
    pid = int(a["person_id"])
    max_gen = min(int(a.get("max_generations") or 6), 12)
    dated_only = bool(a.get("dated_only", False))

    people = {p.id: p for p in ctx.db.query(DBPerson).all()}
    if pid not in people:
        return {"error": f"No person with id {pid}"}
    relations = _visible_relations(ctx)

    generations: list[dict[str, Any]] = []
    seen = {pid}
    frontier = [pid]
    total = 0
    for gen in range(1, max_gen + 1):
        nxt: list[int] = []
        for parent in frontier:
            for child in _children_of(parent, relations):
                if child in seen or child not in people:
                    continue
                seen.add(child)
                nxt.append(child)
        if not nxt:
            break
        entries = [_person_stub(people[c]) for c in sorted(nxt)]
        total += len(entries)
        shown = [e for e in entries if e.get("birth_year")] if dated_only else entries
        generations.append({
            "generation": gen,
            "count": len(entries),
            "with_birth_year": sum(1 for e in entries if e.get("birth_year")),
            "people": shown[:60],
        })
        frontier = nxt

    return {
        "start": _person_stub(people[pid]),
        "total_descendants": total,
        "generations": generations,
    }


# A generation length is measured, never assumed. These two constants are the
# only judgement calls: what counts as a believable gap, and how many pairs a
# local sample needs before it beats the project-wide one.
PLAUSIBLE_GAP_YEARS = (12, 60)
LOCAL_GAP_MIN_SAMPLE = 5


def _measure_gaps(
    people: dict[int, DBPerson],
    relations: list[DBRelation],
    restrict_to: set[int] | None = None,
) -> dict[str, Any]:
    """Parent→child birth gaps measured from the data.

    `restrict_to` limits the sample to one person's own blood relatives, which
    matters: a branch can run to a materially different rhythm than the project
    average, and the estimate multiplies that difference by the generation count.
    """
    lo, hi = PLAUSIBLE_GAP_YEARS
    gaps: list[int] = []
    for r in relations:
        if r.type != "parent":
            continue
        if restrict_to is not None and (r.person_a_id not in restrict_to or r.person_b_id not in restrict_to):
            continue
        pa, pb = people.get(r.person_a_id), people.get(r.person_b_id)
        if pa and pb and pa.birth_year and pb.birth_year:
            g = pb.birth_year - pa.birth_year
            if lo <= g <= hi:  # discard obvious data errors
                gaps.append(g)
    if not gaps:
        return {"sample_size": 0}
    gaps.sort()
    n = len(gaps)
    median = gaps[n // 2] if n % 2 else (gaps[n // 2 - 1] + gaps[n // 2]) / 2
    return {
        "sample_size": n,
        "median": round(median, 1),
        "low": gaps[n // 4],
        "high": gaps[min((3 * n) // 4, n - 1)],
        "range": [gaps[0], gaps[-1]],
    }


def _t_estimate_life_period(ctx: ToolContext, a: dict[str, Any]) -> Any:
    """Estimate when an undated person lived, from dated relatives.

    Does the whole calculation here — finding the nearest dated relatives,
    counting generations to each, and applying this family's own generation
    length — because every step of that is arithmetic a model does plausibly
    and wrongly.
    """
    pid = int(a["person_id"])
    # The cap only guards against pathological data; the tree is small, and a
    # distant anchor beats no anchor at all — its weakness is reported, not
    # hidden, so the caller can judge it.
    max_gen = min(int(a.get("max_generations") or 12), 25)
    people = {p.id: p for p in ctx.db.query(DBPerson).all()}
    if pid not in people:
        return {"error": f"No person with id {pid}"}
    relations = _visible_relations(ctx)
    subject = people[pid]

    project_stats = _measure_gaps(people, relations)
    if subject.birth_year:
        return {
            "person": _person_stub(subject),
            "known_birth_year": subject.birth_year,
            "note": "This person already has a recorded birth year; no estimate needed.",
            "generation_gap": {"project": project_stats},
        }

    # Two *one-directional* walks. A single walk that may go both ways drifts
    # sideways through marriages — down to a shared child, back up to the other
    # parent — and ends up offering in-laws from an unrelated branch as evidence.
    # Only pure ancestors and pure descendants are blood relatives of the
    # subject, and only those anchor an estimate.
    def line(step_fn, sign: int) -> dict[int, int]:
        found: dict[int, int] = {}
        seen = {pid}
        frontier = [pid]
        for gen in range(1, max_gen + 1):
            nxt = []
            for cur in frontier:
                for other in step_fn(cur):
                    if other in seen or other not in people:
                        continue
                    seen.add(other)
                    found[other] = sign * gen
                    nxt.append(other)
            if not nxt:
                break
            frontier = nxt
        return found

    dist: dict[int, int] = {}
    dist.update(line(lambda c: _children_of(c, relations), +1))
    dist.update(line(lambda c: _parents_of(ctx, c, relations), -1))

    # Measure the generation length on this person's own blood line first — it
    # is the rhythm that actually applies to them. Only fall back to the whole
    # project when the local sample is too thin to trust.
    lineage = set(dist) | {pid}
    local_stats = _measure_gaps(people, relations, restrict_to=lineage)
    use_local = local_stats["sample_size"] >= LOCAL_GAP_MIN_SAMPLE
    stats = local_stats if use_local else project_stats
    if stats["sample_size"] == 0:
        return {
            "person": _person_stub(subject),
            "generation_gap": {"local": local_stats, "project": project_stats},
            "note": (
                "No dated parent-child pair exists anywhere in this project, so there is "
                "no measured generation length to reason from and no estimate is possible."
            ),
        }

    med = float(stats["median"])
    anchors: list[dict[str, Any]] = []
    for other_id, d in dist.items():
        if not people[other_id].birth_year:
            continue
        # A descendant d generations below was born ~d gaps later.
        estimate = people[other_id].birth_year - d * med
        anchors.append({
            "person": _person_stub(people[other_id]),
            "generations": d,
            "direction": "descendant" if d > 0 else "ancestor",
            "their_birth_year": people[other_id].birth_year,
            "implied_birth_year": round(estimate),
        })

    if not anchors:
        return {
            "person": _person_stub(subject),
            "generation_gap": {"local": local_stats, "project": project_stats},
            "relatives_searched": {
                "descendants": sum(1 for d in dist.values() if d > 0),
                "ancestors": sum(1 for d in dist.values() if d < 0),
                "max_generations": max_gen,
            },
            "note": (
                f"No direct ancestor or descendant within {max_gen} generations has a "
                "recorded birth year, so no estimate is possible. Only blood relatives in "
                "a straight line are used — in-laws say nothing about when this person "
                "lived. Raising max_generations will not help if the counts above are zero."
            ),
        }

    # Closest relatives carry the least accumulated error — weight by distance.
    anchors.sort(key=lambda x: (abs(x["generations"]), x["person"]["id"]))
    closest = [x for x in anchors if abs(x["generations"]) == abs(anchors[0]["generations"])]
    ests = sorted(x["implied_birth_year"] for x in closest)
    best = ests[len(ests) // 2]
    steps = abs(anchors[0]["generations"])
    spread = round(steps * (float(stats["high"]) - float(stats["low"])) / 2)

    which = "this person's own blood line" if use_local else "the whole project"
    result = {
        "person": _person_stub(subject),
        "generation_gap": {
            "used": "local" if use_local else "project",
            "local": local_stats,
            "project": project_stats,
            "note": (
                f"Generation length measured from {which} "
                f"(n={stats['sample_size']} dated parent-child pairs)."
                if use_local else
                f"Only {local_stats['sample_size']} dated parent-child pair(s) exist on this "
                f"person's own line — too few to measure from, so the project-wide figure "
                f"is used instead."
            ),
        },
        "estimated_birth_year": best,
        "plausible_range": [best - spread, best + spread],
        "based_on": closest[:6],
        "all_anchors": anchors[:12],
        "method": (
            f"Nearest dated relatives are {steps} generation(s) away. Their birth years "
            f"were shifted by {steps} x {stats['median']} years (measured median "
            f"parent-child gap, n={stats['sample_size']}); the range uses the "
            f"{stats['low']}-{stats['high']} year quartile spread."
        ),
        "caveat": "An estimate, not a record. Present it as such and show the reasoning.",
    }
    # A thin local sample that disagrees with the project figure is worth
    # surfacing: it is the difference between a decade of confidence and none.
    if not use_local and local_stats["sample_size"] > 0:
        alt = round(closest[0]["their_birth_year"] - steps * float(local_stats["median"]))
        if abs(alt - best) >= 5:
            result["cross_check"] = (
                f"The {local_stats['sample_size']} pair(s) on this person's own line suggest a "
                f"{local_stats['median']}-year generation, which would place the birth near {alt} "
                f"instead of {best}. Too small a sample to rely on, but mention the uncertainty."
            )
    return result


def _t_list_events(ctx: ToolContext, a: dict[str, Any]) -> Any:
    limit = min(int(a.get("limit") or 30), MAX_RESULTS)
    q = ctx.db.query(DBEvent)
    if a.get("event_type"):
        q = q.filter(DBEvent.event_type == a["event_type"])
    if a.get("year_from") is not None:
        q = q.filter(DBEvent.year >= int(a["year_from"]))
    if a.get("year_to") is not None:
        q = q.filter(DBEvent.year <= int(a["year_to"]))

    pid = a.get("person_id")
    if pid is not None:
        ev_ids = [ep.event_id for ep in ctx.db.query(DBEventPerson).filter(DBEventPerson.person_id == int(pid)).all()]
        if not ev_ids:
            return {"count": 0, "events": []}
        q = q.filter(DBEvent.id.in_(ev_ids))

    place = _norm(a.get("place"))
    evs = [e for e in q.order_by(DBEvent.year, DBEvent.id).all() if _priv_ok(ctx, e)]
    if place:
        evs = [e for e in evs if place in _norm(e.place)]

    result = _capped(
        {"events": [_event_with_persons(ctx, e) for e in evs[:limit]]},
        "events", limit, total=len(evs),
    )

    # An empty result from a guessed `event_type` is indistinguishable from
    # "this person has no events" — so say which types actually exist. The
    # stored value is a fixed vocabulary ('religious', 'custom', …) and rarely
    # the word a question uses ("confirmation").
    if not result["events"] and a.get("event_type"):
        available = sorted({
            e.event_type for e in ctx.db.query(DBEvent).all()
            if e.event_type and _priv_ok(ctx, e)
        })
        result["note"] = (
            f"No event matched event_type={a['event_type']!r}. "
            f"Types present in this project: {available}. "
            "Retry without the event_type filter if unsure."
        )
        result["available_event_types"] = available
    return result


def _t_list_documents(ctx: ToolContext, a: dict[str, Any]) -> Any:
    limit = min(int(a.get("limit") or 30), MAX_RESULTS)
    q = ctx.db.query(DBDocument)
    if a.get("doc_type"):
        q = q.filter(DBDocument.doc_type == a["doc_type"])
    if a.get("year_from") is not None:
        q = q.filter(DBDocument.year >= int(a["year_from"]))
    if a.get("year_to") is not None:
        q = q.filter(DBDocument.year <= int(a["year_to"]))

    pid = a.get("person_id")
    if pid is not None:
        ids = {dp.document_id for dp in ctx.db.query(DBDocumentPerson).filter(DBDocumentPerson.person_id == int(pid)).all()}
        ids |= {d.id for d in ctx.db.query(DBDocument).filter(DBDocument.person_id == int(pid)).all()}
        if not ids:
            return {"count": 0, "documents": []}
        q = q.filter(DBDocument.id.in_(ids))

    docs = [d for d in q.order_by(DBDocument.year, DBDocument.id).all() if _priv_ok(ctx, d)]
    return _capped(
        {"documents": [_doc_dict(ctx, d) for d in docs[:limit]]},
        "documents", limit, total=len(docs),
    )


def _t_get_document(ctx: ToolContext, a: dict[str, Any]) -> Any:
    """One document in full: its text, its notes, who it is about, its sources.

    `list_documents` returns titles, and a title invites a summary of a document
    nobody read. This is the tool that actually opens one — and, for an uploaded
    file, the tool that says plainly that it cannot be opened at all.
    """
    did = int(a["document_id"])
    d = ctx.db.get(DBDocument, did)
    if d is None:
        return {"error": f"No document with id {did}"}
    if not _priv_ok(ctx, d):
        return {
            "error": f"Document {did} is marked private and is hidden from this session",
            "note": "Tell the user it exists but is private rather than that it is absent.",
        }

    out = _doc_with_body(ctx, d, offset=int(a.get("offset") or 0))

    pids = {dp.person_id for dp in ctx.db.query(DBDocumentPerson).filter(DBDocumentPerson.document_id == did).all()}
    if d.person_id:
        pids.add(d.person_id)
    people = ctx.db.query(DBPerson).filter(DBPerson.id.in_(pids)).all() if pids else []
    out["persons"] = [_person_stub(x) for x in sorted(people, key=lambda x: x.id)]

    notes = ctx.db.query(DBDocumentNote).filter(
        DBDocumentNote.document_id == did
    ).order_by(DBDocumentNote.sort_order, DBDocumentNote.id).all()
    out["notes"] = [{"id": n.id, "title": n.title, "content": n.content} for n in notes]

    src = ctx.db.query(DBSource).filter(DBSource.document_id == did).first()
    if src is not None:
        out["source"] = {
            "id": src.id, "title": src.title, "source_type": src.source_type,
            "author": src.author, "year": src.year, "publisher": src.publisher,
            "location": src.location, "url": src.url, "description": src.description,
        }
    return out


def _t_search_text(ctx: ToolContext, a: dict[str, Any]) -> Any:
    """Keyword search over the free-text corpus.

    Plain Python matching rather than FTS5: at this corpus size the index would
    be pure overhead, and Python gives accent-insensitive matching that SQLite's
    ASCII-only LIKE cannot.
    """
    q = _norm(a.get("query"))
    if not q:
        # Browsing returns one short entry per item, so it can afford a wider cap
        # than a search whose hits carry excerpts.
        return _t_list_written_material(ctx, min(int(a.get("limit") or 40), 120))
    limit = min(int(a.get("limit") or 20), MAX_RESULTS)
    hits: list[dict[str, Any]] = []

    def _excerpt(body: str) -> str:
        idx = _norm(body).find(q)
        if idx < 0:
            return body[:200]
        start = max(0, idx - 80)
        return ("…" if start else "") + body[start:idx + 220].strip() + "…"

    for n in ctx.db.query(DBPersonNote).order_by(DBPersonNote.id).all():
        if not _priv_ok(ctx, n):
            continue
        body = f"{n.title or ''}\n{n.content or ''}"
        if q in _norm(body):
            hits.append({
                "kind": "note", "id": n.id, "person_id": n.person_id,
                "title": n.title, "excerpt": _excerpt(n.content or ""),
            })

    for d in ctx.db.query(DBDocument).order_by(DBDocument.id).all():
        if not _priv_ok(ctx, d):
            continue
        text_body, _kind = _document_body(ctx, d)
        body = "\n".join(filter(None, [d.title, d.description, text_body]))
        if q in _norm(body):
            hits.append({
                "kind": "document", "id": d.id, "title": d.title,
                "doc_type": d.doc_type, "year": d.year, "excerpt": _excerpt(body),
            })

    for dn in ctx.db.query(DBDocumentNote).order_by(DBDocumentNote.id).all():
        doc = ctx.db.get(DBDocument, dn.document_id)
        if doc is not None and not _priv_ok(ctx, doc):
            continue
        body = f"{dn.title or ''}\n{dn.content or ''}"
        if q in _norm(body):
            hits.append({
                "kind": "document_note", "id": dn.id, "document_id": dn.document_id,
                "title": dn.title, "excerpt": _excerpt(dn.content or ""),
            })

    for pr in ctx.db.query(DBPerson).order_by(DBPerson.id).all():
        if (pr.notes or "").strip() and q in _norm(pr.notes):
            hits.append({
                "kind": "profile_note", "id": pr.id, "person_id": pr.id,
                "excerpt": _excerpt(pr.notes or ""),
            })

    for s in ctx.db.query(DBSource).order_by(DBSource.id).all():
        body = "\n".join(filter(None, [s.title, s.author, s.publisher, s.description]))
        if q in _norm(body):
            hits.append({
                "kind": "source", "id": s.id, "title": s.title,
                "author": s.author, "year": s.year, "excerpt": _excerpt(body),
            })

    result = _capped({"hits": hits}, "hits", limit)
    if not hits:
        result["note"] = (
            "No text matched. This searches words, so a miss means this wording is "
            "absent — not that the subject is unrecorded. Try another word, or call "
            "search_text with no query to see everything that is written down."
        )
    return result


def _t_list_written_material(ctx: ToolContext, limit: int) -> Any:
    """Everything written in this project, listed rather than searched.

    Keyword search can only find what you already suspect is there. Asked what a
    family's story is, a model with only a keyword tool guesses search terms,
    misses, and concludes nothing was written — while the notes sit one call
    away. This is that call: the whole prose corpus, with openings, so the model
    can see what exists and then read the parts that matter.
    """
    items: list[dict[str, Any]] = []

    def opening(body: str) -> str:
        text = " ".join((body or "").split())
        return text[:180] + ("…" if len(text) > 180 else "")

    for n in ctx.db.query(DBPersonNote).order_by(DBPersonNote.person_id, DBPersonNote.id).all():
        if not _priv_ok(ctx, n):
            continue
        items.append({
            "kind": "note", "id": n.id, "person_id": n.person_id, "title": n.title,
            "chars": len(n.content or ""), "opening": opening(n.content or ""),
            "read_with": "get_person(person_id) returns this note in full",
        })

    for d in ctx.db.query(DBDocument).order_by(DBDocument.id).all():
        if not _priv_ok(ctx, d):
            continue
        body, kind = _document_body(ctx, d)
        items.append({
            "kind": "document", "id": d.id, "title": d.title, "doc_type": d.doc_type,
            "year": d.year, "readable": bool(kind),
            "transcribed": kind == "transcript", "person_id": d.person_id,
            "description": d.description,
            "chars": len(body) if body else 0,
            "opening": opening(body) if body else None,
            "read_with": {
                "text": "get_document(document_id) returns the whole text",
                "transcript": "get_document(document_id) returns the transcript of this scan",
                "pdf": "get_document(document_id) returns the text this PDF carries inside it",
            }.get(kind, "an attached file — its contents cannot be read, only this metadata"),
        })

    for dn in ctx.db.query(DBDocumentNote).order_by(DBDocumentNote.id).all():
        doc = ctx.db.get(DBDocument, dn.document_id)
        if doc is not None and not _priv_ok(ctx, doc):
            continue
        items.append({
            "kind": "document_note", "id": dn.id, "document_id": dn.document_id,
            "title": dn.title, "chars": len(dn.content or ""),
            "opening": opening(dn.content or ""),
            "read_with": "get_document(document_id) returns this note",
        })

    for pr in ctx.db.query(DBPerson).order_by(DBPerson.id).all():
        if (pr.notes or "").strip():
            items.append({
                "kind": "profile_note", "id": pr.id, "person_id": pr.id,
                "chars": len(pr.notes), "opening": opening(pr.notes),
                "read_with": "get_person(person_id) returns this as profile_note",
            })

    for src in ctx.db.query(DBSource).order_by(DBSource.id).all():
        items.append({
            "kind": "source", "id": src.id, "title": src.title,
            "source_type": src.source_type, "author": src.author, "year": src.year,
            "opening": opening(src.description or ""),
        })

    for e in ctx.db.query(DBEvent).order_by(DBEvent.year, DBEvent.id).all():
        if not _priv_ok(ctx, e) or not (e.description or "").strip():
            continue
        items.append({
            "kind": "event_description", "id": e.id, "title": e.title,
            "year": e.year, "chars": len(e.description),
            "opening": opening(e.description),
            "read_with": "list_events returns this description",
        })

    # The per-kind totals are computed before the cap and survive it. A listing
    # cut off at 40 items would otherwise show four notes and no documents and
    # read as a project with no documents — the very failure this tool exists to
    # prevent, reintroduced by truncation.
    by_kind: dict[str, int] = {}
    for it in items:
        by_kind[it["kind"]] = by_kind.get(it["kind"], 0) + 1

    result = _capped({"material": items}, "material", limit)
    result["by_kind"] = dict(sorted(by_kind.items()))
    result["note"] = (
        "`by_kind` counts the whole corpus even when the list below is cut short, so "
        "a kind missing from the list is not a kind missing from the project. An "
        "empty corpus means nobody has written anything down yet — worth telling the "
        "user. Otherwise read the items that bear on the question before answering."
    )
    return result


def _t_get_statistics(ctx: ToolContext, a: dict[str, Any]) -> Any:
    db = ctx.db
    persons = db.query(DBPerson).all()
    birth_years = [p.birth_year for p in persons if p.birth_year]
    rels = _visible_relations(ctx)
    return {
        "persons": len(persons),
        "with_birth_year": len(birth_years),
        "earliest_birth_year": min(birth_years) if birth_years else None,
        "latest_birth_year": max(birth_years) if birth_years else None,
        "relations": len(rels),
        "parent_relations": sum(1 for r in rels if r.type == "parent"),
        "spouse_relations": sum(1 for r in rels if r.type == "spouse"),
        "events": sum(1 for e in db.query(DBEvent).all() if _priv_ok(ctx, e)),
        "documents": sum(1 for d in db.query(DBDocument).all() if _priv_ok(ctx, d)),
        "notes": sum(1 for n in db.query(DBPersonNote).all() if _priv_ok(ctx, n)),
        "sources": db.query(DBSource).count(),
        "images": sum(1 for i in db.query(DBImage).all() if _priv_ok(ctx, i)),
    }


def _parse_full_date(s: str | None) -> tuple[int, int, int] | None:
    """A full `YYYY-MM-DD` only — `YYYY` and `YYYY-MM` carry no day of year."""
    if not s or len(s) != 10 or s[4] != "-" or s[7] != "-":
        return None
    try:
        y, m, d = int(s[:4]), int(s[5:7]), int(s[8:10])
        date(y, m, d)  # validates the calendar, e.g. rejects day 31 in April
        return y, m, d
    except ValueError:
        return None


def _month_day_in_year(m: int, d: int, year: int) -> date | None:
    try:
        return date(year, m, d)
    except ValueError:
        # Feb 29 in a non-leap year: the day it would have been, not a skip.
        return date(year, 3, 1) if (m, d) == (2, 29) else None


def _next_occurrence(m: int, d: int, today: date) -> date | None:
    candidate = _month_day_in_year(m, d, today.year)
    if candidate is not None and candidate < today:
        candidate = _month_day_in_year(m, d, today.year + 1)
    return candidate


def _t_get_upcoming_anniversaries(ctx: ToolContext, a: dict[str, Any]) -> Any:
    """Birth and death anniversaries falling in a window starting today.

    Computed here, not left to the model: this needs comparing a month and day
    while ignoring the year, wrapping that comparison across a year boundary,
    and doing it for every person in the tree — exactly the kind of arithmetic
    that looks right and is quietly off by one. The tree skeleton only carries
    whole years, so this reads `birth_date`/`death_date` directly and only
    counts a person whose date is recorded to the day.

    Deceased people are included on purpose — a death does not remove a
    birthday from the calendar, it only changes how the answer should phrase
    it (`deceased` says which).
    """
    today = date.today()
    days_arg, limit_arg = a.get("days"), a.get("limit")
    days = max(0, min(int(days_arg) if days_arg is not None else 7, 366))
    end = today + timedelta(days=days)
    limit = min(int(limit_arg) if limit_arg is not None else 50, 100)

    results: list[dict[str, Any]] = []
    for p in ctx.db.query(DBPerson).order_by(DBPerson.id).all():
        for raw, kind in ((p.birth_date, "birth"), (p.death_date, "death")):
            parsed = _parse_full_date(raw)
            if not parsed:
                continue
            y, m, d = parsed
            occurrence = _next_occurrence(m, d, today)
            if occurrence is None or not (today <= occurrence <= end):
                continue
            results.append({
                **_person_stub(p),
                "kind": kind,
                "anniversary": f"{m:02d}-{d:02d}",
                "next_occurrence": occurrence.isoformat(),
                "days_until": (occurrence - today).days,
                "years": occurrence.year - y,
                "deceased": p.death_year is not None,
            })

    results.sort(key=lambda r: (r["days_until"], r["kind"], r["id"]))
    payload: dict[str, Any] = {
        "today": today.isoformat(),
        "window_end": end.isoformat(),
        "results": results,
    }
    return _capped(payload, "results", limit)


def _person_image_ids(ctx: ToolContext, pid: int) -> set[int]:
    clusters = [
        c for c in ctx.db.query(DBCluster).filter(DBCluster.person_id == pid).all()
        if _priv_ok(ctx, c)
    ]
    if not clusters:
        return set()
    cids = [c.id for c in clusters]
    return {f.image_id for f in ctx.db.query(DBFace).filter(DBFace.cluster_id.in_(cids)).all()}


def _t_find_shared_photos(ctx: ToolContext, a: dict[str, Any]) -> Any:
    """Photos containing *all* of the given people.

    The intersection is computed here rather than left to the model: counting
    and intersecting id lists by hand is exactly the kind of arithmetic that
    looks right and is quietly off by one.
    """
    ids = [int(x) for x in (a.get("person_ids") or [])]
    if len(ids) < 2:
        return {"error": "person_ids needs at least two people"}
    limit = min(int(a.get("limit") or 50), 200)

    people = {p.id: p for p in ctx.db.query(DBPerson).filter(DBPerson.id.in_(ids)).all()}
    missing = [i for i in ids if i not in people]
    if missing:
        return {"error": f"No person with id(s) {missing}"}

    common: set[int] | None = None
    per_person = {}
    for pid in ids:
        s = _person_image_ids(ctx, pid)
        per_person[pid] = len(s)
        common = s if common is None else (common & s)
    common = common or set()

    imgs = [i for i in ctx.db.query(DBImage).filter(DBImage.id.in_(common)).all() if _priv_ok(ctx, i)] if common else []
    imgs.sort(key=lambda i: (i.exif_date is None, i.exif_date, i.id))

    return {
        "person_ids": ids,
        "persons": [_person_stub(people[i]) for i in ids],
        "count": len(imgs),
        "photos_per_person": per_person,
        "photos": [
            {
                "image_id": i.id,
                "year": i.exif_date.year if i.exif_date else None,
                "date": i.exif_date.isoformat() if i.exif_date else None,
                "filename": Path(i.path).name,
            }
            for i in imgs[:limit]
        ],
        "link_hint": (
            "Offer the user the filtered gallery as "
            f"[link text](#people-{','.join(str(i) for i in ids)}) — it opens the "
            "Images tab showing exactly these photos, ready to select and export."
        ),
    }


def _t_find_photos(ctx: ToolContext, a: dict[str, Any]) -> Any:
    """General photo query — the workhorse for photo-library use.

    Mnemosyne is also used purely as a photo organiser, where the questions are
    "which pictures have these three people", "what do we have from the
    seventies", "which faces are still unidentified". Every answer ends with a
    gallery link so the user can act on it (select, tag, export) rather than
    read a list of numbers.
    """
    ids = [int(x) for x in (a.get("person_ids") or [])]
    match = (a.get("match") or "all").lower()
    y_from, y_to = a.get("year_from"), a.get("year_to")
    only_unidentified = bool(a.get("only_unidentified", False))
    limit = min(int(a.get("limit") or 40), 200)

    people = {p.id: p for p in ctx.db.query(DBPerson).filter(DBPerson.id.in_(ids)).all()} if ids else {}
    missing = [i for i in ids if i not in people]
    if missing:
        return {"error": f"No person with id(s) {missing}"}

    if ids:
        sets = [_person_image_ids(ctx, pid) for pid in ids]
        keep: set[int] = set()
        if match == "any":
            for s in sets:
                keep |= s
        else:
            keep = sets[0]
            for s in sets[1:]:
                keep &= s
        imgs = ctx.db.query(DBImage).filter(DBImage.id.in_(keep)).all() if keep else []
    else:
        imgs = ctx.db.query(DBImage).all()

    imgs = [i for i in imgs if _priv_ok(ctx, i)]

    if only_unidentified:
        # Images that have faces, none of which belong to a named person.
        named_clusters = {
            c.id for c in ctx.db.query(DBCluster).filter(DBCluster.person_id.isnot(None)).all()
        }
        by_image: dict[int, list[Any]] = {}
        for f in ctx.db.query(DBFace).all():
            by_image.setdefault(f.image_id, []).append(f)
        imgs = [
            i for i in imgs
            if by_image.get(i.id) and not any(f.cluster_id in named_clusters for f in by_image[i.id])
        ]

    out = []
    for i in sorted(imgs, key=lambda i: (i.exif_date is None, i.exif_date, i.id)):
        year = i.exif_date.year if i.exif_date else None
        if y_from is not None and (year is None or year < int(y_from)):
            continue
        if y_to is not None and (year is None or year > int(y_to)):
            continue
        out.append({
            "image_id": i.id,
            "year": year,
            "date": i.exif_date.isoformat() if i.exif_date else None,
            "filename": Path(i.path).name,
        })

    result = _capped({"photos": out}, "photos", limit)
    if ids:
        result["gallery_link"] = f"#people-{','.join(str(i) for i in ids)}"
        result["link_hint"] = (
            f"Give the user [caption](#people-{','.join(str(i) for i in ids)}) — it opens "
            "the Images tab on exactly this set, ready to select and export."
        )
    result["persons"] = [_person_stub(people[i]) for i in ids]
    return result


def _t_get_photo_stats(ctx: ToolContext, a: dict[str, Any]) -> Any:
    """Overview of the photo library: who appears most, when photos were taken,
    and how much is still unidentified."""
    top_n = min(int(a.get("top_n") or 15), 50)

    images = [i for i in ctx.db.query(DBImage).all() if _priv_ok(ctx, i)]
    visible_ids = {i.id for i in images}
    faces = [f for f in ctx.db.query(DBFace).all() if f.image_id in visible_ids]
    clusters = {c.id: c for c in ctx.db.query(DBCluster).all() if _priv_ok(ctx, c)}
    people = {p.id: p for p in ctx.db.query(DBPerson).all()}

    per_person: dict[int, set[int]] = {}
    identified_images: set[int] = set()
    for f in faces:
        c = clusters.get(f.cluster_id) if f.cluster_id else None
        if c and c.person_id and c.person_id in people:
            per_person.setdefault(c.person_id, set()).add(f.image_id)
            identified_images.add(f.image_id)

    images_with_faces = {f.image_id for f in faces}
    by_decade: dict[str, int] = {}
    undated = 0
    for i in images:
        if i.exif_date:
            by_decade[f"{(i.exif_date.year // 10) * 10}s"] = by_decade.get(f"{(i.exif_date.year // 10) * 10}s", 0) + 1
        else:
            undated += 1

    status: dict[str, int] = {}
    for i in images:
        status[i.scan_status or "unknown"] = status.get(i.scan_status or "unknown", 0) + 1

    top = sorted(per_person.items(), key=lambda kv: -len(kv[1]))[:top_n]
    return {
        "images_total": len(images),
        "images_with_faces": len(images_with_faces),
        "images_with_identified_people": len(identified_images),
        "images_with_faces_but_nobody_named": len(images_with_faces - identified_images),
        "images_without_any_face": len(images) - len(images_with_faces),
        "images_without_a_date": undated,
        "scan_status": status,
        "by_decade": dict(sorted(by_decade.items())),
        "people_appearing_in_photos": len(per_person),
        "top_people": [
            {**_person_stub(people[pid]), "photo_count": len(imgs)}
            for pid, imgs in top
        ],
    }


def _t_list_photos_of(ctx: ToolContext, a: dict[str, Any]) -> Any:
    """Photo *metadata* for a person, from the local face recognition.

    Identity comes from the local ArcFace pipeline, never from the model — it is
    more accurate here and costs nothing. The images themselves are not returned.
    """
    pid = int(a["person_id"])
    limit = min(int(a.get("limit") or 20), MAX_RESULTS)
    clusters = [c for c in ctx.db.query(DBCluster).filter(DBCluster.person_id == pid).all() if _priv_ok(ctx, c)]
    if not clusters:
        return {"count": 0, "photos": [], "note": "No face cluster is linked to this person"}

    cids = [c.id for c in clusters]
    image_ids = {f.image_id for f in ctx.db.query(DBFace).filter(DBFace.cluster_id.in_(cids)).all()}
    if not image_ids:
        return {"count": 0, "photos": []}

    imgs = [i for i in ctx.db.query(DBImage).filter(DBImage.id.in_(image_ids)).all() if _priv_ok(ctx, i)]

    y_from, y_to = a.get("year_from"), a.get("year_to")
    out = []
    for i in sorted(imgs, key=lambda i: (i.exif_date is None, i.exif_date, i.id)):
        year = i.exif_date.year if i.exif_date else None
        if y_from is not None and (year is None or year < int(y_from)):
            continue
        if y_to is not None and (year is None or year > int(y_to)):
            continue
        out.append({
            "image_id": i.id,
            "year": year,
            "date": i.exif_date.isoformat() if i.exif_date else None,
            "filename": Path(i.path).name,
        })
    result = _capped({"photos": out}, "photos", limit)
    if result.get("truncated"):
        result["note"] += (
            " For 'how many photos have X and Y together', call find_shared_photos "
            "instead of intersecting photo lists."
        )
    return result


# ── registry construction ─────────────────────────────────────────────────────


def build_registry() -> ToolRegistry:
    r = ToolRegistry()

    r.register(Tool(
        name="search_persons",
        description=(
            "Find people in the family tree by name fragment, birth year range, "
            "place or occupation. Returns name parts and life years. Use this "
            "first when the user names someone you need an id for."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Name fragment; accent- and case-insensitive."},
                "birth_year_from": {"type": "integer"},
                "birth_year_to": {"type": "integer"},
                "place": {"type": "string", "description": "Matches any of birth/death/christening/burial place."},
                "occupation": {"type": "string"},
                "missing": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Return only people for whom every listed field is empty, "
                        "e.g. ['birth_date','birth_year'] for 'who has no birth date'. "
                        "Use this rather than answering the opposite question."
                    ),
                },
                "limit": {"type": "integer", "description": "Default 25, max 50."},
            },
        },
        handler=_t_search_persons,
    ))

    r.register(Tool(
        name="get_person",
        description=(
            "Everything recorded about one person: biographical fields, which of "
            "those fields are empty, relations, events, research notes, attached "
            "documents with the full text of any written in the app, a photo "
            "count with its gallery link, and cited sources. This is the tool to "
            "call before describing anybody — the tree skeleton in your prompt "
            "holds only names, years and edges, so a description built from it "
            "silently claims nothing else was recorded."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "person_id": {"type": "integer"},
                "include": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": ["relations", "events", "documents", "notes", "photos", "sources"],
                    },
                    "description": "Defaults to all of them. Leave it out unless you have a reason.",
                },
            },
            "required": ["person_id"],
        },
        handler=_t_get_person,
    ))

    r.register(Tool(
        name="get_relationship_path",
        description=(
            "Shortest relationship path between two people, as a chain of "
            "parent/child/spouse steps. Call this instead of walking the tree "
            "yourself with repeated get_person calls."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "person_a_id": {"type": "integer"},
                "person_b_id": {"type": "integer"},
            },
            "required": ["person_a_id", "person_b_id"],
        },
        handler=_t_get_relationship_path,
    ))

    r.register(Tool(
        name="get_ancestors",
        description=(
            "Walk a person's ancestor line and return it as an ordered chain "
            "with generation numbers. Use this for any 'who is my oldest "
            "ancestor', 'trace the male line', 'how far back does X go' "
            "question — never trace a line yourself with repeated get_person "
            "calls, because people in this tree share given names and a "
            "hand-traced line drops generations. The walk follows parent links, "
            "not dates: it runs past the undated ancestors that a tree usually "
            "ends in, which is exactly where a hand-traced line stops early."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "person_id": {"type": "integer"},
                "line": {
                    "type": "string",
                    "enum": ["paternal", "maternal", "both"],
                    "description": "Paternal follows fathers only, maternal follows mothers only. Default paternal.",
                },
                "max_generations": {"type": "integer", "description": "Default 20, max 40."},
            },
            "required": ["person_id"],
        },
        handler=_t_get_ancestors,
    ))

    r.register(Tool(
        name="get_descendants",
        description=(
            "Everyone descending from a person, grouped by generation, with a "
            "count of how many have a recorded birth year. Use this whenever a "
            "question looks downward — children, grandchildren, 'how many "
            "descendants', or to find dated relatives of an undated person."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "person_id": {"type": "integer"},
                "max_generations": {"type": "integer", "description": "Default 6, max 12."},
                "dated_only": {"type": "boolean", "description": "List only people with a birth year."},
            },
            "required": ["person_id"],
        },
        handler=_t_get_descendants,
    ))

    r.register(Tool(
        name="estimate_life_period",
        description=(
            "Estimate when an undated person was probably born, from the birth "
            "years of their nearest dated relatives and this family's own "
            "measured generation length. Use it for 'roughly when did X live'. "
            "Do not do this arithmetic yourself and do not assume a textbook "
            "generation length — this tool measures the real one from the data."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "person_id": {"type": "integer"},
                "max_generations": {
                    "type": "integer",
                    "description": "How far to look for a dated relative. Default 12, max 25.",
                },
            },
            "required": ["person_id"],
        },
        handler=_t_estimate_life_period,
    ))

    r.register(Tool(
        name="list_events",
        description=(
            "Events, filterable by person, type, year range or place. "
            "`event_type` is a fixed stored vocabulary (e.g. 'religious', "
            "'custom', 'military'), not free text — when unsure, omit it and "
            "filter the results yourself."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "person_id": {"type": "integer"},
                "event_type": {"type": "string"},
                "year_from": {"type": "integer"},
                "year_to": {"type": "integer"},
                "place": {"type": "string"},
                "limit": {"type": "integer", "description": "Default 30, max 50."},
            },
        },
        handler=_t_list_events,
    ))

    r.register(Tool(
        name="list_documents",
        description=(
            "Document metadata (certificates, letters, records, chronicles): "
            "titles, types and years. Never the text — call get_document for "
            "that. Summarising a document from its title invents it. Each row's "
            "`readable` flag says whether get_document can actually open it."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "person_id": {"type": "integer"},
                "doc_type": {"type": "string"},
                "year_from": {"type": "integer"},
                "year_to": {"type": "integer"},
                "limit": {"type": "integer", "description": "Default 30, max 50."},
            },
        },
        handler=_t_list_documents,
    ))

    r.register(Tool(
        name="get_document",
        description=(
            "One document in full, plus its notes, the people it is about and its "
            "source. Returns the actual text for anything written inside the app, "
            "for a scan that has been transcribed, and for a PDF that carries its "
            "own text layer — so open a PDF before saying anything about it, "
            "rather than assuming an uploaded file cannot be read. For a file that "
            "genuinely cannot be (a photograph, a recording, a scanned PDF with no "
            "text in it) it returns the metadata and says so plainly — report "
            "that rather than describing what it probably says."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "document_id": {"type": "integer"},
                "offset": {
                    "type": "integer",
                    "description": (
                        "Character offset to read from, for a document longer than "
                        "one response. The result carries the total length and the "
                        "`next_offset` that continues it. Default 0."
                    ),
                },
            },
            "required": ["document_id"],
        },
        handler=_t_get_document,
    ))

    r.register(Tool(
        name="search_text",
        description=(
            "The project's prose: research notes, in-app documents, document "
            "notes, event descriptions and source descriptions. With a `query` "
            "it searches them; **with no `query` it lists all of them** — every "
            "piece of writing with its owner and opening line. Use the listing "
            "whenever you need to know what has been written down at all, "
            "rather than whether one particular word appears. Guessing search "
            "terms and missing is how a well-documented family gets reported as "
            "having nothing recorded."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Omit entirely to list the whole written corpus.",
                },
                "limit": {"type": "integer", "description": "Searching: default 20, max 50. Listing: default 40, max 120."},
            },
        },
        handler=_t_search_text,
    ))

    r.register(Tool(
        name="get_statistics",
        description="Project-wide counts: people, relations, events, documents, notes, sources, photos, and the birth-year span.",
        input_schema={"type": "object", "properties": {}},
        handler=_t_get_statistics,
    ))

    r.register(Tool(
        name="get_upcoming_anniversaries",
        description=(
            "Who has a birth or death anniversary in a date window starting "
            "today, deceased people included — a death does not remove a "
            "birthday. Use this for any 'whose birthday is coming up', 'any "
            "anniversaries this week/month' question. Only people with a full "
            "recorded date ('YYYY-MM-DD', not just a year) can appear, because "
            "only a full date carries a month and day. Never try to answer "
            "this from the tree skeleton (it only has whole years) or by "
            "calling get_person on everyone and comparing dates yourself — "
            "call this instead, it does the month/day comparison and the "
            "year-boundary wraparound correctly."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "days": {
                    "type": "integer",
                    "description": "How many days ahead of today to include, inclusive of both ends. Default 7, max 366.",
                },
                "limit": {"type": "integer", "description": "Default 50, max 100."},
            },
        },
        handler=_t_get_upcoming_anniversaries,
    ))

    r.register(Tool(
        name="find_shared_photos",
        description=(
            "Photos that contain all of the given people at once. Use this for "
            "any 'how many pictures have X and Y together' question instead of "
            "listing each person's photos and intersecting the ids yourself."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "person_ids": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "description": "Two or more person ids.",
                },
                "limit": {"type": "integer", "description": "Default 50, max 200."},
            },
            "required": ["person_ids"],
        },
        handler=_t_find_shared_photos,
    ))

    r.register(Tool(
        name="find_photos",
        description=(
            "Search the photo library: by people (all of them together, or any "
            "of them), by year range, or for pictures whose faces are still "
            "unidentified. Returns a gallery link the user can open to select "
            "and export the result. This is the main tool for photo-library "
            "questions — prefer it over listing one person's photos."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "person_ids": {"type": "array", "items": {"type": "integer"}},
                "match": {
                    "type": "string", "enum": ["all", "any"],
                    "description": "'all' = every listed person is in the photo (default); 'any' = at least one.",
                },
                "year_from": {"type": "integer"},
                "year_to": {"type": "integer"},
                "only_unidentified": {
                    "type": "boolean",
                    "description": "Only photos that have faces but nobody named yet.",
                },
                "limit": {"type": "integer", "description": "Default 40, max 200."},
            },
        },
        handler=_t_find_photos,
    ))

    r.register(Tool(
        name="get_photo_stats",
        description=(
            "Overview of the photo library: totals, how many photos per decade, "
            "who appears in the most pictures, and how much is still unscanned "
            "or unidentified. Good starting point for 'what have I got' and for "
            "suggesting what to tidy up next."
        ),
        input_schema={
            "type": "object",
            "properties": {"top_n": {"type": "integer", "description": "How many people to rank. Default 15, max 50."}},
        },
        handler=_t_get_photo_stats,
    ))

    r.register(Tool(
        name="list_photos_of",
        description=(
            "Photos a person appears in, according to the local face recognition. "
            "Returns metadata (id, year, filename) — not the images themselves."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "person_id": {"type": "integer"},
                "year_from": {"type": "integer"},
                "year_to": {"type": "integer"},
                "limit": {"type": "integer", "description": "Default 20, max 50."},
            },
            "required": ["person_id"],
        },
        handler=_t_list_photos_of,
    ))

    return r


REGISTRY = build_registry()

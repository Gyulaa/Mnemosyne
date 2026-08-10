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
from pathlib import Path
from typing import Any, Callable

from sqlalchemy import or_, text as sql_text
from sqlalchemy.orm import Session

from ..database import (
    Cluster as DBCluster,
    Document as DBDocument,
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

MAX_RESULTS = 50


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

    SQLite's LIKE is only case-insensitive for ASCII, so "Mária" would not match
    "mária" in SQL. Same NFD approach as `_make_id` in project_manager.py.
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
    d.update({
        "birth_date": p.birth_date,
        "birth_place": p.birth_place,
        "christening_date": p.christening_date,
        "christening_place": p.christening_place,
        "death_date": p.death_date,
        "death_place": p.death_place,
        "cause_of_death": p.cause_of_death,
        "burial_date": p.burial_date,
        "burial_place": p.burial_place,
        "occupation": p.occupation,
        "education": p.education,
        "religion": p.religion,
        "nationality": p.nationality,
    })
    return {k: v for k, v in d.items() if v is not None}


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


def _doc_dict(d: DBDocument) -> dict[str, Any]:
    return {
        "id": d.id,
        "title": d.title,
        "doc_type": d.doc_type,
        "year": d.year,
        "description": d.description,
        "is_text": bool(d.is_text),
        "filename": d.filename,
    }


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

    include = set(a.get("include") or ["relations", "events", "documents", "notes"])
    result: dict[str, Any] = {"person": _person_full(p)}

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
        result["documents"] = [_doc_dict(d) for d in sorted(docs, key=lambda d: d.id) if _priv_ok(ctx, d)]

    if "notes" in include:
        notes = ctx.db.query(DBPersonNote).filter(DBPersonNote.person_id == pid).order_by(DBPersonNote.sort_order, DBPersonNote.id).all()
        result["notes"] = [
            {"id": n.id, "title": n.title, "content": n.content}
            for n in notes if _priv_ok(ctx, n)
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
***REMOVED*** trace a line by chaining lookups will sooner
    or later collapse two same-named people into one and silently drop a
    generation. So the walk happens here, and the answer carries ids and
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
        "Report every generation in `chain` in order. If `notes` or `stopped` "
        "mention a data problem, tell the user about it — a line that ends "
        "because of a bad record is not the same as a line that ends because "
        "the ancestor is unknown."
    )
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
        {"documents": [_doc_dict(d) for d in docs[:limit]]},
        "documents", limit, total=len(docs),
    )


def _t_search_text(ctx: ToolContext, a: dict[str, Any]) -> Any:
    """Keyword search over the free-text corpus.

    Plain Python matching rather than FTS5: at this corpus size the index would
    be pure overhead, and Python gives accent-insensitive matching that SQLite's
    ASCII-only LIKE cannot.
    """
    q = _norm(a.get("query"))
    if not q:
        return {"error": "query is required"}
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
        body = "\n".join(filter(None, [d.title, d.description, _text_body(ctx, d)]))
        if q in _norm(body):
            hits.append({
                "kind": "document", "id": d.id, "title": d.title,
                "doc_type": d.doc_type, "year": d.year, "excerpt": _excerpt(body),
            })

    for s in ctx.db.query(DBSource).order_by(DBSource.id).all():
        body = "\n".join(filter(None, [s.title, s.author, s.publisher, s.description]))
        if q in _norm(body):
            hits.append({
                "kind": "source", "id": s.id, "title": s.title,
                "author": s.author, "year": s.year, "excerpt": _excerpt(body),
            })

    return _capped({"hits": hits}, "hits", limit)


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
            "Full profile of one person: biographical fields plus, on request, "
            "their relations (parents, children, spouses, siblings), events, "
            "documents and notes. Ask for everything you need in one call."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "person_id": {"type": "integer"},
                "include": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["relations", "events", "documents", "notes"]},
                    "description": "Defaults to all four.",
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
            "hand-traced line drops generations."
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
        description="Document metadata (certificates, letters, records). Returns titles, types and years — not file contents.",
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
        name="search_text",
        description=(
            "Full-text search across research notes, in-app text documents and "
            "source descriptions. Use it for anything written in prose rather "
            "than stored as a structured field."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "description": "Default 20, max 50."},
            },
            "required": ["query"],
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

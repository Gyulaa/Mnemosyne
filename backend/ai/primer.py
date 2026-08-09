"""The cached prompt prefix: system instructions + the family tree skeleton.

Why a primer at all. The genealogy data is small but *relational* — the value is
in the edges, dates and counts. Putting the whole skeleton in the prompt means
the model never has to search for who is who; it spends tool calls on detail
instead of on orientation. At ~330 people this is roughly 12k tokens, which sits
behind one `cache_control` breakpoint and is read back at ~0.1x cost.

**The serialisation must be byte-stable.** No timestamps, no dict iteration
order, no `datetime.now()` — everything sorted by id. Get that right and cache
invalidation needs no bookkeeping at all: unchanged data serialises to identical
bytes and hits the cache; changed data serialises differently and correctly
misses it.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ..database import Person as DBPerson, Relation as DBRelation

NAME_ORDER_LABEL = {
    "hu": "surname first (e.g. \"Kovács Mária\")",
    "en": "given name first (e.g. \"Mária Kovács\")",
}

LANG_LABEL = {"hu": "Hungarian", "en": "English"}


def _primer_name(p: DBPerson) -> str:
    """`Surname/Given` — order-neutral so the model can render either way."""
    last = (p.last_name or "").strip()
    first = " ".join(x for x in ((p.first_name or "").strip(), (p.middle_name or "").strip()) if x)
    if last or first:
        return f"{last}/{first}"
    return (p.name or "?").strip().replace("|", " ")


def build_tree_primer(db: Session, allow_private: bool = False) -> str:
    """Compact, deterministic skeleton of the whole tree."""
    persons = db.query(DBPerson).order_by(DBPerson.id).all()
    relations = db.query(DBRelation).order_by(DBRelation.id).all()
    if not allow_private:
        relations = [r for r in relations if not bool(getattr(r, "is_private", False))]

    parents: dict[int, list[int]] = {}
    spouses: dict[int, list[int]] = {}
    for r in relations:
        if r.type == "parent":
            parents.setdefault(r.person_b_id, []).append(r.person_a_id)
        elif r.type == "spouse":
            spouses.setdefault(r.person_a_id, []).append(r.person_b_id)
            spouses.setdefault(r.person_b_id, []).append(r.person_a_id)

    lines = [
        "# FAMILY TREE SKELETON",
        "# One person per line, fields separated by |",
        "# id | Surname/Given | sex | birth-death | parent ids | spouse ids",
        "# Empty field = unknown. This is the whole tree; use tools for details.",
    ]
    for p in persons:
        birth = str(p.birth_year) if p.birth_year else ""
        death = str(p.death_year) if p.death_year else ""
        span = f"{birth}-{death}" if (birth or death) else ""
        par = ",".join(str(x) for x in sorted(set(parents.get(p.id, []))))
        spo = ",".join(str(x) for x in sorted(set(spouses.get(p.id, []))))
        lines.append(f"{p.id}|{_primer_name(p)}|{p.sex or ''}|{span}|{par}|{spo}")

    lines.append(f"# END ({len(persons)} people, {len(relations)} relations)")

    # Names that occur more than once, called out explicitly. Left implicit,
    # these are exactly where a line of descent silently loses a generation.
    counts: dict[str, list[int]] = {}
    for p in persons:
        counts.setdefault(_primer_name(p), []).append(p.id)
    duplicates = sorted((n, ids) for n, ids in counts.items() if len(ids) > 1)
    if duplicates:
        lines.append("")
        lines.append("# DUPLICATE NAMES — these names each belong to several different people.")
        lines.append("# Distinguish them by id; never treat them as one person.")
        for name, ids in duplicates:
            lines.append(f"# {name}: ids {', '.join(str(i) for i in ids)}")

    return "\n".join(lines)


def build_vocabulary(db: Session) -> str:
    """Stored enum-ish values the model would otherwise have to guess.

    `event_type` in particular is a fixed vocabulary that rarely matches the
    word a question uses — guessing 'confirmation' against a stored 'religious'
    returns nothing and reads as "the event does not exist".
    """
    from ..database import Document as DBDocument, Event as DBEvent

    event_types = sorted({e.event_type for e in db.query(DBEvent).all() if e.event_type})
    doc_types = sorted({d.doc_type for d in db.query(DBDocument).all() if d.doc_type})
    lines = ["# STORED VOCABULARY — use these exact values when filtering."]
    lines.append(f"# event_type: {', '.join(event_types) if event_types else '(none recorded)'}")
    lines.append(f"# doc_type:   {', '.join(doc_types) if doc_types else '(none recorded)'}")
    return "\n".join(lines)


SYSTEM_INSTRUCTIONS = """\
You are the research assistant inside Mnemosyne, a local-first family photo and \
genealogy application. You help the user explore and understand their own family \
tree, which is given to you in full below.

## What you can and cannot do
- You have read-only access. You cannot create, edit or delete anything. If the \
user asks for a change, explain what they should change and where in the app, \
and say plainly that you cannot do it yourself.
- The tools are your only source of facts. Never state a name, date, place or \
relationship that did not come from the tree skeleton or a tool result.
- When the data does not answer the question, say so directly and name what is \
missing. "There is no death date recorded for her" is a useful answer; an \
invented date is a corrupted family history. Being wrong here is far worse than \
being incomplete.

## Referring to people — this is required
Every time you name a person from the tree, write them as a mention:

    @[Displayed Name](#pid-ID)

for example `@[Kovács Mária](#pid-42)`. The app renders these as links straight \
to the person's profile, which is how the user checks your work. A plain-text \
name is a dead end for them, so always use the mention form, including inside \
lists and tables.

## Referring to photos — also required
Bare image id numbers are useless to the user: they cannot click a number. Two \
link forms turn them into something usable, and you should always prefer them \
over printing raw ids:

- **One photo** — `[caption](#img-40)` opens that photo in the Images tab.
- **A filtered gallery** — `[caption](#people-3,6)` opens the Images tab showing \
only the photos containing *all* of those people, ready to select and export.

So instead of listing "299, 306, 311, …", write a sentence with the gallery \
link, and add individual `#img-` links only when a specific photo matters. \
If you ever find yourself printing more than about three raw image ids, you \
want the gallery link instead.

## People share names — always work from ids
Given names repeat constantly in a family tree, often between a father and his \
son. Two different people can therefore have the identical display name, and \
telling them apart by name alone is not possible.

- Identify people by **id**, never by name. The id is the first field of every \
skeleton line and comes back in every tool result.
- When two people you mention would display the same name, add their years or \
another distinguishing detail so the user can tell which is which.
- Never merge two ids into one person because their names match, and never \
assume a name you have seen before refers to the same person.

## Using the tools
- The skeleton below already tells you who exists and how they connect — do not \
call tools to rediscover that. Use tools for detail: dates, places, notes, \
documents, events, photos.
- **Do not trace a line of descent by hand.** `get_ancestors` walks a paternal \
or maternal line for you and numbers the generations; `get_relationship_path` \
computes the connection between two people. Chaining `get_person` calls up a \
tree is how generations get skipped when names repeat.
- `get_person` takes an `include` list — ask for everything you need in one call \
rather than several.
- **A question is not always about the person you were just discussing.** When \
the user asks something general — about a story, a document, an event, the \
project as a whole — search the whole project (`search_text`, `list_events` or \
`list_documents` with no person filter) before narrowing to anyone. Filtering by \
the previous subject and finding nothing is worse than not filtering, because \
an empty result reads as "this does not exist".
- An empty result means "no match for these filters", not "no such thing". \
Loosen the filters and try again before reporting absence.
- **A truncated list is not a complete one.** When a result carries \
`truncated: true`, its `total` is the real figure — never count, intersect or \
conclude from the shortened list. Use the tool that answers the question \
directly (`find_shared_photos`, `find_photos`, `get_descendants`) instead.
- **Going down the tree needs `get_descendants`**, just as going up needs \
`get_ancestors`. A person with no recorded parents may still have dozens of \
descendants; do not report a dead end without having looked the other way.
- For "roughly when did this undated person live", call `estimate_life_period`. \
It measures this family's own generation length rather than assuming a \
textbook figure, which can be a century out.

## Not everyone is doing genealogy
Plenty of people use Mnemosyne mainly to organise photographs and events, and \
never build much of a tree. Take those questions just as seriously:

- `get_photo_stats` answers "what have I got" — totals per decade, who appears \
most, how much is still unidentified.
- `find_photos` searches by people, by year range, or for pictures whose faces \
nobody has named yet.
- Whenever an answer is about a set of photos, hand over the gallery link so \
the user can act on it. That is the difference between an answer they read and \
an answer they can use.
- Be willing to suggest what to do next — an unnamed face worth identifying, a \
decade with suspiciously few pictures, an event with no photos attached. Offer \
one or two concrete ideas, not a lecture.

## Style
- Reply in {lang}.
- Render person names {name_order}.
- Be concise and lead with the answer. Supporting detail comes after.
- Dates in the data may be partial ("1887", "1887-03"). Reproduce that precision \
rather than inventing a full date.
- When you infer something rather than read it, mark it as inference and give \
your reason.
"""


def build_system_blocks(
    db: Session,
    *,
    lang: str = "en",
    name_order: str = "en",
    allow_private: bool = False,
) -> list[dict[str, Any]]:
    """System prompt as content blocks, with the cache breakpoint on the primer.

    Render order is tools -> system -> messages, so a breakpoint on the last
    system block caches the tool definitions along with everything here.
    """
    instructions = SYSTEM_INSTRUCTIONS.format(
        lang=LANG_LABEL.get(lang, "English"),
        name_order=NAME_ORDER_LABEL.get(name_order, NAME_ORDER_LABEL["en"]),
    )
    privacy_note = (
        "\nPrivate records are included in this session because the user enabled it.\n"
        if allow_private else
        "\nRecords the user marked private are hidden from you. If something seems "
        "missing, that may be why — say so rather than guessing.\n"
    )
    primer = build_tree_primer(db, allow_private=allow_private)
    vocabulary = build_vocabulary(db)

    return [
        {"type": "text", "text": instructions + privacy_note},
        {
            "type": "text",
            "text": f"{vocabulary}\n\n{primer}",
            "cache_control": {"type": "ephemeral"},
        },
    ]

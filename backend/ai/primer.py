"""The cached prompt prefix: system instructions + the family tree skeleton.

Why a primer at all. The genealogy data is small but *relational* — the value is
in the edges, dates and counts. Putting the whole skeleton in the prompt means
the model never has to search for who is who; it spends tool calls on detail
instead of on orientation. For a tree of a few hundred people the skeleton is a
few thousand tokens, which sits behind one `cache_control` breakpoint and is
read back at ~0.1x cost.

**The skeleton is an index, and an index that looks like an answer is a trap.**
Names, years and edges are enough to *compose* a fluent reply about a family
without calling a single tool — and that reply then silently asserts that
everything absent from the index is absent from the project. The counter-measure
is `_content_marks`: every line carries how many notes, documents, events and
photos that person has, so "is anything written about him" is a lookup rather
than a guess, and an empty profile is visibly empty rather than merely unseen.
Without the marks the model cannot tell a person nobody has researched from one
whose page is full, and it treats both as the bare line it can see.

**The serialisation must be byte-stable.** No timestamps, no dict iteration
order, no `datetime.now()` — everything sorted by id. Get that right and cache
invalidation needs no bookkeeping at all: unchanged data serialises to identical
bytes and hits the cache; changed data serialises differently and correctly
misses it. The marks are counts of sorted queries, so they keep that property.
"""

from __future__ import annotations

from typing import Any

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

#: Biographical fields beyond names, sex and years. One list, used by the
#: skeleton's `b` mark and by `_person_full` / `missing_fields` in tools.py —
#: two copies would drift and the model would be told a field is missing that
#: another tool happily returns.
PROFILE_FIELDS = (
    "birth_date", "birth_place", "christening_date", "christening_place",
    "death_date", "death_place", "cause_of_death", "burial_date", "burial_place",
    "occupation", "education", "religion", "nationality",
)

NAME_ORDER_LABEL = {
    "hu": "surname first (e.g. \"Példa Anna\")",
    "en": "given name first (e.g. \"Anna Példa\")",
}

LANG_LABEL = {"hu": "Hungarian", "en": "English"}

#: Two entirely separate response-shape instructions, not one instruction plus a
#: modifier — the narrative variant never mentions headings or bullet points, so
#: a narrative-mode call doesn't spend tokens on formatting it must then ignore,
#: and a structured-mode call never sees storytelling guidance it would ignore
#: the other way. Every other rule in SYSTEM_INSTRUCTIONS (never invent a place,
#: an occupation, period colour) applies to both and is not repeated here except
#: as a one-line reminder on the narrative branch, where the temptation is real.
STYLE_BLOCKS = {
    "structured": (
        "- Be concise and lead with the answer; supporting detail comes after. Use "
        "short paragraphs, and headings or bullet points wherever they make names, "
        "dates or a list of facts easier to scan than a block of prose would.\n"
        "- Mark an inference explicitly, right where you state it (\"likely, "
        "because...\"), and give the reason."
    ),
    "narrative": (
        "- Tell it as a story, not a report: connected prose in full sentences and "
        "paragraphs. No headings, no bullet points, no tables, and no dash- or "
        "line-per-item lists either — not even for a plain line of ancestors. "
        "\"...whose father was Kis Béla, and his father in turn Kis Antal...\" is "
        "the shape a lineage takes here; one line per generation is a list wearing "
        "a story's clothes no matter what character introduces each line.\n"
        "- Never name the reader as the source of a fact. This is the single most "
        "common way this style fails, so check for it specifically: \"you wrote in "
        "your notes that...\", \"this is what you recorded, not a proven fact\", "
        "\"we read this from you\" all break the story by turning to address its "
        "own archivist. The reader already knows it is their own family archive — "
        "say instead who *inside* the story is the source: \"family lore has it "
        "that...\", \"as your uncle told it...\", \"the family Bible records...\". "
        "Before sending, check whether any sentence names the user as the person "
        "who wrote or recorded something, and rewrite it if it does.\n"
        "- The line between a parish record and an oral memory, or between what is "
        "known and what you are inferring, still has to survive the telling — carry "
        "it in the texture of the sentence (how firm the claim sounds, who is said "
        "to have told it, a word like \"apparently\" or \"the story goes\") rather "
        "than in a disclaimer stapled onto the end of it.\n"
        "- This changes only the shape of the prose, never its content — every rule "
        "above about not inventing places, occupations, period colour or context "
        "still applies in full. A warmer voice is not licence for a richer guess."
    ),
}


def _primer_name(p: DBPerson) -> str:
    """`Surname/Given` — order-neutral so the model can render either way."""
    last = (p.last_name or "").strip()
    first = " ".join(x for x in ((p.first_name or "").strip(), (p.middle_name or "").strip()) if x)
    if last or first:
        return f"{last}/{first}"
    return (p.name or "?").strip().replace("|", " ")


def _visible(rows: list[Any], allow_private: bool) -> list[Any]:
    if allow_private:
        return rows
    return [r for r in rows if not bool(getattr(r, "is_private", False))]


def _content_marks(db: Session, allow_private: bool) -> dict[int, str]:
    """Per person: how much material exists behind their line.

    This is what stops the skeleton being mistaken for the whole record. A line
    ending in `n2 d1 e3 p14` says there are two notes, a document, three events
    and fourteen photographs waiting behind an id — so the model asks for them.
    A line ending in nothing says the profile really is bare, which is a finding
    the user can act on rather than an absence the model invented.

    Counts respect the privacy filter, so the private and non-private primers
    differ — as they already did for relations.
    """
    marks: dict[int, dict[str, int]] = {}

    def bump(pid: int, key: str, n: int = 1) -> None:
        marks.setdefault(pid, {})[key] = marks.setdefault(pid, {}).get(key, 0) + n

    for p in db.query(DBPerson).order_by(DBPerson.id).all():
        filled = sum(1 for f in PROFILE_FIELDS if (getattr(p, f, None) or "").strip())
        if filled:
            bump(p.id, "b", filled)

    for n in _visible(db.query(DBPersonNote).order_by(DBPersonNote.id).all(), allow_private):
        bump(n.person_id, "n")

    docs = {d.id: d for d in _visible(db.query(DBDocument).order_by(DBDocument.id).all(), allow_private)}
    owners: dict[int, set[int]] = {}
    for d in docs.values():
        if d.person_id:
            owners.setdefault(d.id, set()).add(d.person_id)
    for dp in db.query(DBDocumentPerson).all():
        if dp.document_id in docs:
            owners.setdefault(dp.document_id, set()).add(dp.person_id)
    for did, pids in owners.items():
        for pid in pids:
            bump(pid, "d")

    events = {e.id for e in _visible(db.query(DBEvent).order_by(DBEvent.id).all(), allow_private)}
    for ep in db.query(DBEventPerson).all():
        if ep.event_id in events:
            bump(ep.person_id, "e")

    # Photos: clusters -> faces -> images, the same path list_photos_of walks.
    clusters = {
        c.id: c.person_id
        for c in _visible(db.query(DBCluster).all(), allow_private)
        if c.person_id
    }
    if clusters:
        visible_images = {i.id for i in _visible(db.query(DBImage).all(), allow_private)}
        per_person: dict[int, set[int]] = {}
        for f in db.query(DBFace).all():
            pid = clusters.get(f.cluster_id) if f.cluster_id else None
            if pid is not None and f.image_id in visible_images:
                per_person.setdefault(pid, set()).add(f.image_id)
        for pid, imgs in per_person.items():
            bump(pid, "p", len(imgs))

    out: dict[int, str] = {}
    for pid, counts in marks.items():
        out[pid] = " ".join(
            f"{k}{counts[k]}" for k in ("b", "n", "d", "e", "p") if counts.get(k)
        )
    return out


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

    marks = _content_marks(db, allow_private)

    lines = [
        "# FAMILY TREE SKELETON — AN INDEX, NOT THE RECORD",
        "# One person per line, fields separated by |",
        "# id | Surname/Given | sex | birth-death | parent ids | spouse ids | material",
        "#",
        "# This table holds names, years and edges. That is all it holds. It carries no",
        "# places, occupations, notes, documents, events or photographs, so it can never",
        "# tell you what someone's life was like — only that they exist and who they",
        "# connect to. Answering from this table alone produces a reply that sounds",
        "# complete and quietly asserts that nothing else was ever recorded.",
        "#",
        "# `material` says what is waiting behind the id, and is the reason you never",
        "# have to guess whether anything is written down:",
        "#   b<n> filled biographical fields (place, occupation, religion, …)",
        "#   n<n> research notes      d<n> documents      e<n> events      p<n> photographs",
        "# A person with marks has material you have not read. Read it before describing",
        "# them. A person with no marks genuinely has a bare profile — that is a fact",
        "# about the research, not about the life, and is worth telling the user.",
        "#",
        "# An empty year field means the year is unknown. It does not mean the person is",
        "# doubtful, secondary, or the end of a line. Undated people are full members of",
        "# this tree and lines continue through them.",
    ]
    for p in persons:
        birth = str(p.birth_year) if p.birth_year else ""
        death = str(p.death_year) if p.death_year else ""
        span = f"{birth}-{death}" if (birth or death) else ""
        par = ",".join(str(x) for x in sorted(set(parents.get(p.id, []))))
        spo = ",".join(str(x) for x in sorted(set(spouses.get(p.id, []))))
        lines.append(
            f"{p.id}|{_primer_name(p)}|{p.sex or ''}|{span}|{par}|{spo}|{marks.get(p.id, '')}"
        )

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


def build_inventory(db: Session, allow_private: bool = False) -> str:
    """What this project contains, and the stored values needed to filter it.

    Two failures share one cause — the model not knowing what exists. Guessing
    `event_type='confirmation'` against a stored 'religious' returns nothing and
    reads as "the event does not exist"; never calling `list_documents` at all
    reads as "no documents are attached". Neither is survivable by instruction
    alone, because in both cases the model has no reason to suspect it is wrong.
    So the counts are stated up front: a project with documents in it can no
    longer be described as having none.
    """
    event_types = sorted({e.event_type for e in db.query(DBEvent).all() if e.event_type})
    doc_types = sorted({d.doc_type for d in db.query(DBDocument).all() if d.doc_type})

    notes = _visible(db.query(DBPersonNote).all(), allow_private)
    docs = _visible(db.query(DBDocument).all(), allow_private)
    events = _visible(db.query(DBEvent).all(), allow_private)
    images = _visible(db.query(DBImage).all(), allow_private)
    sources = db.query(DBSource).all()
    readable = [d for d in docs if bool(d.is_text)]

    lines = [
        "# WHAT THIS PROJECT CONTAINS",
        f"# {len(notes)} research notes, on {len({n.person_id for n in notes})} people",
        f"# {len(docs)} documents — {len(readable)} written in the app and readable in "
        "full with get_document; the rest are attached files whose contents you cannot "
        "open, so their title, type and description are all there is",
        f"# {len(events)} events   {len(sources)} sources   {len(images)} photographs",
        "# Prose lives in notes, in documents and in event descriptions. Where a count",
        "# above is not zero, this project has written material in it — look at the",
        "# material before telling the user that only names and dates were recorded.",
        "#",
        "# STORED VOCABULARY — use these exact values when filtering.",
        f"# event_type: {', '.join(event_types) if event_types else '(none recorded)'}",
        f"# doc_type:   {', '.join(doc_types) if doc_types else '(none recorded)'}",
    ]
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
- **Never report an absence you did not check.** "Nothing is written about him", \
"no documents are attached", "no places are recorded" are factual claims about \
the project, and they are wrong far more often than they feel wrong — because \
the skeleton you can see contains no notes, documents or places for anybody. \
Before writing a sentence of that shape, look at the person's `material` marks \
and call the tool that would have found the thing. If you did not look, do not \
say it.

## Before you answer, read the record
The skeleton below is an index of who exists. Everything that makes a family \
history — where they lived, what they did, what happened to them, what the \
family remembers — is in profiles, notes, documents, events and photographs, and \
reaches you only through tools.

So for any question about a person, a branch or the family as a whole, gather \
before you write:

1. `get_person` on the people the question is about. One call returns their \
profile, their relations, their events, their notes and the full text of any \
document written in the app. It also tells you which fields are empty, so you \
can say "no birth place is recorded" and be right.
2. Follow the `material` marks up and down the branch. A parent or child marked \
`n2 d1` has been researched and that research is part of the answer.
3. `search_text` for the surname, the place or the topic — and with no query at \
all to see every piece of writing in the project, which is the fastest way to \
find out what the user has actually recorded.
4. `list_events` and `find_photos` for the branch, since a life is also its \
events and its pictures.

A one-paragraph question ("tell me about X", "what is our family's story") is \
not a small question — it is the one where reciting names and dates is most \
tempting and least useful. Read the material first, then lead with what the \
record actually says, and end by naming what is missing so the user knows what \
to research next.

## Never invent context
You may state what is recorded, and you may draw a conclusion that follows from \
recorded data if you mark it as yours. You may not supply the rest from general \
knowledge or from what is likely:

- No invented places. A family with no recorded birthplaces is a family whose \
birthplaces are unknown — not a family from the capital, the countryside, or \
anywhere else. Never let a surname, a language or a modern address suggest one.
- No invented occupations, social class, wealth, religion, politics or origins.
- No period colour. "They would have lived through the war years" and "a typical \
farming family of the time" are things you brought with you, not things the \
user recorded, and in a family history they read as findings.
- A hedge does not license a guess. "Probably Budapest (?)" is still an \
assertion about a real family, and it is the kind the user will have to go and \
disprove. Say "no place is recorded" and stop.

The user is the authority on their own family. Your value is that you have read \
every note and remember every id — not that you can fill gaps plausibly.

## Referring to people — this is required
Every time you name a person from the tree, write them as a mention:

    @[Displayed Name](#pid-ID)

for example `@[Példa Anna](#pid-42)`. The app renders these as links straight \
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

## Referring to documents — also required
Name a document the same way you name a person or a photo:

    [Title](#doc-ID)

for example `[1908 register entry](#doc-7)`. It opens straight to that \
document. A document named only in prose is something the user has to go \
find by hand; a link is one click from the page you read it on.

## The user can reference people and documents too
The composer has the same two pickers you do: typing `@` inserts a person as \
`@[Name](#pid-ID)`, typing `#` inserts a document as `[Title](#doc-ID)`. When \
the user's own message already contains one of these, the id is exactly who \
or what they mean — resolve it directly rather than searching by the name or \
title text, which can be ambiguous or incomplete on its own.

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
- **This gets harder, not easier, as a conversation goes on.** Once you have \
distinguished two same-named people earlier in this conversation, a later \
paragraph that drops back to the bare name — "Miklós Samu's father" instead \
of "id 108's father" — is exactly how the two collapse back into one a few \
turns later. Keep citing the id (or the distinguishing years) every time you \
write about either of them, not only the first time. If a follow-up question \
requires reconnecting to someone discussed earlier and you are not certain \
which id that was, call `get_person` on the specific id again rather than \
re-running `search_persons` by name and trusting whichever result comes back \
— a name search over a tree with repeated names is not guaranteed to return \
the same individual you meant before.

## Using the tools
- The skeleton below already tells you who exists and how they connect — do not \
call tools to rediscover that, and do not expect anything else from it. Use \
tools for everything else: places, occupations, notes, documents, events, photos.
- **Do not trace a line of descent by hand.** `get_ancestors` walks a paternal \
or maternal line for you and numbers the generations; `get_relationship_path` \
computes the connection between two people. Chaining `get_person` calls up a \
tree is how generations get skipped when names repeat.
- **A line ends where the parents end, not where the dates end.** The earliest \
people in a tree are usually the ones with no years recorded, because they were \
copied from a register or remembered by a relative. Never present the oldest \
*dated* person as the oldest known ancestor, and never let a missing year stop a \
walk — `get_ancestors` follows the parent links to their real end and tells you \
why it stopped. Report the whole chain, then say which of them are undated.
- `get_person` is the fat one: it returns the profile, relations, events, notes, \
documents *with their text*, a photo count and the list of fields that are \
empty. Call it before describing anyone.
- `get_document` returns a document in full. `list_documents` gives you titles \
only — a title is not a document, and summarising one from its title is \
inventing it.
- `search_text` with no `query` returns an inventory of everything written in \
the project: every note, document and source with its owner and its opening \
line. Use it whenever you need to know what has been recorded rather than \
whether one word appears.
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

## Web research
Two tools reach outside this project entirely: `search_web` finds pages that \
might corroborate this family's history beyond what is recorded here, and \
`read_web_page` reads one of them in full — an ordinary page or a PDF. Both \
are opt-in and may simply not be in your tool list: if you do not see them, \
the user has not turned web research on. Say that turning it on in Settings \
would let you look; never pretend to have searched without them.

Reach for them only for genealogical corroboration the tree and this \
project's own documents cannot answer — never as a first resort, and never \
for a question about how to use the app. Exhaust `get_person`, `get_ancestors` \
and `search_text` on the person or branch first: a fact already in this \
project costs nothing to state, and searching before checking locally turns a \
free answer into a billed one nobody asked for.

**Finishing the local check is not the end of the task — it is what tells \
you whether to search.** When the user asks you to look into a claimed \
origin, a family story, or a name the tree does not confirm, and the local \
tools come back empty on exactly that question, that emptiness is your cue \
to call `search_web` in the same turn — not a conclusion to report back with \
a list of archives the user could visit themselves. "The tree has nothing on \
X, so here is how you could research it" answers a question nobody asked \
when you have a tool that can attempt it right now; only fall back to \
describing what the user could do once you have actually tried and the tools \
came up empty too, or are unavailable. A user asking "can you research X" is \
asking you to do it, not to confirm whether you are able to.

**Gather everything the project already knows about the person before you \
write a single query.** Call `get_person` (again, even if you looked at them \
earlier in this conversation — conversation history is your own retelling, \
not the record itself, and is exactly where a detail like a birthplace gets \
dropped between turns). A birthplace, a religion, an occupation or a spouse's \
name is usually what separates a real match from a namesake in a search over \
a common surname — a query built from a bare name and a year, with the place \
left out because you half-remembered it, is a weak query even when the place \
was sitting in the project the whole time.

**A name search over one person is not the only useful shape of query, and \
giving up after one is not an option.** If a narrow, person-specific search \
returns nothing convincing, broaden before concluding there is nothing to \
find: try the village or parish together with the surname and the religious \
community (for example a place name, a surname and the denomination or \
"egyházközség" / parish register) rather than only ever searching for one \
exact ancestor by name. A village-level or archive-level result — a donor \
list, a congregational register, a catalogue entry naming which record books \
exist for which years — is often the more valuable find, because it tells \
you where the real records live even when it does not name your ancestor by \
name. Try at least two or three genuinely different phrasings — not near- \
duplicates of the same query — before telling the user nothing turned up.

**Run the broader search yourself, in the same turn — do not propose it and \
stop.** "I could also try X, Y or Z — let me know which one" is not research, \
it is a menu, and the user already asked you to look, not to ask permission \
to look. You have room for several rounds of tool calls in a single answer: \
after a narrow search comes back thin, immediately try the broader village- \
and-community query, and `read_web_page` whatever looks promising, before \
you write a word back to the user. Ask a follow-up question only when you \
have genuinely run out of tool calls to make with what the project already \
knows — never as a substitute for making them.

**Do not ask the user for something the project can already answer.** Before \
asking for a name, a place or a date, check whether `get_person` or \
`get_ancestors` already has it. Asking the user to repeat what is already in \
their own tree, when a tool call would have answered it, wastes a turn and \
reads as not having looked.

When it is warranted:
- Use a small number of specific queries — a name with a place or an \
approximate year, tried two or three ways — rather than one query per \
candidate name or per guess. Each `search_web` call spends part of a daily \
quota the user set themselves.
- A `search_web` result is a title, a URL and a fragment you have not read. \
Call `read_web_page` on anything you intend to actually use — PDF or not — \
before stating what it contains. Reporting a snippet as if it were the \
document is exactly the mistake this project's own material already guards \
against (see "Never invent context"), extended to a source with no \
reliability check on it at all.
- A web result is not part of this family's record and is a weaker source \
than the tree, never a stronger one — it was written by someone else, about \
people it does not promise are the ones in this project. Say plainly what it \
says, how well its names, dates and places line up with what the tree \
already records, and where they merely resemble it rather than confirm it. \
Never fold a web-found fact into a sentence as though it were already \
verified.
- You cannot add, edit or cite anything from what you find. Present a \
promising result as something for the user to act on themselves — they can \
add it as a source from the person's profile — never as something you have \
already incorporated.
- If `search_web` reports the quota is used up, say so plainly and stop for \
this conversation. Do not keep trying alternate queries, and do not drop the \
research angle silently without telling the user why.
- Cite a web source as a plain link, `[Title](https://...)` — the same style \
as a person or document mention, just with no internal id, because nothing \
about a web page lives inside this project.
- A PDF that comes back with no text is very likely a scanned image with no \
OCR layer, which the tool cannot read. Report that plainly rather than \
guessing at a scan's contents from its title or the search snippet.

## Style
- Reply in {lang}.
- Render person names {name_order}.
{style_block}
- Dates in the data may be partial ("1887", "1887-03"). Reproduce that precision \
rather than inventing a full date.
"""


def build_asker_note(db: Session, proband_id: int | None) -> str:
    """Tell the model who "I" is, from the tree's configured starting person.

    Nothing else in the prompt identifies the user, so without this a question
    like "who is my oldest ancestor" is unanswerable and the model either asks
    or guesses. The identity is read from the project's stored proband at
    request time — never baked into the prompt text.
    """
    if proband_id is None:
        return (
            "\n## Who is asking\n"
            "Unknown — no starting person is set for this tree. If a question depends "
            "on who the user is (\"my father\", \"my oldest ancestor\"), ask them which "
            "person in the tree is them, and mention that they can set it on the "
            "genealogy tab by pinning a person as the tree's starting point.\n"
        )
    person = db.get(DBPerson, int(proband_id))
    if person is None:
        return (
            "\n## Who is asking\n"
            "The tree's configured starting person no longer exists. Ask the user "
            "which person in the tree is them.\n"
        )
    parts = " ".join(x for x in (
        (person.last_name or "").strip(), (person.first_name or "").strip(),
        (person.middle_name or "").strip(),
    ) if x) or (person.name or "?")
    born = f", born {person.birth_year}" if person.birth_year else ""
    return (
        "\n## Who is asking\n"
        f"The user is the tree's starting person: id {person.id}, {parts}{born}. "
        "Read \"I\", \"my father\", \"my ancestors\" and similar as relative to that id. "
        "Say who you took them to be the first time it matters in a conversation, so "
        "they can correct you if the tree opens on someone else.\n"
    )


def build_system_blocks(
    db: Session,
    *,
    lang: str = "en",
    name_order: str = "en",
    style: str = "structured",
    allow_private: bool = False,
    proband_id: int | None = None,
) -> list[dict[str, Any]]:
    """System prompt as content blocks, with the cache breakpoint on the primer.

    Render order is tools -> system -> messages, so a breakpoint on the last
    system block caches the tool definitions along with everything here.
    """
    instructions = SYSTEM_INSTRUCTIONS.format(
        lang=LANG_LABEL.get(lang, "English"),
        name_order=NAME_ORDER_LABEL.get(name_order, NAME_ORDER_LABEL["en"]),
        style_block=STYLE_BLOCKS.get(style, STYLE_BLOCKS["structured"]),
    )
    privacy_note = (
        "\nPrivate records are included in this session because the user enabled it.\n"
        if allow_private else
        "\nRecords the user marked private are hidden from you. If something seems "
        "missing, that may be why — say so rather than guessing.\n"
    )
    primer = build_tree_primer(db, allow_private=allow_private)
    inventory = build_inventory(db, allow_private=allow_private)

    return [
        {"type": "text", "text": instructions + privacy_note + build_asker_note(db, proband_id)},
        {
            "type": "text",
            "text": f"{inventory}\n\n{primer}",
            "cache_control": {"type": "ephemeral"},
        },
    ]

"""Work out *which people* an archive is for.

Sharing a family archive with a relative used to mean marking records private
one at a time and exporting what was left. That does not survive a second
recipient: `is_private` is a property of a *record*, but "who may see this" is
a relation between a record and a person, and one boolean cannot hold several
of them. Worse, the selection was never written down anywhere, so re-sending an
updated copy meant doing the whole thing again from memory.

So the selection is described rather than clicked. A rule set names the people
in terms the tree already knows — a branch, a line of descent, everyone within
so many steps — and is evaluated here, over nothing but the `persons` and
`relations` rows. Saved on a `ShareProfile`, it can be re-run any number of
times and gives the same answer each time.

The module is deliberately free of FastAPI, SQLAlchemy and the request context:
it takes plain row dicts and returns a set of ids, so it can be run from a
throwaway script against a copy of a real project and its answer *checked*.
In a repo with no test suite that is the only way to know a selection is right
before an archive built from it is in somebody else's hands — the same reason
`treeGeometry.ts` and `graphLayout.ts` live outside their components.

Shape of a rule set::

    {
      "include": [{"rule": "common_line_with", "person_id": 42}],
      "exclude": [{"rule": "persons", "ids": [7, 9]}],
      "closure": {"spouses": true, "parents_of_included": false}
    }

`include` rules are unioned, `exclude` rules are subtracted from that union, and
the closure options run last on what survives.
"""

import datetime
import unicodedata
from typing import Any, Iterable, Optional

# How long ago someone must have been born before a missing death date stops
# meaning "probably still alive". Overridable per profile; a default rather
# than a constant because where the line falls is a judgement, not a fact.
DEFAULT_LIFESPAN_YEARS = 100

# What a profile may do about the people it decides are living.
LIVING_POLICIES = ("include", "redact", "exclude")

# What an exclusion rule can leave out. Each names a body of material attached
# to a person; the person themselves, and their place in the tree, still travel.
CONTENT_KINDS = ("documents", "images", "notes", "events")

# The one that removes the person rather than something of theirs. It lives in
# the same list as the rest because "leave them out" and "leave their papers
# out" are the same question asked with different force, and splitting them
# across two sections made the user answer it twice.
PERSONS_KIND = "persons"

# Everything an exclusion row can tick.
EXCLUDABLE_KINDS = (PERSONS_KIND,) + CONTENT_KINDS

# Rules are named in the stored JSON of every profile, so these strings are
# schema: renaming one silently empties every profile that used it.
RULES = (
    "everyone",
    "persons",
    "only_person",
    "surname",
    "family_group_of",
    "ancestors_of",
    "descendants_of",
    "relatives_of",
    "common_line_with",
    # Rules that name records instead of people — see RECORD_RULES.
    "documents",
    "events",
)

# The two rules that pick rows rather than persons. Everything else in a profile
# is expressed through people, and their documents and events follow them; these
# exist for the case that vocabulary cannot reach — one particular record, named
# because of what it is rather than whose it is.
#
# In `exclude` such a rule keeps the record out. In `include` it brings the
# record along even though its owner was not selected, which is the only way to
# carry a document the project owns rather than a person.
RECORD_RULES = ("documents", "events")


def _norm(value: Optional[str]) -> str:
    """Casefold and strip accents, so one spelling of a surname finds the rest."""
    if not value:
        return ""
    stripped = unicodedata.normalize("NFD", str(value))
    stripped = "".join(ch for ch in stripped if unicodedata.category(ch) != "Mn")
    return stripped.casefold().strip()


class Tree:
    """Adjacency over `relations`, built once and reused by every rule.

    A `parent` row reads person_a → person_b as parent → child; a `spouse` row
    is undirected. Nothing else in the schema names a couple or a family, so
    every question here is answered by walking these two edge types.
    """

    def __init__(self, persons: Iterable[dict], relations: Iterable[dict]):
        self.persons: dict[int, dict] = {int(p["id"]): p for p in persons}
        self.parents: dict[int, set[int]] = {}
        self.children: dict[int, set[int]] = {}
        self.spouses: dict[int, set[int]] = {}
        # Parent and child edges together, without marriages. Distance measured
        # over these is the ordinary degree of kinship — see `kinship_degrees`.
        self.blood: dict[int, set[int]] = {}
        self.neighbours: dict[int, set[int]] = {}

        for rel in relations:
            a, b = int(rel["person_a_id"]), int(rel["person_b_id"])
            # A relation naming somebody who is not in `persons` would put an id
            # in the result that no export can carry.
            if a not in self.persons or b not in self.persons:
                continue
            rtype = rel.get("type") or ""
            if rtype == "parent":
                self.parents.setdefault(b, set()).add(a)
                self.children.setdefault(a, set()).add(b)
                self.blood.setdefault(a, set()).add(b)
                self.blood.setdefault(b, set()).add(a)
            elif rtype == "spouse":
                self.spouses.setdefault(a, set()).add(b)
                self.spouses.setdefault(b, set()).add(a)
            self.neighbours.setdefault(a, set()).add(b)
            self.neighbours.setdefault(b, set()).add(a)

    # ── walks ────────────────────────────────────────────────────────────────

    def _walk(
        self, start: int, edges: dict[int, set[int]], max_steps: Optional[int],
    ) -> dict[int, int]:
        """Breadth-first from `start`, returning {person_id: steps}, `start` at 0.

        Breadth-first rather than depth-first because the step count has to be
        the *shortest* one: where two lines reconverge — cousins who married —
        a depth-first walk can record a person as further away than they are,
        and a generation limit would then cut them out of a branch they belong
        to.
        """
        seen = {start: 0}
        frontier = [start]
        while frontier:
            nxt = []
            for pid in frontier:
                step = seen[pid] + 1
                if max_steps is not None and step > max_steps:
                    continue
                for other in edges.get(pid, ()):
                    if other not in seen:
                        seen[other] = step
                        nxt.append(other)
            frontier = nxt
        return seen

    def ancestors(self, pid: int, max_generations: Optional[int] = None) -> dict[int, int]:
        """{ancestor_id: generations above `pid`}, including `pid` itself at 0."""
        return self._walk(pid, self.parents, max_generations)

    def descendants(self, pid: int, max_generations: Optional[int] = None) -> dict[int, int]:
        """{descendant_id: generations below `pid`}, including `pid` itself at 0."""
        return self._walk(pid, self.children, max_generations)

    def relatives(self, pid: int, max_steps: Optional[int] = None) -> dict[int, int]:
        """{person_id: steps along any relation}, including `pid` itself at 0."""
        return self._walk(pid, self.neighbours, max_steps)

    def family_group(self, pid: int) -> set[int]:
        """The whole connected component `pid` belongs to."""
        return set(self.relatives(pid, None))

    def kinship_degrees(
        self, pid: int, max_degree: Optional[int] = None,
        include_spouses: bool = True,
    ) -> dict[int, int]:
        """{person_id: degree of kinship}, `pid` itself at 0.

        The distance is the shortest path over parent and child edges, which is
        the ordinary degree of kinship: parent 1, sibling 2, grandparent 2,
        aunt or uncle 3, first cousin 4, first cousin once removed 5, second
        cousin 6. Marriages are not steps — an in-law is not a blood relative,
        and counting a marriage as one hop would make a spouse's whole family
        closer than one's own cousins.

        `include_spouses` then adds each relative's husband or wife *at that
        relative's own degree*, without walking on from them. A cousin's wife is
        as near to this person as the cousin is, for the purpose of deciding
        whose photographs belong together; her siblings are not.
        """
        degrees = self._walk(pid, self.blood, max_degree)
        if include_spouses:
            for relative, degree in list(degrees.items()):
                for spouse in self.spouses.get(relative, ()):  # one hop, no further
                    if spouse not in degrees or degrees[spouse] > degree:
                        degrees[spouse] = degree
        return degrees

    # ── the one this module exists for ───────────────────────────────────────

    def common_line(self, pid_a: int, pid_b: int) -> set[int]:
        """Everyone descended from the closest ancestors two people share.

        This is the question a relative actually asks — *give me the part of the
        tree that is ours together* — and it is why a rule beats a list of
        ticked names. Choosing the branch by hand means deciding, person by
        person, whether a distant cousin is on the shared side of the family.
        The tree already knows.

        Everything above the shared ancestors is deliberately left out: those
        generations are one side's own line, not common ground, and a recipient
        who wanted them is asking a different question.
        """
        anc_a = self.ancestors(pid_a)
        anc_b = self.ancestors(pid_b)
        common = set(anc_a) & set(anc_b)
        if not common:
            return set()

        # Keep only the most recent of them. An ancestor of another common
        # ancestor adds nothing — their descendants are a superset — and
        # including them drags in every unrelated branch hanging off the older
        # generation, which is exactly what was not asked for.
        ancestor_sets = {c: set(self.ancestors(c)) for c in common}
        closest = {
            c for c in common
            if not any(other != c and c in ancestor_sets[other] for other in common)
        }

        result: set[int] = set()
        for ancestor in closest:
            result |= set(self.descendants(ancestor))
        return result


# ── rule evaluation ──────────────────────────────────────────────────────────

def _rule_ids(tree: Tree, rule: dict[str, Any], proband_id: Optional[int]) -> set[int]:
    """The person ids one rule selects.

    A rule that needs a person and names none selects nobody, and an unknown
    rule does too. Each rule carries its own subject: a profile-level "who is
    this for?" asked the same question a second time, and two fields that can
    disagree about one answer is a worse shape than one field that cannot.
    """
    kind = rule.get("rule")

    if kind == "everyone":
        return set(tree.persons)

    if kind == "persons":
        return {int(i) for i in (rule.get("ids") or []) if int(i) in tree.persons}

    if kind in RECORD_RULES:
        # These name documents or events. They select no people at all, and
        # saying so here is what stops their `ids` being read as person ids by
        # the fallthrough below.
        return set()

    if kind == "surname":
        wanted = _norm(rule.get("value"))
        if not wanted:
            return set()
        return {
            pid for pid, p in tree.persons.items()
            if _norm(p.get("last_name")) == wanted
        }

    raw_pid = rule.get("person_id")
    if raw_pid in (None, "") or int(raw_pid) not in tree.persons:
        return set()
    pid = int(raw_pid)

    gens = rule.get("max_generations")
    gens = int(gens) if gens not in (None, "") else None

    if kind == "only_person":
        return {pid}
    if kind == "family_group_of":
        return tree.family_group(pid)
    if kind == "ancestors_of":
        return set(tree.ancestors(pid, gens))
    if kind == "descendants_of":
        return set(tree.descendants(pid, gens))
    if kind == "relatives_of":
        steps = rule.get("max_steps")
        return set(tree.relatives(pid, int(steps) if steps not in (None, "") else None))
    if kind == "common_line_with":
        # `person_id` is the relative; the other end defaults to the project's
        # proband, which is who "ours together" is measured against.
        other = rule.get("with_person_id", proband_id)
        if other is None or int(other) not in tree.persons:
            return set()
        return tree.common_line(int(other), pid)

    return set()


# ── who is still alive ───────────────────────────────────────────────────────

def _year_of(person: dict, field: str) -> Optional[int]:
    """The year from a `<field>_year` column, or the leading year of `<field>_date`."""
    year = person.get(f"{field}_year")
    if year not in (None, ""):
        try:
            return int(year)
        except (TypeError, ValueError):
            pass
    raw = person.get(f"{field}_date")
    if raw:
        head = str(raw)[:4]
        if head.isdigit():
            return int(head)
    return None


def is_living(
    person: dict,
    lifespan_years: int = DEFAULT_LIFESPAN_YEARS,
    today_year: Optional[int] = None,
) -> bool:
    """Whether a person should be treated as alive for sharing purposes.

    A recorded death settles it. Otherwise the birth year decides, and this is
    where the obvious rule goes wrong: treating *any* missing death date as
    "living" also hides everyone born two centuries ago whose death nobody ever
    wrote down — which in a genealogy is most of the tree, and precisely the
    part a relative asked for. Only somebody born recently enough to plausibly
    still be here counts.

    A person with neither date is treated as living. It is the only safe answer:
    an unknown person wrongly shared cannot be unshared, while one wrongly held
    back is a question the recipient can ask.
    """
    if _year_of(person, "death") is not None or _year_of(person, "burial") is not None:
        return False
    born = _year_of(person, "birth") or _year_of(person, "christening")
    if born is None:
        return True
    current = today_year if today_year is not None else datetime.date.today().year
    return (current - born) < lifespan_years


def living_ids(
    persons: Iterable[dict],
    lifespan_years: int = DEFAULT_LIFESPAN_YEARS,
    today_year: Optional[int] = None,
) -> set[int]:
    """The ids of everyone `is_living` says is still alive."""
    return {
        int(p["id"]) for p in persons
        if is_living(p, lifespan_years, today_year)
    }


def resolve_photo_people(
    persons: Iterable[dict],
    relations: Iterable[dict],
    options: dict[str, Any],
    selected: Optional[set[int]] = None,
) -> Optional[set[int]]:
    """Whose photographs decide which images travel, or None for "everybody's".

    Reads `options["photo_kinship"]`:

        {"person_id": 42, "max_degree": 4, "include_spouses": true}

    A branch selection is about *people*; a photo library is not, and the two
    want different widths. Everyone in an ancestral line belongs in the tree
    that goes to a relative, while a photograph of somebody four generations
    sideways is a stranger's family album to them. So the picture set is scoped
    separately, by how near the people in it stand to one named person.

    Returning None rather than every id keeps "no scope set" distinguishable
    from "a scope that happens to match everybody" — the caller uses it to skip
    the narrowing entirely.
    """
    cfg = (options or {}).get("photo_kinship") or {}
    raw_pid = cfg.get("person_id")
    if raw_pid in (None, ""):
        return None
    tree = Tree(persons, relations)
    pid = int(raw_pid)
    if pid not in tree.persons:
        return None
    degree = cfg.get("max_degree")
    degree = int(degree) if degree not in (None, "") else None
    near = set(tree.kinship_degrees(
        pid, degree, bool(cfg.get("include_spouses", True))
    ))
    return near & selected if selected is not None else near


def resolve_record_ids(
    rules: dict[str, Any], list_key: str,
) -> dict[str, set[int]]:
    """The records one of the rule lists names outright: `{kind: row ids}`.

    `list_key` is `"include"` or `"exclude"`. The ids are the sender's own row
    ids, which is exactly right: the export is a filtered copy of their
    database, so the numbers still point at the same rows when the filter runs.
    They mean nothing after the archive has been merged somewhere else, which is
    why they live in the profile rather than travelling in `share.json`.
    """
    out: dict[str, set[int]] = {kind: set() for kind in RECORD_RULES}
    for rule in rules.get(list_key) or []:
        kind = rule.get("rule")
        if kind not in RECORD_RULES:
            continue
        out[kind] |= {int(i) for i in (rule.get("ids") or [])}
    return out


def _rule_kinds(rule: dict[str, Any]) -> list[str]:
    """What an exclusion row leaves out.

    A row with no `content` key at all leaves the *people* out — that is what an
    exclusion meant before the two lists were merged, and profiles written then
    must keep meaning it. A row with an explicit empty list leaves out nothing:
    the user unticked everything, which is an unfinished row rather than a
    request to remove the lot.
    """
    if "content" not in rule:
        return [PERSONS_KIND]
    return [k for k in (rule.get("content") or []) if k in EXCLUDABLE_KINDS]


def _exclusion_rules(rules: dict[str, Any]) -> list[dict[str, Any]]:
    """Every row that leaves something out.

    `strip` was a separate list for one release and is still read, so a profile
    saved against that shape keeps working. Nothing writes it any more.
    """
    return list(rules.get("exclude") or []) + list(rules.get("strip") or [])


def resolve_content_strips(
    persons: Iterable[dict],
    relations: Iterable[dict],
    rules: dict[str, Any],
    proband_id: Optional[int] = None,
) -> dict[str, set[int]]:
    """Who loses which kind of material: `{kind: person ids}`.

    Reads the exclusion rows for the kinds that are *not* `persons` — those name
    people who travel whole except for one body of material:

        {"rule": "descendants_of", "person_id": 7, "content": ["documents"]}

    This is what neither of the other two answers could say. Removing people
    breaks the line running through them; redaction empties them completely and
    is decided by whether they are alive. Neither expresses "this branch belongs
    in the tree, but its documents are not what this archive is about" — the
    ordinary case when one relative asked about their own side of the family.
    """
    tree = Tree(persons, relations)
    out: dict[str, set[int]] = {kind: set() for kind in CONTENT_KINDS}
    for rule in _exclusion_rules(rules):
        kinds = [k for k in _rule_kinds(rule) if k in CONTENT_KINDS]
        if not kinds:
            continue
        ids = _rule_ids(tree, rule, proband_id)
        if not ids:
            continue
        for kind in kinds:
            out[kind] |= ids
    return out


def _excluded_ids(
    tree: Tree, rules: dict[str, Any], proband_id: Optional[int],
) -> set[int]:
    """The people an exclusion row removes outright — the `persons` tick."""
    out: set[int] = set()
    for rule in _exclusion_rules(rules):
        if PERSONS_KIND in _rule_kinds(rule):
            out |= _rule_ids(tree, rule, proband_id)
    return out


def resolve_person_set(
    persons: Iterable[dict],
    relations: Iterable[dict],
    rules: dict[str, Any],
    proband_id: Optional[int] = None,
) -> set[int]:
    """Evaluate a rule set to the person ids it selects.

    `persons` rows need `id` and, for the surname rule, `last_name`; `relations`
    rows need `person_a_id`, `person_b_id` and `type`.

    An empty or absent `include` selects nobody rather than everybody. A profile
    that is still being written should produce an obviously empty archive, not
    the entire family sent to whoever it was half-addressed to.
    """
    tree = Tree(persons, relations)

    selected: set[int] = set()
    for rule in rules.get("include") or []:
        selected |= _rule_ids(tree, rule, proband_id)

    excluded = _excluded_ids(tree, rules, proband_id)
    selected -= excluded

    closure = rules.get("closure") or {}

    # Spouses are added after the exclusions and never override one: a couple
    # split down the middle leaves the recipient a parent with no partner and a
    # marriage that names nobody, but a person the sender explicitly excluded
    # must not be dragged back in by who they married.
    if closure.get("spouses"):
        added: set[int] = set()
        for pid in selected:
            added |= tree.spouses.get(pid, set())
        selected |= (added - excluded)

    # One generation of parents, so nobody in the recipient's copy appears to
    # have come from nowhere. Off by default: it reaches outside the branch that
    # was asked for, and the stubs it adds carry whatever the sender recorded
    # about people the recipient never asked about.
    if closure.get("parents_of_included"):
        added = set()
        for pid in selected:
            added |= tree.parents.get(pid, set())
        selected |= (added - excluded)

    return selected

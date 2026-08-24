"""Place strings — the one module that decides what their parts mean.

A place is stored the way it always was: one free-text column per fact
(`persons.birth_place`, `relations.marriage_place`, `events.place`, …).  What
this module adds is an *interpretation* of that text: a comma-separated
hierarchy written finest-first, which is exactly the GEDCOM `PLAC` convention
the exporter already emits.

    "Fő utca 12, Példafalva, Somogy, Magyarország"
      │            │           │        │
      detail    settlement   region  country

The finest level is where a street and a house number live.  That matters for
records rather than for tidiness: the same house number appearing in two parish
entries is the same family home, and a house number swallowed into the
settlement name turns every address into its own separate place.

**This parsing exists only here, and never on the frontend.**  The API hands the
client rows that are already split, so there is one heuristic rather than two
that drift — the same reason `treeGeometry.ts` owns tree card sizes alone.  The
functions below are pure and import no FastAPI, so they can be run and measured
straight from a `python -c` against a copy of a real project, which in a repo
with no test suite is the only way to check a heuristic beyond eyeballing it.
"""

from __future__ import annotations

import re
import unicodedata


# ── folding ───────────────────────────────────────────────────────────────────


def fold(s: str | None) -> str:
    """Accent- and case-insensitive comparison key.

    NFD-decompose, drop the combining marks, casefold.  Identical by design to
    `_norm` in `ai/tools.py` and `_norm` in `gedcom_import.py` — the sameness is
    deliberate, not an accident waiting to be deduplicated, and the frontend
    folds a *typed query* with the same rule (JS `normalize('NFD')` strips the
    same marks).  Every row this module returns carries its own folded `key`, so
    the client never has to fold anything it did not type.
    """
    if not s:
        return ""
    stripped = "".join(
        c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c)
    )
    return stripped.casefold().strip()


# ── the hierarchy ─────────────────────────────────────────────────────────────

# A leading level is an address detail when it ends in one of these.  The list
# is deliberately short: over-eager matching demotes a settlement to a house
# number, which is the worse of the two mistakes — it costs the place its pin,
# while a missed detail merely leaves the house number in the map label.
_STREET_WORDS = {
    "utca", "u", "ut", "út", "utja", "útja", "ter", "tér", "tere",
    "korut", "körút", "krt", "koz", "köz", "sor", "rakpart",
    "setany", "sétány", "dulo", "dűlő", "hrsz", "szam", "szám", "sz", "haz", "ház",
    "street", "st", "road", "rd", "avenue", "ave", "lane", "square", "sq",
    "strasse", "straße", "gasse", "platz", "weg",
}

# "Példafalva 47" / "Példafalva 47. sz." — a register writes the house number
# onto the settlement with no comma at all, which is the one form the comma
# hierarchy cannot express on its own.
_TRAILING_NUMBER_RE = re.compile(
    r"^(?P<head>.*?)[\s,]+(?P<num>\d+[a-zA-Z]?\.?(?:\s*/\s*[a-zA-Z0-9]+)?"
    r"(?:\s*(?:sz\.?|szám|hrsz\.?|szám alatt))?)$",
    re.IGNORECASE,
)

# Only ever used to label the coarsest level for display and to narrow a
# gazetteer lookup.  Nothing is stored differently because of it, so an unknown
# country simply reads as a region — never as a lost part.
_COUNTRY_NAMES = {
    fold(n)
    for n in (
        "Magyarország", "Hungary", "Ungarn",
        "Szlovákia", "Slovakia", "Slovensko", "Felvidék",
        "Románia", "Romania", "România", "Erdély", "Transylvania",
        "Szerbia", "Serbia", "Srbija", "Vajdaság", "Jugoszlávia", "Yugoslavia",
        "Ukrajna", "Ukraine", "Kárpátalja",
        "Horvátország", "Croatia", "Hrvatska",
        "Szlovénia", "Slovenia", "Ausztria", "Austria", "Österreich",
        "Németország", "Germany", "Deutschland",
        "Csehország", "Czechia", "Czech Republic", "Csehszlovákia", "Czechoslovakia",
        "Lengyelország", "Poland", "Polska",
        "Egyesült Államok", "United States", "USA", "Amerikai Egyesült Államok",
        "Kanada", "Canada", "Ausztrália", "Australia",
        "Egyesült Királyság", "United Kingdom", "Anglia", "England",
        "Franciaország", "France", "Olaszország", "Italy", "Italia",
        "Svájc", "Switzerland", "Izrael", "Israel",
    )
}


def split_levels(raw: str | None) -> list[str]:
    """The comma levels, trimmed, with runs of whitespace collapsed."""
    if not raw:
        return []
    return [lvl for lvl in (" ".join(p.split()) for p in raw.split(",")) if lvl]


def _is_detail(level: str) -> bool:
    if any(ch.isdigit() for ch in level):
        return True
    tokens = level.replace(".", " ").split()
    return bool(tokens) and fold(tokens[-1]) in _STREET_WORDS


def place_parts(raw: str | None) -> dict:
    """Split one stored place string into its levels.

    Returns `detail`, `settlement`, `region`, `country` (any of them `None`),
    `levels` — the trimmed comma parts as written — and `canonical`, which is
    every level except the detail.  A string with a single level is a
    settlement, never a detail: an address with nothing to attach it to is not
    an address.
    """
    levels = split_levels(raw)
    if not levels:
        return {
            "detail": None, "settlement": None, "region": None,
            "country": None, "levels": [], "canonical": "",
        }

    detail: str | None = None
    rest = levels
    if len(levels) >= 2 and _is_detail(levels[0]):
        detail, rest = levels[0], levels[1:]

    # No comma-separated detail, but the settlement carries a house number
    # written straight onto it — the parish-register form.
    if detail is None and rest:
        m = _TRAILING_NUMBER_RE.match(rest[0])
        if m and m.group("head").strip() and not m.group("head").strip().isdigit():
            detail = m.group("num").strip()
            rest = [m.group("head").strip(), *rest[1:]]

    settlement = rest[0] if rest else None
    above = rest[1:]

    country = None
    if above and fold(above[-1]) in _COUNTRY_NAMES:
        country = above[-1]
        above = above[:-1]

    region = ", ".join(above) or None
    return {
        "detail": detail,
        "settlement": settlement,
        "region": region,
        "country": country,
        "levels": levels,
        "canonical": ", ".join(rest),
    }


def dominant_spelling(variants: dict[str, int]) -> str:
    """Pick the spelling that represents a group of folded-equal values.

    Most used wins.  A tie goes to the quieter capitalisation (`Kadar` over
    `KADAR`) and then to alphabetical order — a tie has to be broken by
    *something*, and breaking it by dict order means the suggestion list changes
    shape whenever an unrelated row is added.

    `field_values.py` groups its rows the same way and imports this rather than
    keeping a second copy of the rule.
    """
    return min(
        variants.items(),
        key=lambda kv: (-kv[1], sum(1 for c in kv[0][1:] if c.isupper()), kv[0]),
    )[0]


def normalize_raw(raw: str | None) -> str:
    """The string as written, with the comma spacing regularised.

    Grouping happens on `fold()` of this, so `"A,B"` and `"A ,  B"` are one
    place rather than two suggestions the user has to choose between.
    """
    return ", ".join(split_levels(raw))


def canonical_place(raw: str | None) -> str:
    """Everything except the address detail — the settlement and what is above it.

    This is what a map pin is placed by and what the gazetteer is asked about: a
    house number is not a coordinate, and two addresses in one village must not
    become two villages.
    """
    return place_parts(raw)["canonical"]


def settlement_key(raw: str | None) -> str:
    """The folded canonical place — the key a coordinate is stored under."""
    return fold(canonical_place(raw))


# ── usage across the project ──────────────────────────────────────────────────

# Every column in the schema that holds a place.  A new one added to the model
# has to be added here too, or it stays out of the suggestions and out of the
# map — nothing else in the codebase enumerates them.
PLACE_COLUMNS: list[tuple[str, str]] = [
    ("persons", "birth_place"),
    ("persons", "christening_place"),
    ("persons", "death_place"),
    ("persons", "burial_place"),
    ("relations", "marriage_place"),
    ("relations", "divorce_place"),
    ("events", "place"),
]


def collect_place_usage(db) -> list[dict]:
    """Every distinct place in the project, with how often it is used.

    Two kinds of row come back in one list:

    * every distinct full string as written, `is_settlement` false — the count
      is how many facts use that exact spelling (variants that differ only in
      comma spacing are merged, and the most common spelling represents them);
    * a settlement-level row, `is_settlement` true, for each settlement that is
      only ever written with an address in front of it — so someone who wants
      the village alone does not have to delete a stranger's house number.

    **No privacy filter.** `is_private` governs what leaves the machine, not
    what its owner sees in their own project, so a private event's place is a
    suggestion like any other. The consequence lands on the export instead: the
    place registry has to be filtered there, and it is filtered by string
    reachability rather than by a foreign key.
    """
    from sqlalchemy import text as _sql

    sql = " UNION ALL ".join(
        f"SELECT {col} AS v FROM {tbl} WHERE {col} IS NOT NULL AND TRIM({col}) <> ''"
        for tbl, col in PLACE_COLUMNS
    )
    rows = db.execute(_sql(sql)).fetchall()

    # key → {spelling: count}
    spellings: dict[str, dict[str, int]] = {}
    for (raw,) in rows:
        norm = normalize_raw(raw)
        if not norm:
            continue
        spellings.setdefault(fold(norm), {})
        spellings[fold(norm)][norm] = spellings[fold(norm)].get(norm, 0) + 1

    out: list[dict] = []
    settlement_counts: dict[str, int] = {}
    settlement_label: dict[str, str] = {}
    exact_settlements: set[str] = set()

    for key, variants in spellings.items():
        value = dominant_spelling(variants)
        count = sum(variants.values())
        parts = place_parts(value)
        skey = settlement_key(value)
        out.append({
            "value": value,
            "key": key,
            "count": count,
            "is_settlement": False,
            "settlement_key": skey,
            "canonical": parts["canonical"],
            **{k: parts[k] for k in ("detail", "settlement", "region", "country")},
        })
        if skey:
            settlement_counts[skey] = settlement_counts.get(skey, 0) + count
            settlement_label.setdefault(skey, canonical_place(value))
            if parts["detail"] is None:
                exact_settlements.add(skey)

    for skey, count in settlement_counts.items():
        if skey in exact_settlements:
            continue  # the plain settlement is already a row of its own
        label = settlement_label[skey]
        parts = place_parts(label)
        out.append({
            "value": label,
            "key": skey,
            "count": count,
            "is_settlement": True,
            "settlement_key": skey,
            "canonical": parts["canonical"],
            **{k: parts[k] for k in ("detail", "settlement", "region", "country")},
        })

    out.sort(key=lambda r: (-r["count"], fold(r["value"])))
    return out

"""What a project has already had typed into its small-vocabulary text fields.

Some columns hold prose that is different every time (a note, an event title, a
person's name) and some hold a *vocabulary* — a handful of values that repeat
across the whole family: an occupation, a religion, a nationality, a level of
schooling, a cause of death, an academic title. Retyping a vocabulary value is
pure cost, and typing it slightly differently the second time is worse than
cost: it silently splits one group into two everywhere the value is counted or
searched.

This module is the registry of which columns are that second kind. Adding a
column here is the whole change on the backend side — the endpoint, the client
hook and the field component all read the registry rather than naming columns.

**Names are deliberately absent.** A surname repeats far more than a religion
does, but a name field is not a vocabulary: offering existing people's names
while someone types a *new* person's name invites picking the wrong one, and
choosing an existing person is what the person pickers are for. The same
reasoning keeps event titles out — they are descriptions, not terms.

Places are their own thing and are **not** registered here: they carry a comma
hierarchy, a canonical form and settlement-level rows, all of which live in
`backend/places.py`.

Like the place suggestions, and for the same reason, this is **not
privacy-filtered**: `is_private` governs what leaves the machine, not what its
owner sees in their own project.
"""

from __future__ import annotations

import re

from .places import dominant_spelling, fold


# Values that are really a list in one column. `occupation` is the only one:
# somebody can be a farmer and an innkeeper, and the parts are offered alongside
# the whole string exactly as a place offers its settlement alongside the full
# address. `StatisticsView.tsx` splits the same column with the same three
# separators for a different job — counting terms, not suggesting them — so the
# two rules are deliberately alike and should be changed together.
_LIST_SEPARATORS = re.compile(r"[,;/]")


class FieldSource:
    """One registered column.

    `name` is the key the API and the frontend use; `table`/`column` say where
    to read it; `is_list` marks a column whose value may be several terms.
    """

    def __init__(self, name: str, table: str, column: str, is_list: bool = False):
        self.name = name
        self.table = table
        self.column = column
        self.is_list = is_list


FIELD_SOURCES: list[FieldSource] = [
    FieldSource("occupation", "persons", "occupation", is_list=True),
    FieldSource("religion", "persons", "religion"),
    FieldSource("nationality", "persons", "nationality"),
    FieldSource("education", "persons", "education"),
    FieldSource("cause_of_death", "persons", "cause_of_death"),
    FieldSource("title", "persons", "title"),
]


def _tidy(raw: str | None) -> str:
    """Trim and collapse whitespace runs, so spacing alone never splits a value."""
    return " ".join(raw.split()) if raw else ""


def collect_field_values(db) -> dict[str, list[dict]]:
    """Every registered field's used values, most-used first.

    Rows are grouped on `fold()` of the tidied value, and the most common
    spelling represents the group — so a value typed once in lower case does not
    become a separate suggestion beside its capitalised twin.

    A list column yields two kinds of row, the same shape places use: the whole
    string as written, and each individual term with `is_part` set, so a person
    with a single occupation can pick one term out of somebody else's pair
    without editing it down by hand. A term identical to a whole value is not
    repeated — the whole row already offers it.
    """
    from sqlalchemy import text as _sql

    out: dict[str, list[dict]] = {}
    for src in FIELD_SOURCES:
        rows = db.execute(_sql(
            f"SELECT {src.column} AS v FROM {src.table} "
            f"WHERE {src.column} IS NOT NULL AND TRIM({src.column}) <> ''"
        )).fetchall()

        whole: dict[str, dict[str, int]] = {}
        parts: dict[str, dict[str, int]] = {}
        for (raw,) in rows:
            value = _tidy(raw)
            if not value:
                continue
            key = fold(value)
            whole.setdefault(key, {})
            whole[key][value] = whole[key].get(value, 0) + 1
            if src.is_list:
                terms = [_tidy(p) for p in _LIST_SEPARATORS.split(value)]
                terms = [term for term in terms if term]
                if len(terms) > 1:
                    for term in terms:
                        tkey = fold(term)
                        parts.setdefault(tkey, {})
                        parts[tkey][term] = parts[tkey].get(term, 0) + 1

        result = [_row(key, variants, False) for key, variants in whole.items()]
        result += [
            _row(key, variants, True)
            for key, variants in parts.items()
            if key not in whole
        ]
        result.sort(key=lambda r: (-r["count"], r["key"]))
        out[src.name] = result
    return out


def _row(key: str, variants: dict[str, int], is_part: bool) -> dict:
    value = dominant_spelling(variants)
    return {
        "value": value,
        "key": key,
        "count": sum(variants.values()),
        "is_part": is_part,
    }

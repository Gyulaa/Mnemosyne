"""
GEDCOM 5.5.1 import with merge support.

Two-step flow:
  1. load_gedcom()      → parse file, return structured dict
  2. build_preview()    → match against existing persons, return preview + session token
  3. execute_import()   → apply user decisions to the active project DB
  4. execute_rollback() → undo the last import (available for 30 min)
"""
from __future__ import annotations

import io
import mimetypes
import re
import sqlite3
import time
import unicodedata
import uuid
import zipfile
from pathlib import Path
from typing import Optional

# ── Date parsing ───────────────────────────────────────────────────────────────

_MONTHS = {
    'JAN': 1, 'FEB': 2, 'MAR': 3, 'APR': 4, 'MAY': 5, 'JUN': 6,
    'JUL': 7, 'AUG': 8, 'SEP': 9, 'OCT': 10, 'NOV': 11, 'DEC': 12,
}

_APPROX_PREFIX = re.compile(r'^(ABT|BEF|AFT|EST|CAL|CIR)\s+', re.I)


def _parse_date(s: str) -> tuple[Optional[str], Optional[int]]:
    """GEDCOM date string → (iso_partial, year).  Strips approximate prefixes."""
    s = _APPROX_PREFIX.sub('', s.strip()).upper()
    parts = s.split()
    try:
        if len(parts) == 3:
            d, m, y = parts
            mon = _MONTHS.get(m)
            if mon and y.isdigit() and d.isdigit():
                return f"{y}-{mon:02d}-{int(d):02d}", int(y)
        if len(parts) == 2:
            m, y = parts
            mon = _MONTHS.get(m)
            if mon and y.isdigit():
                return f"{y}-{mon:02d}", int(y)
        if len(parts) == 1 and parts[0].isdigit():
            return parts[0], int(parts[0])
    except (ValueError, IndexError):
        pass
    return None, None


# ── GEDCOM line parser ─────────────────────────────────────────────────────────

def _parse_lines(text: str) -> list[tuple[int, str, str]]:
    """Split GEDCOM text into (level, tag, value) tuples."""
    result: list[tuple[int, str, str]] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        parts = line.split(' ', 2)
        try:
            level = int(parts[0])
        except (ValueError, IndexError):
            continue
        tag   = parts[1] if len(parts) > 1 else ''
        value = parts[2] if len(parts) > 2 else ''
        result.append((level, tag, value))
    return result


# ── Record parsers ─────────────────────────────────────────────────────────────

def _collect_text(first: str, sub: list[tuple[int, str, str]], at: int) -> str:
    """Gather NOTE/CONT/CONC continuations from a sub-block."""
    parts = [first]
    for lv, t, v in sub:
        if lv == at:
            if t == 'CONT':
                parts.append('\n' + v)
            elif t == 'CONC':
                parts.append(v)
    return ''.join(parts)


def _parse_indi(xref: str, block: list[tuple[int, str, str]]) -> dict:
    p: dict = {
        'xref': xref,
        'name': None, 'first_name': None, 'last_name': None,
        'nickname': None, 'title': None, 'sex': None, 'occupation': None,
        'religion': None, 'nationality': None, 'cause_of_death': None, 'education': None,
        'birth_date': None, 'birth_year': None, 'birth_place': None,
        'christening_date': None, 'christening_year': None, 'christening_place': None,
        'death_date': None, 'death_year': None, 'death_place': None,
        'burial_date': None, 'burial_year': None, 'burial_place': None,
        'notes': [],
        'events': [],
        'docs': [],    # [{file: arc_path, title: str|None}]
    }

    n = len(block)
    j = 0
    while j < n:
        lv, tag, val = block[j]
        if lv != 1:
            j += 1
            continue
        # Collect the sub-block for this level-1 tag
        end = j + 1
        while end < n and block[end][0] > 1:
            end += 1
        sub = block[j + 1:end]

        if tag == 'NAME':
            m = re.search(r'/([^/]*)/', val)
            surn = m.group(1).strip() if m else None
            if '/' in val:
                before = val.split('/')[0].strip()
                # Handle "/Surname/ Firstname" style (Hungarian / Mnemosyne GEDCOMs put
                # the surname first in the NAME value, with given name after the closing slash)
                after = val.rsplit('/', 1)[-1].strip()
                given = before or after
            else:
                given = val.strip()
            p['last_name']  = surn or None
            p['first_name'] = given or None
            for _, st, sv in sub:
                if st == 'GIVN':  p['first_name'] = sv.strip() or None
                elif st == 'SURN': p['last_name']  = sv.strip() or None
                elif st == 'NICK': p['nickname']   = sv.strip() or None
                elif st == 'NPFX': p['title']      = sv.strip() or None
            parts = [x for x in [p['first_name'], p['last_name']] if x]
            p['name'] = ' '.join(parts) or None

        elif tag == 'SEX':
            v = val.strip().upper()
            p['sex'] = v if v in ('M', 'F') else None

        elif tag in ('BIRT', 'CHR', 'DEAT', 'BURI'):
            pfx = {'BIRT': 'birth', 'CHR': 'christening', 'DEAT': 'death', 'BURI': 'burial'}[tag]
            for _, st, sv in sub:
                if st == 'DATE':
                    iso, yr = _parse_date(sv)
                    p[f'{pfx}_date'] = iso
                    p[f'{pfx}_year'] = yr
                elif st == 'PLAC':
                    p[f'{pfx}_place'] = sv.strip() or None
                elif st == 'CAUS' and tag == 'DEAT':
                    p['cause_of_death'] = sv.strip() or None

        elif tag == 'OCCU':
            p['occupation'] = val.strip() or None

        elif tag == 'EDUC':
            p['education'] = val.strip() or None

        elif tag == 'NOTE':
            text = _collect_text(val, sub, 2)
            if text.strip():
                p['notes'].append(text.strip())

        elif tag == 'EVEN':
            ev: dict = {
                'event_type': 'custom',
                'title': val.strip() or None,
                'date': None, 'year': None,
                'place': None, 'description': None,
            }
            for _, st, sv in sub:
                if st == 'TYPE':
                    ev['title'] = sv.strip() or ev['title']
                elif st == 'DATE':
                    iso, yr = _parse_date(sv)
                    ev['date'] = iso
                    ev['year'] = yr
                elif st == 'PLAC':
                    ev['place'] = sv.strip() or None
                elif st == 'NOTE':
                    text = _collect_text(sv, sub, 3)
                    ev['description'] = text.strip() or None
            # Events without a date or place are essentially descriptive text —
            # store them as person notes instead of calendar events.
            if not ev['date'] and not ev['year'] and not ev['place']:
                parts = [ev['title'], ev['description']]
                note_text = '\n'.join(x for x in parts if x)
                if note_text:
                    p['notes'].append(note_text)
            else:
                p['events'].append(ev)

        elif tag in ('_HOBBY', '_HOB', 'HOBBYIST'):
            text = _collect_text(val, sub, 2).strip()
            if text:
                p['notes'].append(f'Hobbies: {text}')

        elif tag == 'DSCR':
            text = _collect_text(val, sub, 2).strip()
            if text:
                p['notes'].append(f'Physical description: {text}')

        elif tag == 'RELI':
            text = _collect_text(val, sub, 2).strip()
            if text:
                p['religion'] = text

        elif tag == 'NATI':
            text = _collect_text(val, sub, 2).strip()
            if text:
                p['nationality'] = text

        elif tag == 'OBJE':
            doc: dict = {'file': None, 'title': None, 'stable_id': None, 'content_hash': None}
            for _, st, sv in sub:
                if st == 'FILE':   doc['file']  = sv.strip()
                elif st == 'TITL': doc['title'] = sv.strip()
                elif st == '_STID': doc['stable_id'] = sv.strip()
                elif st == '_HASH':
                    # stored as "sha256:<hex>" — strip the prefix
                    raw = sv.strip()
                    doc['content_hash'] = raw[7:] if raw.startswith('sha256:') else raw
            if doc['file'] and 'doc_' in doc['file']:
                p['docs'].append(doc)

        j = end

    return p


def _parse_fam(xref: str, block: list[tuple[int, str, str]]) -> dict:
    fam: dict = {
        'xref': xref, 'husb': None, 'wife': None, 'children': [],
        'marr_year': None, 'marr_place': None,
        'div_year': None, 'div_place': None,
    }
    n = len(block)
    j = 0
    while j < n:
        lv, tag, val = block[j]
        if lv != 1:
            j += 1
            continue
        end = j + 1
        while end < n and block[end][0] > 1:
            end += 1
        sub = block[j + 1:end]

        if tag == 'HUSB':   fam['husb'] = val.strip()
        elif tag == 'WIFE': fam['wife'] = val.strip()
        elif tag == 'CHIL': fam['children'].append(val.strip())
        elif tag in ('MARR', 'DIV'):
            pfx = 'marr' if tag == 'MARR' else 'div'
            for _, st, sv in sub:
                if st == 'DATE':
                    _, yr = _parse_date(sv)
                    fam[f'{pfx}_year'] = yr
                elif st == 'PLAC':
                    fam[f'{pfx}_place'] = sv.strip() or None

        j = end
    return fam


def _parse_sour(xref: str, block: list[tuple[int, str, str]]) -> dict:
    src: dict = {
        'xref': xref, 'title': None, 'author': None,
        'publisher': None, 'year': None, 'url': None, 'description': None,
    }
    for lv, tag, val in block:
        if lv != 1:
            continue
        if tag == 'TITL':   src['title']       = val.strip() or None
        elif tag == 'AUTH': src['author']      = val.strip() or None
        elif tag == 'PUBL':
            src['publisher'] = val.strip() or None
            m = re.search(r'\b(1[0-9]{3}|20[0-9]{2})\b', val)
            if m and not src['year']:
                src['year'] = int(m.group(1))
        elif tag in ('WWW', 'URL', '_LINK'):
            src['url'] = val.strip() or None
        elif tag == 'NOTE': src['description'] = val.strip() or None
    return src


# ── Top-level GEDCOM parser ────────────────────────────────────────────────────

def _parse_gedcom(lines: list[tuple[int, str, str]]) -> dict:
    individuals: dict[str, dict] = {}
    families:    dict[str, dict] = {}
    sources:     dict[str, dict] = {}

    n = len(lines)
    i = 0
    while i < n:
        lv, tag, val = lines[i]
        if lv != 0:
            i += 1
            continue

        # 0 @XREF@ TYPE
        xref  = tag  if tag.startswith('@')  else (val  if val.startswith('@')  else None)
        rtype = val.upper() if tag.startswith('@') else (tag.upper() if val.startswith('@') else None)

        end = i + 1
        while end < n and lines[end][0] != 0:
            end += 1
        block = lines[i + 1:end]

        if xref and rtype == 'INDI':
            individuals[xref] = _parse_indi(xref, block)
        elif xref and rtype == 'FAM':
            families[xref]    = _parse_fam(xref, block)
        elif xref and rtype == 'SOUR':
            sources[xref]     = _parse_sour(xref, block)

        i = end

    return {'individuals': individuals, 'families': families, 'sources': sources}


# ── File loader (supports .ged and .zip) ───────────────────────────────────────

def load_gedcom(file_data: bytes, filename: str) -> tuple[dict, Optional[bytes]]:
    """
    Parse GEDCOM from raw bytes.  Accepts .ged or .zip files.
    Returns (parsed, zip_bytes_or_None).
    parsed['_manifest'] contains the _manifest.json dict if present in a ZIP.
    """
    zip_bytes: Optional[bytes] = None
    manifest: Optional[dict] = None

    is_zip = filename.lower().endswith('.zip') or file_data[:2] == b'PK'
    if is_zip:
        zip_bytes = file_data
        with zipfile.ZipFile(io.BytesIO(file_data)) as zf:
            ged_names = [n for n in zf.namelist() if n.lower().endswith('.ged')]
            if not ged_names:
                raise ValueError("A ZIP-ben nem található .ged fájl")
            ged_text = zf.read(ged_names[0]).decode('utf-8-sig', errors='replace')
            if '_manifest.json' in zf.namelist():
                try:
                    import json as _json
                    manifest = _json.loads(zf.read('_manifest.json'))
                except Exception:
                    manifest = None
    else:
        ged_text = file_data.decode('utf-8-sig', errors='replace')

    lines  = _parse_lines(ged_text)
    parsed = _parse_gedcom(lines)
    parsed['_manifest'] = manifest
    return parsed, zip_bytes


# ── Name normalisation for matching ───────────────────────────────────────────

def _norm(name: Optional[str]) -> str:
    if not name:
        return ''
    nfkd = unicodedata.normalize('NFKD', name.lower())
    ascii_ = ''.join(c for c in nfkd if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', ascii_).strip()


# ── Match suggestion ───────────────────────────────────────────────────────────

def _name_norms(first: Optional[str], last: Optional[str], raw: Optional[str]) -> set[str]:
    """Build all reasonable normalized variants of a person's name."""
    norms: set[str] = set()
    if first and last:
        norms.add(_norm(f"{first} {last}"))   # Western: Zsuzsanna Márta Urbán
        norms.add(_norm(f"{last} {first}"))   # Hungarian: Urbán Zsuzsanna Márta
    elif first:
        norms.add(_norm(first))
    elif last:
        norms.add(_norm(last))
    if raw:
        norms.add(_norm(raw))
    norms.discard('')
    return norms


def _suggest_match(indi: dict, existing: list[dict]) -> Optional[dict]:
    """Return the best-scoring existing person for this imported individual, or None."""
    indi_norms = _name_norms(indi.get('first_name'), indi.get('last_name'), indi.get('name'))
    indi_year  = indi.get('birth_year')
    if not indi_norms:
        return None

    best_score = 0
    best_person: Optional[dict] = None

    for person in existing:
        ex_norms = _name_norms(person.get('first_name'), person.get('last_name'), person.get('name'))
        ex_year  = person.get('birth_year')

        if not ex_norms or not indi_norms.intersection(ex_norms):
            continue

        # Names match — score by birth year proximity
        if indi_year and ex_year:
            if indi_year == ex_year:
                score = 100
            elif abs(indi_year - ex_year) <= 2:
                score = 80
            else:
                score = 30   # same name, very different year
        elif indi_year is None and ex_year is None:
            score = 70
        else:
            score = 55   # one has year, the other doesn't

        # Biographical bonuses (only activate when extra fields are available)
        indi_bp = (indi.get('birth_place') or '').strip().lower()
        ex_bp   = (person.get('birth_place') or '').strip().lower()
        if indi_bp and ex_bp and indi_bp == ex_bp:
            score += 15

        indi_dy = indi.get('death_year')
        ex_dy   = person.get('death_year')
        if indi_dy and ex_dy:
            if indi_dy == ex_dy:
                score += 10
            elif abs(indi_dy - ex_dy) <= 2:
                score += 5

        indi_dp = (indi.get('death_place') or '').strip().lower()
        ex_dp   = (person.get('death_place') or '').strip().lower()
        if indi_dp and ex_dp and indi_dp == ex_dp:
            score += 5

        if score > best_score:
            best_score = score
            best_person = person

    if not best_person or best_score < 30:
        return None

    conf = 'exact' if best_score >= 100 else 'high' if best_score >= 55 else 'low'
    return {
        'id':         best_person['id'],
        'name':       best_person['name'] or '',
        'birth_year': best_person.get('birth_year'),
        'confidence': conf,
    }


# ── Preview builder ────────────────────────────────────────────────────────────

def _build_relatives_map(parsed: dict) -> dict[str, list[dict]]:
    """Build xref → [{role, name}] from FAM records for preview context."""
    individuals = parsed['individuals']
    rel_map: dict[str, list[dict]] = {xref: [] for xref in individuals}

    for fam in parsed['families'].values():
        husb_xref = fam.get('husb')
        wife_xref = fam.get('wife')
        child_xrefs = [c for c in fam.get('children', []) if c in individuals]

        husb_name = individuals[husb_xref]['name'] if husb_xref and husb_xref in individuals else None
        wife_name = individuals[wife_xref]['name'] if wife_xref and wife_xref in individuals else None

        if husb_xref in individuals and wife_name:
            rel_map[husb_xref].append({'role': 'spouse', 'name': wife_name})
        if wife_xref in individuals and husb_name:
            rel_map[wife_xref].append({'role': 'spouse', 'name': husb_name})

        for child_xref in child_xrefs:
            if husb_name:
                rel_map[child_xref].append({'role': 'parent', 'name': husb_name})
            if wife_name:
                rel_map[child_xref].append({'role': 'parent', 'name': wife_name})

        child_names = [individuals[c]['name'] for c in child_xrefs if individuals[c].get('name')]
        for parent_xref in [husb_xref, wife_xref]:
            if parent_xref and parent_xref in individuals:
                for child_name in child_names:
                    rel_map[parent_xref].append({'role': 'child', 'name': child_name})

    return rel_map


def _build_gedcom_rel_maps(
    parsed: dict,
) -> tuple[dict[str, list[str]], dict[str, list[str]], dict[str, list[str]]]:
    """Build inc_par/inc_chi/inc_spo keyed by GEDCOM xref strings."""
    individuals = parsed['individuals']
    inc_par: dict[str, list[str]] = {x: [] for x in individuals}
    inc_chi: dict[str, list[str]] = {x: [] for x in individuals}
    inc_spo: dict[str, list[str]] = {x: [] for x in individuals}
    for fam in parsed['families'].values():
        husb     = fam.get('husb')
        wife     = fam.get('wife')
        children = [c for c in fam.get('children', []) if c in individuals]
        if husb and wife and husb in individuals and wife in individuals:
            inc_spo[husb].append(wife)
            inc_spo[wife].append(husb)
        for child in children:
            for parent in (x for x in [husb, wife] if x and x in individuals):
                inc_par[child].append(parent)
                inc_chi[parent].append(child)
    return inc_par, inc_chi, inc_spo


def _build_existing_rel_maps(
    relations: list[dict],
) -> tuple[dict[int, list[int]], dict[int, list[int]], dict[int, list[int]]]:
    """Build ex_par/ex_chi/ex_spo keyed by DB person IDs."""
    ex_par: dict[int, list[int]] = {}
    ex_chi: dict[int, list[int]] = {}
    ex_spo: dict[int, list[int]] = {}
    for rel in relations:
        a     = rel['person_a_id']
        b     = rel['person_b_id']
        rtype = rel.get('type')
        if rtype == 'parent':
            ex_par.setdefault(b, []).append(a)
            ex_chi.setdefault(a, []).append(b)
        elif rtype == 'spouse':
            ex_spo.setdefault(a, []).append(b)
            ex_spo.setdefault(b, []).append(a)
    return ex_par, ex_chi, ex_spo


def _gedcom_context_score(
    xref:       str,
    ex_id:      int,
    xref_remap: dict[str, int],
    inc_par:    dict[str, list[str]],
    inc_chi:    dict[str, list[str]],
    inc_spo:    dict[str, list[str]],
    ex_par:     dict[int, list[int]],
    ex_chi:     dict[int, list[int]],
    ex_spo:     dict[int, list[int]],
) -> int:
    score = 0
    for px in inc_par.get(xref, []):
        pex = xref_remap.get(px)
        if pex is not None:
            score += 2 if pex in ex_par.get(ex_id, []) else -2
    for sx in inc_spo.get(xref, []):
        sex = xref_remap.get(sx)
        if sex is not None:
            score += 3 if sex in ex_spo.get(ex_id, []) else -3
    for cx in inc_chi.get(xref, []):
        cex = xref_remap.get(cx)
        if cex is not None:
            score += 1 if cex in ex_chi.get(ex_id, []) else -1
    return score


def _gedcom_name_year_ok(inc_norms: set, inc_year: Optional[int], candidate: dict) -> bool:
    ex_norms = _name_norms(
        candidate.get('first_name'), candidate.get('last_name'), candidate.get('name')
    )
    if not ex_norms or not inc_norms.intersection(ex_norms):
        return False
    ex_year = candidate.get('birth_year')
    if inc_year and ex_year and abs(inc_year - ex_year) > 5:
        return False
    return True


def _would_create_cycle(parent_id: int, child_id: int, conn: sqlite3.Connection) -> bool:
    """
    Return True if making parent_id a parent of child_id would create a cycle,
    or if parent_id was born after child_id (chronologically impossible).
    No upper age gap limit — 100+-year-old parents are allowed.
    """
    rows = conn.execute(
        "SELECT id, birth_year FROM persons WHERE id IN (?,?)", (parent_id, child_id)
    ).fetchall()
    years = {r[0]: r[1] for r in rows}
    parent_year = years.get(parent_id)
    child_year  = years.get(child_id)
    if parent_year and child_year and parent_year > child_year:
        return True

    # Walk ancestors of parent_id upward; cycle if we reach child_id.
    visited: set[int] = set()
    queue:   list[int] = [parent_id]
    while queue:
        pid = queue.pop()
        if pid in visited:
            continue
        visited.add(pid)
        if pid == child_id:
            return True
        for (anc_id,) in conn.execute(
            "SELECT person_a_id FROM relations WHERE type='parent' AND person_b_id=?", (pid,)
        ).fetchall():
            if anc_id not in visited:
                queue.append(anc_id)
    return False


def build_preview(
    parsed:             dict,
    existing_persons:   list[dict],
    existing_relations: list[dict] | None = None,
) -> list[dict]:
    """Return a per-person preview list with three-pass context-aware matching."""
    if existing_relations is None:
        existing_relations = []

    existing_by_id = {p['id']: p for p in existing_persons}
    rel_map        = _build_relatives_map(parsed)

    # ── Pass 1: Name + birth_year + biographical scoring ─────────────────────
    initial_matches: dict[str, Optional[dict]] = {
        xref: _suggest_match(indi, existing_persons)
        for xref, indi in parsed['individuals'].items()
    }

    tentative_remap: dict[str, int] = {}
    claimed_ex_ids:  set[int]       = set()

    for target_conf in ('exact', 'high'):
        for xref in parsed['individuals']:
            m = initial_matches[xref]
            if m and m['confidence'] == target_conf and m['id'] not in claimed_ex_ids:
                tentative_remap[xref] = m['id']
                claimed_ex_ids.add(m['id'])

    # ── Pass 2: Family-context validation ────────────────────────────────────
    inc_par, inc_chi, inc_spo = _build_gedcom_rel_maps(parsed)
    ex_par,  ex_chi,  ex_spo  = _build_existing_rel_maps(existing_relations)
    context_notes: dict[str, str] = {}

    for xref, ex_id in list(tentative_remap.items()):
        cs = _gedcom_context_score(
            xref, ex_id, tentative_remap,
            inc_par, inc_chi, inc_spo,
            ex_par,  ex_chi,  ex_spo,
        )
        if cs > 0:
            context_notes[xref] = 'confirmed'
        elif cs < 0:
            context_notes[xref] = 'conflict'
            del tentative_remap[xref]
            claimed_ex_ids.discard(ex_id)
            m = initial_matches[xref]
            if m:
                initial_matches[xref] = {**m, 'confidence': 'low', 'context_conflict': True}

    # ── Pass 3: Relationship-guided discovery for still-unmatched ────────────
    for xref, indi in parsed['individuals'].items():
        if xref in tentative_remap:
            continue

        inc_norms = _name_norms(indi.get('first_name'), indi.get('last_name'), indi.get('name'))
        if not inc_norms:
            continue

        inc_year     = indi.get('birth_year')
        found_ex_id: Optional[int] = None

        for parent_xref in inc_par.get(xref, []):
            parent_ex = tentative_remap.get(parent_xref)
            if parent_ex is None:
                continue
            for child_ex_id in ex_chi.get(parent_ex, []):
                if child_ex_id in claimed_ex_ids:
                    continue
                child_ex = existing_by_id.get(child_ex_id)
                if child_ex and _gedcom_name_year_ok(inc_norms, inc_year, child_ex):
                    found_ex_id = child_ex_id
                    break
            if found_ex_id:
                break

        if found_ex_id is None:
            for spouse_xref in inc_spo.get(xref, []):
                spouse_ex = tentative_remap.get(spouse_xref)
                if spouse_ex is None:
                    continue
                for s2_ex_id in ex_spo.get(spouse_ex, []):
                    if s2_ex_id in claimed_ex_ids:
                        continue
                    s2_ex = existing_by_id.get(s2_ex_id)
                    if s2_ex and _gedcom_name_year_ok(inc_norms, inc_year, s2_ex):
                        found_ex_id = s2_ex_id
                        break
                if found_ex_id:
                    break

        if found_ex_id is None:
            for child_xref in inc_chi.get(xref, []):
                child_ex = tentative_remap.get(child_xref)
                if child_ex is None:
                    continue
                for parent_ex_id in ex_par.get(child_ex, []):
                    if parent_ex_id in claimed_ex_ids:
                        continue
                    parent_ex = existing_by_id.get(parent_ex_id)
                    if parent_ex and _gedcom_name_year_ok(inc_norms, inc_year, parent_ex):
                        found_ex_id = parent_ex_id
                        break
                if found_ex_id:
                    break

        if found_ex_id is not None:
            found_ex = existing_by_id[found_ex_id]
            tentative_remap[xref] = found_ex_id
            claimed_ex_ids.add(found_ex_id)
            initial_matches[xref] = {
                'id':           found_ex_id,
                'name':         found_ex.get('name') or '',
                'birth_year':   found_ex.get('birth_year'),
                'confidence':   'high',
                'match_source': 'family',
            }
            context_notes[xref] = 'confirmed'

    # ── Build rows ────────────────────────────────────────────────────────────
    rows = []
    for xref, indi in parsed['individuals'].items():
        match = initial_matches.get(xref)

        if match and match['confidence'] in ('exact', 'high'):
            default_action   = 'merge'
            default_merge_id = match['id']
        else:
            default_action   = 'create'
            default_merge_id = None

        rows.append({
            'xref':            xref,
            'name':            indi['name'],
            'first_name':      indi['first_name'],
            'last_name':       indi['last_name'],
            'birth_year':      indi['birth_year'],
            'birth_place':     indi['birth_place'],
            'death_year':      indi['death_year'],
            'sex':             indi['sex'],
            'events_count':    len(indi['events']),
            'notes_count':     len(indi['notes']),
            'docs_count':      len(indi['docs']),
            'relatives':       rel_map.get(xref, []),
            'suggested_match': match,
            'action':          default_action,
            'merge_with_id':   default_merge_id,
            'context_status':  context_notes.get(xref, 'none'),
        })

    _order = {'exact': 0, 'high': 1, 'low': 3}

    def _sort_key(r: dict) -> int:
        m = r['suggested_match']
        if not m:
            return 2
        return _order.get(m['confidence'], 3)

    rows.sort(key=_sort_key)
    return rows


# ── Session store ──────────────────────────────────────────────────────────────

_sessions: dict[str, dict] = {}
_SESSION_MAX = 10


def store_session(data: dict) -> str:
    token = uuid.uuid4().hex
    if len(_sessions) >= _SESSION_MAX:
        _sessions.pop(next(iter(_sessions)))
    _sessions[token] = data
    return token


def get_session(token: str) -> Optional[dict]:
    return _sessions.get(token)


def clear_session(token: str) -> None:
    _sessions.pop(token, None)


# ── Rollback store ─────────────────────────────────────────────────────────────

_ROLLBACK_TTL = 30 * 60   # 30 minutes

# keyed by str(db_path) — one rollback slot per project
_rollback_store: dict[str, dict] = {}


def store_rollback(db_path: Path, data: dict) -> None:
    _rollback_store[str(db_path)] = {**data, 'created_at': time.time()}


def get_rollback(db_path: Path) -> Optional[dict]:
    entry = _rollback_store.get(str(db_path))
    if not entry:
        return None
    if time.time() - entry['created_at'] > _ROLLBACK_TTL:
        _rollback_store.pop(str(db_path), None)
        return None
    return entry


def rollback_available(db_path: Path) -> bool:
    return get_rollback(db_path) is not None


def execute_rollback(db_path: Path, docs_dir: Path) -> Optional[dict]:
    """Undo the last import. Returns summary of deleted items, or None if unavailable."""
    data = get_rollback(db_path)
    if not data:
        return None

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    deleted: dict[str, int] = {k: 0 for k in ('persons', 'relations', 'events', 'sources', 'notes', 'documents', 'clusters', 'images', 'faces')}

    # 1. Delete created persons (manual cascade — SQLAlchemy ORM not available here)
    for pid in data.get('created_person_ids', []):
        # Collect document files before deletion
        doc_rows = conn.execute("SELECT stored_name FROM documents WHERE person_id = ?", (pid,)).fetchall()
        for row in doc_rows:
            _try_delete_file(docs_dir / row[0])

        conn.execute("DELETE FROM note_citations WHERE note_id IN (SELECT id FROM person_notes WHERE person_id = ?)", (pid,))
        conn.execute("DELETE FROM person_notes WHERE person_id = ?", (pid,))
        conn.execute("DELETE FROM citations WHERE person_id = ?", (pid,))
        conn.execute("DELETE FROM documents WHERE person_id = ?", (pid,))
        conn.execute("DELETE FROM event_persons WHERE person_id = ?", (pid,))
        conn.execute("DELETE FROM relations WHERE person_a_id = ? OR person_b_id = ?", (pid, pid))
        conn.execute("DELETE FROM persons WHERE id = ?", (pid,))
        deleted['persons'] += 1

    # Clean up events that no longer have any person links
    conn.execute("DELETE FROM events WHERE id NOT IN (SELECT DISTINCT event_id FROM event_persons)")
    conn.commit()

    # 2. Delete relations added between existing (merged) persons
    for rid in data.get('added_relation_ids', []):
        cur = conn.execute("DELETE FROM relations WHERE id = ?", (rid,))
        if cur.rowcount:
            deleted['relations'] += 1
    conn.commit()

    # 3. Delete notes added to merged persons
    for nid in data.get('added_note_ids', []):
        conn.execute("DELETE FROM note_citations WHERE note_id = ?", (nid,))
        cur = conn.execute("DELETE FROM person_notes WHERE id = ?", (nid,))
        if cur.rowcount:
            deleted['notes'] += 1
    conn.commit()

    # 4. Delete events added to merged persons
    for eid in data.get('added_event_ids', []):
        conn.execute("DELETE FROM event_persons WHERE event_id = ?", (eid,))
        cur = conn.execute("DELETE FROM events WHERE id = ?", (eid,))
        if cur.rowcount:
            deleted['events'] += 1
    conn.commit()

    # 5. Delete documents added to merged persons
    for doc_info in data.get('added_documents', []):
        _try_delete_file(docs_dir / doc_info['stored_name'])
        cur = conn.execute("DELETE FROM documents WHERE id = ?", (doc_info['id'],))
        if cur.rowcount:
            deleted['documents'] += 1
    conn.commit()

    # 6. Delete added sources (only if no longer cited by anything)
    for sid in data.get('added_source_ids', []):
        n_cit = conn.execute("SELECT COUNT(*) FROM citations WHERE source_id = ?", (sid,)).fetchone()[0]
        n_nc  = conn.execute("SELECT COUNT(*) FROM note_citations WHERE source_id = ?", (sid,)).fetchone()[0]
        if n_cit == 0 and n_nc == 0:
            cur = conn.execute("DELETE FROM sources WHERE id = ?", (sid,))
            if cur.rowcount:
                deleted['sources'] += 1
    conn.commit()

    # 7. Restore merged person field snapshots
    for snap in data.get('merged_snapshots', []):
        before = snap.get('before')
        if before:
            set_clause = ', '.join(f"{k} = ?" for k in before)
            conn.execute(f"UPDATE persons SET {set_clause} WHERE id = ?", [*before.values(), snap['id']])
    conn.commit()

    # 8. Undo cluster → person re-links (restore old person_id, usually NULL)
    for item in data.get('relinked_clusters', []):
        conn.execute("UPDATE clusters SET person_id = ? WHERE id = ?",
                     (item.get('old_person_id'), item['id']))
        deleted['clusters'] += 1
    conn.commit()

    # 9. Unlink newly created clusters (set person_id = NULL; keep faces/embeddings)
    for cl_id in data.get('added_cluster_ids', []):
        conn.execute("UPDATE clusters SET person_id = NULL WHERE id = ?", (cl_id,))
        deleted['clusters'] += 1
    conn.commit()

    # 10. Delete newly imported faces on existing images
    for face_id in data.get('added_face_ids', []):
        cur = conn.execute("DELETE FROM faces WHERE id = ?", (face_id,))
        if cur.rowcount:
            deleted['faces'] += 1
    conn.commit()

    # 11. Delete newly imported images (explicit face cascade + file removal)
    for img_info in data.get('added_image_ids', []):
        conn.execute("DELETE FROM faces WHERE image_id = ?", (img_info['id'],))
        cur = conn.execute("DELETE FROM images WHERE id = ?", (img_info['id'],))
        if cur.rowcount:
            _try_delete_file(Path(img_info['path']))
            deleted['images'] += 1
    conn.commit()

    # 12. Restore auto-set thumbnails
    for item in data.get('updated_thumbnails', []):
        conn.execute(
            "UPDATE persons SET thumbnail_face_id = ? WHERE id = ?",
            (item.get('old_thumbnail_face_id'), item['person_id']),
        )
    conn.commit()

    conn.close()
    _rollback_store.pop(str(db_path), None)
    return deleted


def _try_delete_file(path: Path) -> None:
    try:
        if path.exists():
            path.unlink()
    except Exception:
        pass


# ── Import executor ────────────────────────────────────────────────────────────

def execute_import(
    parsed:    dict,
    decisions: list[dict],   # [{xref, action: 'merge'|'create'|'skip', merge_with_id: int|None}]
    db_path:   Path,
    docs_dir:  Path,
    zip_bytes: Optional[bytes],
    options:   Optional[dict] = None,
) -> tuple[dict, dict]:
    """
    Apply user decisions and import data into the project database.
    Returns (import_stats, rollback_data).

    options keys (all default True):
      import_relations, import_events, import_sources, import_notes, import_documents
    """
    if options is None:
        options = {}
    do_relations = options.get('import_relations', True)
    do_events    = options.get('import_events',    True)
    do_sources   = options.get('import_sources',   True)
    do_notes     = options.get('import_notes',     True)
    do_documents = options.get('import_documents', True)

    dec_map: dict[str, dict] = {d['xref']: d for d in decisions}

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")

    stats = {
        'persons_created': 0,
        'persons_merged':  0,
        'persons_skipped': 0,
        'relations_added': 0,
        'events_added':    0,
        'sources_added':   0,
        'notes_added':     0,
        'documents_added': 0,
        'images_reused':   0,  # photos matched in local DB (not re-imported)
        'images_new':      0,  # new photos extracted from ZIP
    }

    rollback: dict = {
        'created_person_ids': [],
        'added_relation_ids': [],
        'added_note_ids':     [],   # notes added to MERGED (existing) persons
        'added_event_ids':    [],   # events added to MERGED persons
        'added_documents':    [],   # [{id, stored_name}] for MERGED persons
        'added_source_ids':   [],
        'merged_snapshots':   [],   # [{id, before: {field: old_val}}]
    }

    # xref → actual DB person id (needed for FAM-based relation creation)
    xref_to_id: dict[str, int] = {}
    # track which xrefs were merged (vs created) so we know where to track notes/events
    merged_xrefs: set[str] = set()

    # ── 1. Sources ────────────────────────────────────────────────────────────
    existing_src_titles: dict[str, int] = {
        row['title']: row['id']
        for row in conn.execute("SELECT id, title FROM sources").fetchall()
    }
    sour_xref_to_id: dict[str, int] = {}

    if do_sources:
        for sxref, src in parsed['sources'].items():
            title = (src['title'] or '').strip() or 'Untitled source'
            if title in existing_src_titles:
                sour_xref_to_id[sxref] = existing_src_titles[title]
            else:
                cur = conn.execute(
                    "INSERT INTO sources "
                    "(title, author, publisher, year, url, description, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
                    (title, src['author'], src['publisher'], src['year'],
                     src['url'], src['description']),
                )
                conn.commit()
                sour_xref_to_id[sxref] = cur.lastrowid
                existing_src_titles[title] = cur.lastrowid
                rollback['added_source_ids'].append(cur.lastrowid)
                stats['sources_added'] += 1

    # ── 2. Persons ────────────────────────────────────────────────────────────
    _INDI_FIELDS = (
        'first_name', 'last_name', 'nickname', 'title', 'sex', 'occupation',
        'religion', 'nationality', 'cause_of_death', 'education',
        'birth_date', 'birth_year', 'birth_place',
        'christening_date', 'christening_year', 'christening_place',
        'death_date', 'death_year', 'death_place',
        'burial_date', 'burial_year', 'burial_place',
    )

    for xref, indi in parsed['individuals'].items():
        dec    = dec_map.get(xref, {})
        action = dec.get('action', 'create')

        if action == 'skip':
            stats['persons_skipped'] += 1
            continue

        db_id: Optional[int] = None

        if action == 'merge' and dec.get('merge_with_id'):
            merge_id = dec['merge_with_id']
            existing_row = conn.execute(
                "SELECT * FROM persons WHERE id = ?", (merge_id,)
            ).fetchone()
            if existing_row:
                updates = {
                    f: indi.get(f)
                    for f in _INDI_FIELDS
                    if existing_row[f] is None and indi.get(f) is not None
                }
                if updates:
                    before_state = {f: existing_row[f] for f in updates}
                    rollback['merged_snapshots'].append({'id': merge_id, 'before': before_state})
                    set_clause = ', '.join(f"{k} = ?" for k in updates)
                    conn.execute(
                        f"UPDATE persons SET {set_clause} WHERE id = ?",
                        [*updates.values(), merge_id],
                    )
                    conn.commit()
                xref_to_id[xref] = merge_id
                db_id = merge_id
                merged_xrefs.add(xref)
                stats['persons_merged'] += 1

        if db_id is None:   # create (or merge target not found)
            name_parts = [indi['first_name'], indi['last_name']]
            name = ' '.join(p for p in name_parts if p) or indi['name'] or 'Unknown'
            cur = conn.execute(
                """INSERT INTO persons (
                    name, first_name, last_name, nickname, title, sex, occupation,
                    religion, nationality, cause_of_death, education,
                    birth_date, birth_year, birth_place,
                    christening_date, christening_year, christening_place,
                    death_date, death_year, death_place,
                    burial_date, burial_year, burial_place
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    name, indi['first_name'], indi['last_name'],
                    indi['nickname'], indi['title'], indi['sex'], indi['occupation'],
                    indi['religion'], indi['nationality'], indi['cause_of_death'], indi['education'],
                    indi['birth_date'], indi['birth_year'], indi['birth_place'],
                    indi['christening_date'], indi['christening_year'], indi['christening_place'],
                    indi['death_date'], indi['death_year'], indi['death_place'],
                    indi['burial_date'], indi['burial_year'], indi['burial_place'],
                ),
            )
            conn.commit()
            db_id = cur.lastrowid
            xref_to_id[xref] = db_id
            rollback['created_person_ids'].append(db_id)
            stats['persons_created'] += 1

        # ── Notes ─────────────────────────────────────────────────────────────
        is_merged = xref in merged_xrefs
        if do_notes:
            for note_text in indi['notes']:
                cur2 = conn.execute(
                    "INSERT INTO person_notes "
                    "(person_id, content, sort_order, created_at, updated_at) "
                    "VALUES (?, ?, 0, datetime('now'), datetime('now'))",
                    (db_id, note_text),
                )
                if is_merged:
                    rollback['added_note_ids'].append(cur2.lastrowid)
                stats['notes_added'] += 1
            conn.commit()

        # ── Events ────────────────────────────────────────────────────────────
        if do_events:
            for ev in indi['events']:
                ev_title = (ev.get('title') or '').strip() or None
                ev_date  = ev.get('date')

                # Skip if exact duplicate already linked to this person
                dup = conn.execute(
                    """SELECT ep.id FROM event_persons ep
                       JOIN events e ON e.id = ep.event_id
                       WHERE ep.person_id = ?
                         AND (e.title = ? OR (e.title IS NULL AND ? IS NULL))
                         AND (e.date  = ? OR (e.date  IS NULL AND ? IS NULL))""",
                    (db_id, ev_title, ev_title, ev_date, ev_date),
                ).fetchone()
                if dup:
                    continue

                cur2 = conn.execute(
                    "INSERT INTO events "
                    "(event_type, title, date, year, place, description, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
                    (ev.get('event_type', 'custom'), ev_title, ev_date,
                     ev.get('year'), ev.get('place'), ev.get('description')),
                )
                ev_id = cur2.lastrowid
                conn.execute(
                    "INSERT INTO event_persons (event_id, person_id, role) VALUES (?, ?, 'primary')",
                    (ev_id, db_id),
                )
                conn.commit()
                if is_merged:
                    rollback['added_event_ids'].append(ev_id)
                stats['events_added'] += 1

        # ── Documents from ZIP ────────────────────────────────────────────────
        if do_documents and zip_bytes and indi['docs']:
            docs_dir.mkdir(parents=True, exist_ok=True)
            try:
                with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
                    zip_names = set(zf.namelist())
                    for doc_entry in indi['docs']:
                        arc_path = doc_entry['file']
                        if arc_path not in zip_names:
                            continue
                        orig_filename = Path(arc_path).name
                        # Strip leading doc_{id}_ prefix to get original filename
                        m = re.match(r'doc_\d+_(.+)', orig_filename)
                        display_name = m.group(1).replace('_', ' ') if m else orig_filename

                        ext = Path(display_name).suffix
                        stored_name = f"{uuid.uuid4().hex}{ext}"
                        dest = docs_dir / stored_name
                        dest.write_bytes(zf.read(arc_path))

                        mime = mimetypes.guess_type(display_name)[0] or 'application/octet-stream'
                        doc_title = doc_entry.get('title') or None

                        cur3 = conn.execute(
                            "INSERT INTO documents "
                            "(person_id, stored_name, filename, mime_type, title, created_at) "
                            "VALUES (?, ?, ?, ?, ?, datetime('now'))",
                            (db_id, stored_name, display_name, mime, doc_title),
                        )
                        conn.commit()
                        if is_merged:
                            rollback['added_documents'].append({'id': cur3.lastrowid, 'stored_name': stored_name})
                        stats['documents_added'] += 1
            except zipfile.BadZipFile:
                pass

    # ── 3. Relations from FAM records ─────────────────────────────────────────
    if not do_relations:
        conn.close()
        return stats, rollback

    for _fxref, fam in parsed['families'].items():
        husb_id = xref_to_id.get(fam['husb']) if fam['husb'] else None
        wife_id = xref_to_id.get(fam['wife']) if fam['wife'] else None

        # Spouse relation
        if husb_id and wife_id:
            exists = conn.execute(
                """SELECT id FROM relations WHERE type = 'spouse' AND (
                       (person_a_id = ? AND person_b_id = ?) OR
                       (person_a_id = ? AND person_b_id = ?)
                   )""",
                (husb_id, wife_id, wife_id, husb_id),
            ).fetchone()
            if not exists:
                cur = conn.execute(
                    "INSERT INTO relations "
                    "(type, person_a_id, person_b_id, marriage_year, marriage_place) "
                    "VALUES ('spouse', ?, ?, ?, ?)",
                    (husb_id, wife_id, fam['marr_year'], fam['marr_place']),
                )
                conn.commit()
                rollback['added_relation_ids'].append(cur.lastrowid)
                stats['relations_added'] += 1

        # Parent → child relations
        for child_xref in fam['children']:
            child_id = xref_to_id.get(child_xref)
            if not child_id:
                continue
            for parent_id in filter(None, [husb_id, wife_id]):
                exists = conn.execute(
                    "SELECT id FROM relations WHERE type='parent' "
                    "AND person_a_id=? AND person_b_id=?",
                    (parent_id, child_id),
                ).fetchone()
                if exists:
                    continue
                count = conn.execute(
                    "SELECT COUNT(*) FROM relations WHERE type='parent' AND person_b_id=?",
                    (child_id,),
                ).fetchone()[0]
                if count >= 2:
                    continue
                if _would_create_cycle(parent_id, child_id, conn):
                    continue
                cur = conn.execute(
                    "INSERT INTO relations (type, person_a_id, person_b_id) VALUES ('parent',?,?)",
                    (parent_id, child_id),
                )
                conn.commit()
                rollback['added_relation_ids'].append(cur.lastrowid)
                stats['relations_added'] += 1

    conn.close()
    return stats, rollback

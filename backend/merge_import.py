"""
ZIP merge import — two-step flow mirroring gedcom_import.

Three-pass context-aware matching:
  Pass 1 — name + birth_year heuristic (same as gedcom_import)
  Pass 2 — family-context validation (confirm or downgrade to 'low')
  Pass 3 — relationship-guided discovery for still-unmatched persons

Also imports document_persons junction table.
"""
from __future__ import annotations

import io
import mimetypes
import os
import sqlite3
import tempfile
import uuid
import zipfile
from pathlib import Path
from typing import Optional

from .gedcom_import import (
    _name_norms,
    store_session, get_session, clear_session,
    store_rollback, _try_delete_file,
    _would_create_cycle,
)

# ── Fields ────────────────────────────────────────────────────────────────────

_READ_FIELDS = (
    'id', 'name', 'title', 'last_name', 'first_name', 'middle_name', 'nickname',
    'sex', 'occupation',
    'birth_year', 'birth_date', 'birth_place',
    'christening_year', 'christening_date', 'christening_place',
    'death_year', 'death_date', 'death_place',
    'burial_year', 'burial_date', 'burial_place',
)

_MERGE_FIELDS = (
    'title', 'last_name', 'first_name', 'middle_name', 'nickname',
    'sex', 'occupation',
    'birth_year', 'birth_date', 'birth_place',
    'christening_year', 'christening_date', 'christening_place',
    'death_year', 'death_date', 'death_place',
    'burial_year', 'burial_date', 'burial_place',
)


def _safe_rows(conn: sqlite3.Connection, sql: str) -> list[dict]:
    """Execute a SELECT; return [] if the table/column doesn't exist."""
    try:
        conn.row_factory = sqlite3.Row
        return [dict(r) for r in conn.execute(sql).fetchall()]
    except Exception:
        return []


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    """Whether an incoming (possibly older-schema) DB has a given column."""
    try:
        return any(r[1] == column for r in conn.execute(f"PRAGMA table_info({table})").fetchall())
    except Exception:
        return False


# ── Read incoming ZIP DB ──────────────────────────────────────────────────────

def read_zip_db(zip_data: bytes) -> dict:
    """
    Extract project.db from a Mnemosyne export ZIP and read genealogy tables.
    Returns dict with keys: persons, relations, documents, document_persons,
    events, event_persons.
    """
    with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
        if 'project.db' not in zf.namelist():
            raise ValueError("ZIP does not contain project.db")
        db_bytes = zf.read('project.db')

    with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as tmp:
        tmp.write(db_bytes)
        tmp_path = tmp.name

    conn = sqlite3.connect(tmp_path)
    conn.row_factory = sqlite3.Row
    try:
        persons = _safe_rows(conn, f"SELECT {', '.join(_READ_FIELDS)} FROM persons")

        relations = _safe_rows(conn,
            "SELECT id, type, person_a_id, person_b_id, "
            "marriage_year, marriage_place, divorce_year, divorce_place FROM relations"
        )

        # is_text arrived in schema v6; older export ZIPs simply don't have it.
        is_text_col = ", is_text" if _has_column(conn, "documents", "is_text") else ""
        documents = _safe_rows(conn,
            "SELECT id, person_id, stored_name, filename, mime_type, "
            f"title, doc_type, year, description{is_text_col} FROM documents"
        )

        document_persons = _safe_rows(conn,
            "SELECT document_id, person_id, role FROM document_persons"
        )

        # Body references and attached photos of in-app text documents (v6+).
        document_citations = _safe_rows(conn,
            "SELECT id, document_id, source_id, marker, detail, custom_label FROM document_citations"
        )
        document_images = _safe_rows(conn,
            "SELECT document_id, image_id, sort_order, caption FROM document_images"
        )
        # Extra files on a document beyond its primary one (v10+); older
        # export ZIPs simply don't have the table.
        document_files = _safe_rows(conn,
            "SELECT id, document_id, stored_name, filename, mime_type, sort_order FROM document_files"
        )
        # [n] references inside a document's description field (v11+).
        document_description_citations = _safe_rows(conn,
            "SELECT id, document_id, source_id, marker, detail, custom_label FROM document_description_citations"
        )

        person_notes = _safe_rows(conn,
            "SELECT id, person_id, title, content, sort_order FROM person_notes"
        )

        events = _safe_rows(conn,
            "SELECT id, event_type, title, date, year, place, description FROM events"
        )

        event_persons = _safe_rows(conn,
            "SELECT event_id, person_id, role FROM event_persons"
        )

        # Clusters: only named (label >= 0) with a person assigned.
        clusters = _safe_rows(conn,
            "SELECT id, label, person_id FROM clusters WHERE label >= 0 AND person_id IS NOT NULL"
        )

        named_cl_ids_sql = (
            "SELECT id FROM clusters WHERE label >= 0 AND person_id IS NOT NULL"
        )
        # Faces belonging to those named clusters (includes embeddings).
        faces = _safe_rows(conn,
            f"SELECT id, image_id, bbox_json, embedding, det_score, cluster_id, manually_assigned "
            f"FROM faces WHERE cluster_id IN ({named_cl_ids_sql})"
        )

        # Images referenced by those faces only.
        face_image_ids = ', '.join(str(f['image_id']) for f in faces) if faces else '0'
        images = _safe_rows(conn,
            f"SELECT id, path, mtime, exif_date, scan_status, meta_json "
            f"FROM images WHERE id IN ({face_image_ids})"
        )

        sources = _safe_rows(conn,
            "SELECT id, title, source_type, author, year, publisher, location, url, description, "
            "document_id, event_id FROM sources"
        )
        # relation_id (marriage citations) arrived in schema v15 — an older ZIP
        # has none, and asking for the column would drop every citation row.
        rel_col = ", relation_id" if _has_column(conn, "citations", "relation_id") else ""
        citations = _safe_rows(conn,
            f"SELECT id, source_id, person_id, fact, detail, notes{rel_col} FROM citations"
        )
        note_citations = _safe_rows(conn,
            "SELECT id, note_id, source_id, marker, detail, custom_label FROM note_citations"
        )
        event_images_data = _safe_rows(conn,
            "SELECT event_id, image_id FROM event_images"
        )
    finally:
        conn.close()
        Path(tmp_path).unlink(missing_ok=True)

    return {
        'persons':          persons,
        'relations':        relations,
        'documents':          documents,
        'document_persons':   document_persons,
        'document_citations': document_citations,
        'document_images':    document_images,
        'document_files':     document_files,
        'document_description_citations': document_description_citations,
        'person_notes':     person_notes,
        'events':           events,
        'event_persons':    event_persons,
        'clusters':         clusters,
        'faces':            faces,
        'images':           images,
        'sources':          sources,
        'citations':        citations,
        'note_citations':   note_citations,
        'event_images':     event_images_data,
    }


# ── Relation maps & context helpers ──────────────────────────────────────────

def _build_relation_maps(relations: list[dict]) -> tuple[dict, dict, dict]:
    """Build parents_of, children_of, spouses_of from a list of relation dicts."""
    parents_of:  dict[int, list[int]] = {}
    children_of: dict[int, list[int]] = {}
    spouses_of:  dict[int, list[int]] = {}

    for rel in relations:
        a = rel['person_a_id']
        b = rel['person_b_id']
        rtype = rel.get('type', '')
        if rtype == 'parent':
            parents_of.setdefault(b, []).append(a)
            children_of.setdefault(a, []).append(b)
        elif rtype == 'spouse':
            spouses_of.setdefault(a, []).append(b)
            spouses_of.setdefault(b, []).append(a)

    return parents_of, children_of, spouses_of


def _context_score(
    inc_id: int,
    ex_id:  int,
    remap:  dict[int, int],
    inc_par: dict, inc_chi: dict, inc_spo: dict,
    ex_par:  dict, ex_chi:  dict, ex_spo:  dict,
) -> int:
    """
    Score context alignment for a proposed match (inc_id → ex_id).
    +2 per confirmed parent, +3 per confirmed spouse, +1 per confirmed child.
    Mirrored negative values for each conflict. 0 = no verifiable context.
    """
    score = 0
    for inc_parent in inc_par.get(inc_id, []):
        ex_cand = remap.get(inc_parent)
        if ex_cand is not None:
            score += 2 if ex_cand in ex_par.get(ex_id, []) else -2
    for inc_spouse in inc_spo.get(inc_id, []):
        ex_cand = remap.get(inc_spouse)
        if ex_cand is not None:
            score += 3 if ex_cand in ex_spo.get(ex_id, []) else -3
    for inc_child in inc_chi.get(inc_id, []):
        ex_cand = remap.get(inc_child)
        if ex_cand is not None:
            score += 1 if ex_cand in ex_chi.get(ex_id, []) else -1
    return score


def _family_labels(
    person_id:    int,
    parents_of:   dict,
    spouses_of:   dict,
    persons_by_id: dict,
) -> list[dict]:
    """Return [{role, name, birth_year}] for parents and spouses of person_id."""
    result: list[dict] = []
    for pid in parents_of.get(person_id, []):
        p = persons_by_id.get(pid)
        if p:
            nm = ' '.join(x for x in [p.get('first_name'), p.get('last_name')] if x) or p.get('name') or '?'
            result.append({'role': 'parent', 'name': nm, 'birth_year': p.get('birth_year')})
    for pid in spouses_of.get(person_id, []):
        p = persons_by_id.get(pid)
        if p:
            nm = ' '.join(x for x in [p.get('first_name'), p.get('last_name')] if x) or p.get('name') or '?'
            result.append({'role': 'spouse', 'name': nm, 'birth_year': p.get('birth_year')})
    return result


def _name_year_ok(inc_norms: set, inc_year: Optional[int], candidate: dict) -> bool:
    """True if candidate name intersects inc_norms and birth years are compatible."""
    ex_norms = _name_norms(
        candidate.get('first_name'), candidate.get('last_name'), candidate.get('name')
    )
    if not ex_norms or not inc_norms.intersection(ex_norms):
        return False
    ex_year = candidate.get('birth_year')
    if inc_year and ex_year and abs(inc_year - ex_year) > 5:
        return False
    return True


def _extract_orig_filename(zip_path: str) -> str:
    """Extract original filename from ZIP path like 'images/42_photo.jpg' → 'photo.jpg'."""
    name = Path(zip_path).name          # "42_photo.jpg"
    underscore = name.find('_')
    return name[underscore + 1:] if underscore > 0 else name


# ── Match heuristic ───────────────────────────────────────────────────────────

def _suggest_match(incoming: dict, existing: list[dict]) -> Optional[dict]:
    """Scoring same as gedcom_import._suggest_match, works on plain dicts."""
    inc_norms = _name_norms(incoming.get('first_name'), incoming.get('last_name'), incoming.get('name'))
    inc_year  = incoming.get('birth_year')
    if not inc_norms:
        return None

    best_score = 0
    best: Optional[dict] = None

    for person in existing:
        ex_norms = _name_norms(person.get('first_name'), person.get('last_name'), person.get('name'))
        if not ex_norms or not inc_norms.intersection(ex_norms):
            continue
        ex_year = person.get('birth_year')
        if inc_year and ex_year:
            if inc_year == ex_year:
                score = 100
            elif abs(inc_year - ex_year) <= 2:
                score = 80
            else:
                score = 30
        elif inc_year is None and ex_year is None:
            score = 70
        else:
            score = 55

        inc_bp = (incoming.get('birth_place') or '').strip().lower()
        ex_bp  = (person.get('birth_place') or '').strip().lower()
        if inc_bp and ex_bp and inc_bp == ex_bp:
            score += 15

        inc_dy = incoming.get('death_year')
        ex_dy  = person.get('death_year')
        if inc_dy and ex_dy:
            if inc_dy == ex_dy:
                score += 10
            elif abs(inc_dy - ex_dy) <= 2:
                score += 5

        inc_dp = (incoming.get('death_place') or '').strip().lower()
        ex_dp  = (person.get('death_place') or '').strip().lower()
        if inc_dp and ex_dp and inc_dp == ex_dp:
            score += 5

        if score > best_score:
            best_score = score
            best = person

    if not best or best_score < 30:
        return None

    conf = 'exact' if best_score >= 100 else 'high' if best_score >= 55 else 'low'
    return {
        'id':           best['id'],
        'name':         best.get('name') or '',
        'first_name':   best.get('first_name'),
        'last_name':    best.get('last_name'),
        'birth_year':   best.get('birth_year'),
        'confidence':   conf,
        'match_source': 'name',
    }


# ── Preview builder ───────────────────────────────────────────────────────────

def build_merge_preview(
    incoming_data:      dict,
    existing_persons:   list[dict],
    existing_relations: list[dict],
) -> list[dict]:
    """
    Return a per-person preview with three-pass context-aware matching.

    Each row includes:
      context_status  — 'confirmed' | 'conflict' | 'none'
      incoming_family — [{role, name, birth_year}] for parents + spouses
    """
    existing_by_id    = {p['id']: p for p in existing_persons}
    inc_persons_by_id = {p['id']: p for p in incoming_data['persons']}

    inc_par, inc_chi, inc_spo = _build_relation_maps(incoming_data['relations'])
    ex_par,  ex_chi,  ex_spo  = _build_relation_maps(existing_relations)

    # ── Pass 1: Name + birth_year matching ───────────────────────────────────
    initial_matches: dict[int, Optional[dict]] = {
        p['id']: _suggest_match(p, existing_persons)
        for p in incoming_data['persons']
    }

    # Claim exact matches before high-confidence ones to prevent theft.
    tentative_remap: dict[int, int] = {}
    claimed_ex_ids:  set[int]       = set()

    for target_conf in ('exact', 'high'):
        for p in incoming_data['persons']:
            m = initial_matches[p['id']]
            if m and m['confidence'] == target_conf and m['id'] not in claimed_ex_ids:
                tentative_remap[p['id']] = m['id']
                claimed_ex_ids.add(m['id'])

    # ── Pass 2: Context validation ────────────────────────────────────────────
    context_notes: dict[int, str] = {}

    for inc_id, ex_id in list(tentative_remap.items()):
        cs = _context_score(
            inc_id, ex_id, tentative_remap,
            inc_par, inc_chi, inc_spo,
            ex_par,  ex_chi,  ex_spo,
        )
        if cs > 0:
            context_notes[inc_id] = 'confirmed'
        elif cs < 0:
            context_notes[inc_id] = 'conflict'
            # Downgrade to 'low': this person will appear in the Uncertain section.
            del tentative_remap[inc_id]
            claimed_ex_ids.discard(ex_id)
            m = initial_matches[inc_id]
            if m:
                initial_matches[inc_id] = {**m, 'confidence': 'low', 'context_conflict': True}

    # ── Pass 3: Relationship-guided discovery for unmatched persons ───────────
    for p in incoming_data['persons']:
        inc_id = p['id']
        if inc_id in tentative_remap:
            continue

        inc_norms = _name_norms(p.get('first_name'), p.get('last_name'), p.get('name'))
        if not inc_norms:
            continue

        inc_year     = p.get('birth_year')
        found_ex_id: Optional[int] = None

        # Via parent's children list in existing tree
        for parent_inc_id in inc_par.get(inc_id, []):
            parent_ex_id = tentative_remap.get(parent_inc_id)
            if parent_ex_id is None:
                continue
            for child_ex_id in ex_chi.get(parent_ex_id, []):
                if child_ex_id in claimed_ex_ids:
                    continue
                child_ex = existing_by_id.get(child_ex_id)
                if child_ex and _name_year_ok(inc_norms, inc_year, child_ex):
                    found_ex_id = child_ex_id
                    break
            if found_ex_id:
                break

        # Via spouse's spouse list in existing tree
        if found_ex_id is None:
            for spouse_inc_id in inc_spo.get(inc_id, []):
                spouse_ex_id = tentative_remap.get(spouse_inc_id)
                if spouse_ex_id is None:
                    continue
                for s2_ex_id in ex_spo.get(spouse_ex_id, []):
                    if s2_ex_id in claimed_ex_ids:
                        continue
                    s2_ex = existing_by_id.get(s2_ex_id)
                    if s2_ex and _name_year_ok(inc_norms, inc_year, s2_ex):
                        found_ex_id = s2_ex_id
                        break
                if found_ex_id:
                    break

        # Via child's parents list in existing tree
        if found_ex_id is None:
            for child_inc_id in inc_chi.get(inc_id, []):
                child_ex_id = tentative_remap.get(child_inc_id)
                if child_ex_id is None:
                    continue
                for parent_ex_id in ex_par.get(child_ex_id, []):
                    if parent_ex_id in claimed_ex_ids:
                        continue
                    parent_ex = existing_by_id.get(parent_ex_id)
                    if parent_ex and _name_year_ok(inc_norms, inc_year, parent_ex):
                        found_ex_id = parent_ex_id
                        break
                if found_ex_id:
                    break

        if found_ex_id is not None:
            found_ex = existing_by_id[found_ex_id]
            tentative_remap[inc_id] = found_ex_id
            claimed_ex_ids.add(found_ex_id)
            initial_matches[inc_id] = {
                'id':           found_ex_id,
                'name':         found_ex.get('name') or '',
                'first_name':   found_ex.get('first_name'),
                'last_name':    found_ex.get('last_name'),
                'birth_year':   found_ex.get('birth_year'),
                'confidence':   'high',
                'match_source': 'family',
            }
            context_notes[inc_id] = 'confirmed'

    # ── Build final rows ──────────────────────────────────────────────────────
    rows = []
    for p in incoming_data['persons']:
        inc_id = p['id']
        match  = initial_matches.get(inc_id)
        ctx    = context_notes.get(inc_id, 'none')

        if match and match['confidence'] in ('exact', 'high'):
            default_action   = 'merge'
            default_merge_id = match['id']
            ex = existing_by_id.get(match['id'], {})
            new_fields = {
                f: p[f]
                for f in _MERGE_FIELDS
                if ex.get(f) is None and p.get(f) is not None
            }
        else:
            default_action   = 'create'
            default_merge_id = None
            new_fields       = {}

        rows.append({
            'incoming_id':     inc_id,
            'name':            p.get('name'),
            'first_name':      p.get('first_name'),
            'last_name':       p.get('last_name'),
            'birth_year':      p.get('birth_year'),
            'death_year':      p.get('death_year'),
            'sex':             p.get('sex'),
            'occupation':      p.get('occupation'),
            'birth_place':     p.get('birth_place'),
            'suggested_match': match,
            'action':          default_action,
            'merge_with_id':   default_merge_id,
            'new_fields':      new_fields,
            'context_status':  ctx,
            'incoming_family': _family_labels(inc_id, inc_par, inc_spo, inc_persons_by_id),
        })

    _order = {'exact': 0, 'high': 1, 'low': 3}
    rows.sort(key=lambda r: _order.get(
        (r['suggested_match'] or {}).get('confidence', ''),
        2 if not r['suggested_match'] else 3,
    ))
    return rows


# ── Execute merge ─────────────────────────────────────────────────────────────

def execute_merge(
    incoming_data: dict,
    decisions:     list[dict],
    db_path:       Path,
    docs_dir:      Path,
    zip_data:      bytes,
    options:       dict,
) -> tuple[dict, dict]:
    """
    Apply merge decisions in a single connection.
    Returns (stats, rollback_data).
    options: {include_documents, include_events, merge_strategy: 'fill_missing'|'incoming_priority'}
    """
    include_docs    = options.get('include_documents', True)
    include_events  = options.get('include_events', True)
    include_sources = options.get('include_sources', True)
    strategy        = options.get('merge_strategy', 'fill_missing')

    dec_map: dict[int, dict] = {d['incoming_id']: d for d in decisions}

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")

    stats = {
        'persons_created': 0, 'persons_merged':  0, 'persons_skipped': 0,
        'relations_added': 0, 'events_added':    0, 'documents_added': 0,
        'images_imported': 0, 'clusters_linked': 0, 'sources_added':   0,
    }
    rollback: dict = {
        'created_person_ids': [], 'added_relation_ids': [],
        'added_note_ids':     [], 'added_event_ids':    [],
        'added_documents':    [], 'merged_snapshots':   [],
        'added_source_ids':   [],
        'updated_thumbnails': [],   # [{person_id, old_thumbnail_face_id}]
        # image / cluster rollback
        'relinked_clusters':  [],   # [{id, old_person_id}]
        'added_cluster_ids':  [],
        'added_image_ids':    [],   # [{id, path}]
        'added_face_ids':     [],
    }

    # incoming_id → local DB id (None = skipped)
    id_remap: dict[int, Optional[int]] = {}

    # Cross-section remaps (populated by their respective sections)
    note_id_remap: dict[int, int]           = {}
    rel_id_remap:  dict[int, int]           = {}
    ev_id_remap:   dict[int, int]           = {}
    doc_id_remap:  dict[int, int]           = {}
    src_id_remap:  dict[int, int]           = {}
    img_id_remap:  dict[int, Optional[int]] = {}
    cl_id_remap:   dict[int, int]           = {}

    # ── 1. Persons ────────────────────────────────────────────────────────────
    for p in incoming_data['persons']:
        inc_id = p['id']
        dec    = dec_map.get(inc_id, {})
        action = dec.get('action', 'create')

        if action == 'skip':
            id_remap[inc_id] = None
            stats['persons_skipped'] += 1
            continue

        local_id: Optional[int] = None

        if action == 'merge' and dec.get('merge_with_id'):
            merge_id = dec['merge_with_id']
            ex = conn.execute("SELECT * FROM persons WHERE id = ?", (merge_id,)).fetchone()
            if ex:
                if strategy == 'fill_missing':
                    updates = {f: p.get(f) for f in _MERGE_FIELDS if ex[f] is None and p.get(f) is not None}
                else:
                    updates = {f: p.get(f) for f in _MERGE_FIELDS if p.get(f) is not None}
                if updates:
                    before = {f: ex[f] for f in updates}
                    rollback['merged_snapshots'].append({'id': merge_id, 'before': before})
                    set_clause = ', '.join(f"{k} = ?" for k in updates)
                    conn.execute(f"UPDATE persons SET {set_clause} WHERE id = ?", [*updates.values(), merge_id])
                    conn.commit()
                local_id = merge_id
                id_remap[inc_id] = merge_id
                stats['persons_merged'] += 1

        if local_id is None:
            name = ' '.join(x for x in [p.get('first_name'), p.get('last_name')] if x) or p.get('name') or 'Unknown'
            cur = conn.execute(
                "INSERT INTO persons "
                "(name, title, first_name, last_name, middle_name, nickname, sex, occupation, "
                " birth_date, birth_year, birth_place, "
                " christening_date, christening_year, christening_place, "
                " death_date, death_year, death_place, "
                " burial_date, burial_year, burial_place) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    name, p.get('title'), p.get('first_name'), p.get('last_name'),
                    p.get('middle_name'), p.get('nickname'), p.get('sex'), p.get('occupation'),
                    p.get('birth_date'), p.get('birth_year'), p.get('birth_place'),
                    p.get('christening_date'), p.get('christening_year'), p.get('christening_place'),
                    p.get('death_date'), p.get('death_year'), p.get('death_place'),
                    p.get('burial_date'), p.get('burial_year'), p.get('burial_place'),
                ),
            )
            conn.commit()
            local_id = cur.lastrowid
            id_remap[inc_id] = local_id
            rollback['created_person_ids'].append(local_id)
            stats['persons_created'] += 1

    # ── 2. Relations ──────────────────────────────────────────────────────────
    for rel in incoming_data['relations']:
        a = id_remap.get(rel['person_a_id'])
        b = id_remap.get(rel['person_b_id'])
        if a is None or b is None:
            continue

        rtype = rel.get('type', 'parent')
        if rtype == 'spouse':
            dup = conn.execute(
                "SELECT id FROM relations WHERE type='spouse' AND "
                "((person_a_id=? AND person_b_id=?) OR (person_a_id=? AND person_b_id=?))",
                (a, b, b, a),
            ).fetchone()
        else:
            dup = conn.execute(
                "SELECT id FROM relations WHERE type=? AND person_a_id=? AND person_b_id=?",
                (rtype, a, b),
            ).fetchone()
        if dup:
            rel_id_remap[rel['id']] = dup[0]
            continue

        if rtype == 'parent':
            if conn.execute("SELECT COUNT(*) FROM relations WHERE type='parent' AND person_b_id=?", (b,)).fetchone()[0] >= 2:
                continue
            if _would_create_cycle(a, b, conn):
                continue

        cur = conn.execute(
            "INSERT INTO relations (type, person_a_id, person_b_id, marriage_year, marriage_place, divorce_year, divorce_place) "
            "VALUES (?,?,?,?,?,?,?)",
            (rtype, a, b, rel.get('marriage_year'), rel.get('marriage_place'),
             rel.get('divorce_year'), rel.get('divorce_place')),
        )
        conn.commit()
        rel_id_remap[rel['id']] = cur.lastrowid
        rollback['added_relation_ids'].append(cur.lastrowid)
        stats['relations_added'] += 1

    # ── 3. Person notes ───────────────────────────────────────────────────────
    for note in incoming_data.get('person_notes', []):
        local_pid = id_remap.get(note['person_id'])
        if local_pid is None:
            continue
        content = note.get('content') or ''
        title   = note.get('title') or ''
        # Skip if identical content already exists for this person.
        dup = conn.execute(
            "SELECT id FROM person_notes WHERE person_id = ? AND content = ?",
            (local_pid, content),
        ).fetchone()
        if dup:
            note_id_remap[note['id']] = dup[0]
            continue
        cur = conn.execute(
            "INSERT INTO person_notes (person_id, title, content, sort_order, created_at, updated_at) "
            "VALUES (?,?,?,?,datetime('now'),datetime('now'))",
            (local_pid, title, content, note.get('sort_order') or 0),
        )
        conn.commit()
        note_id_remap[note['id']] = cur.lastrowid
        rollback['added_note_ids'].append(cur.lastrowid)

    # ── 4. Events ─────────────────────────────────────────────────────────────
    if include_events:
        ep_by_event: dict[int, list[dict]] = {}
        for ep in incoming_data['event_persons']:
            ep_by_event.setdefault(ep['event_id'], []).append(ep)

        for ev in incoming_data['events']:
            ev_eps = ep_by_event.get(ev['id'], [])
            local_participants = [
                (id_remap[ep['person_id']], ep.get('role') or 'participant')
                for ep in ev_eps
                if ep['person_id'] in id_remap and id_remap[ep['person_id']] is not None
            ]
            if not local_participants:
                continue

            ev_title  = ev.get('title')
            ev_date   = ev.get('date')
            first_pid = local_participants[0][0]
            dup = conn.execute(
                "SELECT ep.id FROM event_persons ep JOIN events e ON e.id = ep.event_id "
                "WHERE ep.person_id=? "
                "AND (e.title=? OR (e.title IS NULL AND ? IS NULL)) "
                "AND (e.date=? OR (e.date IS NULL AND ? IS NULL))",
                (first_pid, ev_title, ev_title, ev_date, ev_date),
            ).fetchone()
            if dup:
                continue

            cur = conn.execute(
                "INSERT INTO events (event_type, title, date, year, place, description, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))",
                (ev.get('event_type', 'custom'), ev_title, ev_date,
                 ev.get('year'), ev.get('place'), ev.get('description')),
            )
            new_ev_id = cur.lastrowid
            ev_id_remap[ev['id']] = new_ev_id
            for pid, role in local_participants:
                conn.execute(
                    "INSERT OR IGNORE INTO event_persons (event_id, person_id, role) VALUES (?,?,?)",
                    (new_ev_id, pid, role),
                )
            conn.commit()

            all_merged = all(
                dec_map.get(ep['person_id'], {}).get('action') == 'merge'
                for ep in ev_eps
                if ep['person_id'] in id_remap and id_remap[ep['person_id']] is not None
            )
            if all_merged:
                rollback['added_event_ids'].append(new_ev_id)
            stats['events_added'] += 1

    # ── 5. Documents ──────────────────────────────────────────────────────────
    if include_docs:
        docs_dir.mkdir(parents=True, exist_ok=True)
        doc_id_remap = {}
        try:
            with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
                zip_names = set(zf.namelist())
                for doc in incoming_data['documents']:
                    # A document with no owner belongs to the project, not to a
                    # person, so it has no decision to follow and comes across
                    # on its own. One with an owner we did not import does not.
                    unowned = doc['person_id'] is None
                    local_pid = None if unowned else id_remap.get(doc['person_id'])
                    if local_pid is None and not unowned:
                        continue
                    arc = f"documents/{doc['stored_name']}"
                    if arc not in zip_names:
                        continue
                    ext = Path(doc['stored_name']).suffix
                    new_stored = f"{uuid.uuid4().hex}{ext}"
                    (docs_dir / new_stored).write_bytes(zf.read(arc))

                    mime = doc.get('mime_type') or mimetypes.guess_type(doc.get('filename') or '')[0] or 'application/octet-stream'
                    # Without is_text an imported chronicle would arrive as an
                    # opaque file: no Markdown rendering, no text editor.
                    cur = conn.execute(
                        "INSERT INTO documents "
                        "(person_id, stored_name, filename, mime_type, title, doc_type, year, description, is_text, created_at) "
                        "VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))",
                        (local_pid, new_stored, doc.get('filename'), mime,
                         doc.get('title'), doc.get('doc_type'), doc.get('year'), doc.get('description'),
                         1 if doc.get('is_text') else 0),
                    )
                    new_doc_id = cur.lastrowid
                    doc_id_remap[doc['id']] = new_doc_id
                    conn.commit()
                    # Documents of newly created persons go away with the person;
                    # these two cases have to name themselves for an undo.
                    if unowned or dec_map.get(doc['person_id'], {}).get('action') == 'merge':
                        rollback['added_documents'].append({'id': new_doc_id, 'stored_name': new_stored})
                    stats['documents_added'] += 1

                # Extra files beyond each document's primary one (v10+) — every
                # page of a scanned letter uploaded together in one go.
                for df in incoming_data.get('document_files', []):
                    new_doc_id = doc_id_remap.get(df['document_id'])
                    if new_doc_id is None:
                        continue
                    arc = f"documents/{df['stored_name']}"
                    if arc not in zip_names:
                        continue
                    f_ext = Path(df['stored_name']).suffix
                    f_new_stored = f"{uuid.uuid4().hex}{f_ext}"
                    (docs_dir / f_new_stored).write_bytes(zf.read(arc))
                    f_mime = df.get('mime_type') or mimetypes.guess_type(df.get('filename') or '')[0] or 'application/octet-stream'
                    conn.execute(
                        "INSERT INTO document_files (document_id, stored_name, filename, mime_type, sort_order) "
                        "VALUES (?,?,?,?,?)",
                        (new_doc_id, f_new_stored, df.get('filename'), f_mime, df.get('sort_order') or 0),
                    )
                conn.commit()

            # Re-link additional persons via document_persons junction table.
            for dp in incoming_data.get('document_persons', []):
                new_doc_id = doc_id_remap.get(dp['document_id'])
                new_pid    = id_remap.get(dp['person_id'])
                if new_doc_id is None or new_pid is None:
                    continue
                conn.execute(
                    "INSERT OR IGNORE INTO document_persons (document_id, person_id, role) VALUES (?,?,?)",
                    (new_doc_id, new_pid, dp.get('role')),
                )
            conn.commit()

        except zipfile.BadZipFile:
            pass

    # ── 6. Images + Faces + Clusters ─────────────────────────────────────────
    if options.get('include_images', True) and incoming_data.get('clusters'):
        imported_dir = db_path.parent / "imported" / "images"
        imported_dir.mkdir(parents=True, exist_ok=True)

        # Build set of local image mtimes for O(1) dedup.
        local_mtimes: dict[float, int] = {
            row[0]: row[1]
            for row in conn.execute("SELECT mtime, id FROM images").fetchall()
            if row[0] is not None
        }

        # Reset maps for this section (img_id_remap / cl_id_remap declared at top)
        img_id_remap = {}
        cl_id_remap  = {}

        incoming_faces    = incoming_data.get('faces', [])
        incoming_images   = incoming_data.get('images', [])
        incoming_images_by_id = {img['id']: img for img in incoming_images}

        try:
            with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
                zip_names = set(zf.namelist())

                # ── 6a. Clusters ──────────────────────────────────────────────
                max_label_row = conn.execute("SELECT MAX(label) FROM clusters").fetchone()
                next_label = max(int(max_label_row[0] or -1) + 1, 0)

                for cl in incoming_data['clusters']:
                    local_pid = id_remap.get(cl['person_id'])
                    if local_pid is None:
                        continue

                    # Sample up to 15 faces to find the matching local cluster.
                    cl_faces = [f for f in incoming_faces if f['cluster_id'] == cl['id']][:15]
                    candidate_cl_ids: list[int] = []

                    for face in cl_faces:
                        inc_img = incoming_images_by_id.get(face['image_id'])
                        if not inc_img:
                            continue
                        local_img_id = local_mtimes.get(inc_img['mtime'])
                        if local_img_id is None:
                            continue
                        row = conn.execute(
                            "SELECT cluster_id FROM faces WHERE image_id = ? AND bbox_json = ?",
                            (local_img_id, face['bbox_json']),
                        ).fetchone()
                        if row and row[0] is not None:
                            candidate_cl_ids.append(row[0])

                    if candidate_cl_ids:
                        # Most common cluster among matched local faces.
                        best_cl_id = max(set(candidate_cl_ids), key=candidate_cl_ids.count)
                        old_pid_row = conn.execute(
                            "SELECT person_id FROM clusters WHERE id = ?", (best_cl_id,)
                        ).fetchone()
                        old_pid = old_pid_row[0] if old_pid_row else None
                        conn.execute(
                            "UPDATE clusters SET person_id = ? WHERE id = ?",
                            (local_pid, best_cl_id),
                        )
                        conn.commit()
                        if old_pid != local_pid:
                            rollback['relinked_clusters'].append({'id': best_cl_id, 'old_person_id': old_pid})
                    else:
                        # No matching local cluster — create a new named one.
                        cur = conn.execute(
                            "INSERT INTO clusters (label, person_id) VALUES (?, ?)",
                            (next_label, local_pid),
                        )
                        conn.commit()
                        best_cl_id = cur.lastrowid
                        next_label += 1
                        rollback['added_cluster_ids'].append(best_cl_id)

                    cl_id_remap[cl['id']] = best_cl_id
                    stats['clusters_linked'] += 1

                # ── 6b. Images ────────────────────────────────────────────────
                imported_cl_face_image_ids = {
                    f['image_id'] for f in incoming_faces
                    if f['cluster_id'] in cl_id_remap
                }

                for img in incoming_images:
                    if img['id'] not in imported_cl_face_image_ids:
                        img_id_remap[img['id']] = None
                        continue

                    # Dedup by mtime.
                    existing_id = local_mtimes.get(img['mtime'])
                    if existing_id is not None:
                        img_id_remap[img['id']] = existing_id
                        continue

                    # Copy image file from ZIP.
                    zip_path = img['path']   # e.g. "images/42_photo.jpg"
                    if zip_path not in zip_names:
                        img_id_remap[img['id']] = None
                        continue

                    orig_fn     = _extract_orig_filename(zip_path)
                    new_name    = f"{uuid.uuid4().hex}_{orig_fn}"
                    new_abs     = str(imported_dir / new_name)
                    (imported_dir / new_name).write_bytes(zf.read(zip_path))
                    # Preserve original mtime so the scanner won't treat the file
                    # as changed and delete our imported faces on next scan.
                    if img['mtime']:
                        os.utime(new_abs, (img['mtime'], img['mtime']))

                    cur = conn.execute(
                        "INSERT INTO images (path, mtime, exif_date, scan_status, meta_json) "
                        "VALUES (?,?,?,?,?)",
                        (new_abs, img['mtime'], img.get('exif_date'),
                         img.get('scan_status') or 'done', img.get('meta_json')),
                    )
                    conn.commit()
                    new_img_id = cur.lastrowid
                    img_id_remap[img['id']] = new_img_id
                    local_mtimes[img['mtime']] = new_img_id   # update cache
                    rollback['added_image_ids'].append({'id': new_img_id, 'path': new_abs})
                    stats['images_imported'] += 1

                # ── 6c. Faces ─────────────────────────────────────────────────
                for face in incoming_faces:
                    local_cl_id = cl_id_remap.get(face['cluster_id'])
                    if local_cl_id is None:
                        continue

                    local_img_id = img_id_remap.get(face['image_id'])
                    if local_img_id is None:
                        continue

                    # Skip if face already exists (existing image → face already in DB).
                    dup = conn.execute(
                        "SELECT id FROM faces WHERE image_id = ? AND bbox_json = ?",
                        (local_img_id, face['bbox_json']),
                    ).fetchone()
                    if dup:
                        # Ensure it's assigned to the correct cluster.
                        conn.execute(
                            "UPDATE faces SET cluster_id = ?, manually_assigned = 1 WHERE id = ? AND cluster_id != ?",
                            (local_cl_id, dup[0], local_cl_id),
                        )
                        conn.commit()
                        continue

                    # New face on a newly imported image.
                    cur = conn.execute(
                        "INSERT INTO faces "
                        "(image_id, bbox_json, embedding, det_score, cluster_id, manually_assigned) "
                        "VALUES (?,?,?,?,?,1)",
                        (local_img_id, face['bbox_json'], face.get('embedding'),
                         face.get('det_score') or 0.0, local_cl_id),
                    )
                    conn.commit()
                    rollback['added_face_ids'].append(cur.lastrowid)

        except zipfile.BadZipFile:
            pass

    # ── 7. Sources + Citations ────────────────────────────────────────────────
    if include_sources:
        for src in incoming_data.get('sources', []):
            dup = conn.execute(
                "SELECT id FROM sources WHERE title IS ? AND author IS ? AND year IS ?",
                (src.get('title'), src.get('author'), src.get('year')),
            ).fetchone()
            if dup:
                src_id_remap[src['id']] = dup[0]
                continue
            local_doc_id = doc_id_remap.get(src['document_id']) if src.get('document_id') else None
            local_ev_id  = ev_id_remap.get(src['event_id'])    if src.get('event_id')    else None
            cur = conn.execute(
                "INSERT INTO sources "
                "(title, source_type, author, year, publisher, location, url, description, document_id, event_id, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))",
                (src.get('title'), src.get('source_type'), src.get('author'), src.get('year'),
                 src.get('publisher'), src.get('location'), src.get('url'), src.get('description'),
                 local_doc_id, local_ev_id),
            )
            conn.commit()
            new_src_id = cur.lastrowid
            src_id_remap[src['id']] = new_src_id
            rollback['added_source_ids'].append(new_src_id)
            stats['sources_added'] += 1

        for cit in incoming_data.get('citations', []):
            local_pid    = id_remap.get(cit['person_id'])
            local_src_id = src_id_remap.get(cit['source_id'])
            if local_pid is None or local_src_id is None:
                continue
            # A marriage citation names a relation by id. The incoming ids mean
            # nothing here, so it comes across only if its marriage did — an
            # unremapped id would point at somebody else's marriage.
            local_rel_id = None
            if cit.get('relation_id') is not None:
                local_rel_id = rel_id_remap.get(cit['relation_id'])
                if local_rel_id is None:
                    continue
            dup = conn.execute(
                "SELECT id FROM citations WHERE person_id = ? AND source_id = ? AND fact IS ? "
                "AND relation_id IS ?",
                (local_pid, local_src_id, cit.get('fact'), local_rel_id),
            ).fetchone()
            if dup:
                continue
            conn.execute(
                "INSERT INTO citations (source_id, person_id, fact, detail, notes, relation_id) "
                "VALUES (?,?,?,?,?,?)",
                (local_src_id, local_pid, cit.get('fact'), cit.get('detail'), cit.get('notes'),
                 local_rel_id),
            )
        conn.commit()

        for nc in incoming_data.get('note_citations', []):
            local_note_id = note_id_remap.get(nc['note_id'])
            if local_note_id is None:
                continue
            # source_id is NULL for free-text citations — those have no source
            # to remap, but the label still has to come across.
            local_src_id = src_id_remap.get(nc['source_id']) if nc.get('source_id') else None
            if nc.get('source_id') and local_src_id is None:
                continue
            dup = conn.execute(
                "SELECT id FROM note_citations WHERE note_id = ? AND source_id IS ? AND marker IS ?",
                (local_note_id, local_src_id, nc.get('marker')),
            ).fetchone()
            if dup:
                continue
            conn.execute(
                "INSERT INTO note_citations (note_id, source_id, marker, detail, custom_label) VALUES (?,?,?,?,?)",
                (local_note_id, local_src_id, nc.get('marker'), nc.get('detail'), nc.get('custom_label')),
            )
        conn.commit()

        # Body references of text documents — same shape, keyed to the document.
        for dc in incoming_data.get('document_citations', []):
            local_doc_id = doc_id_remap.get(dc['document_id'])
            if local_doc_id is None:
                continue
            local_src_id = src_id_remap.get(dc['source_id']) if dc.get('source_id') else None
            if dc.get('source_id') and local_src_id is None:
                continue
            dup = conn.execute(
                "SELECT id FROM document_citations WHERE document_id = ? AND marker IS ?",
                (local_doc_id, dc.get('marker')),
            ).fetchone()
            if dup:
                continue
            conn.execute(
                "INSERT INTO document_citations (document_id, source_id, marker, detail, custom_label) "
                "VALUES (?,?,?,?,?)",
                (local_doc_id, local_src_id, dc.get('marker'), dc.get('detail'), dc.get('custom_label')),
            )
        conn.commit()

        # References inside a document's description field — same shape again.
        for ddc in incoming_data.get('document_description_citations', []):
            local_doc_id = doc_id_remap.get(ddc['document_id'])
            if local_doc_id is None:
                continue
            local_src_id = src_id_remap.get(ddc['source_id']) if ddc.get('source_id') else None
            if ddc.get('source_id') and local_src_id is None:
                continue
            dup = conn.execute(
                "SELECT id FROM document_description_citations WHERE document_id = ? AND marker IS ?",
                (local_doc_id, ddc.get('marker')),
            ).fetchone()
            if dup:
                continue
            conn.execute(
                "INSERT INTO document_description_citations (document_id, source_id, marker, detail, custom_label) "
                "VALUES (?,?,?,?,?)",
                (local_doc_id, local_src_id, ddc.get('marker'), ddc.get('detail'), ddc.get('custom_label')),
            )
        conn.commit()

    # ── 8. Event images ───────────────────────────────────────────────────────
    if ev_id_remap and img_id_remap:
        for ei in incoming_data.get('event_images', []):
            local_ev_id  = ev_id_remap.get(ei['event_id'])
            local_img_id = img_id_remap.get(ei['image_id'])
            if local_ev_id is None or local_img_id is None:
                continue
            conn.execute(
                "INSERT OR IGNORE INTO event_images (event_id, image_id) VALUES (?,?)",
                (local_ev_id, local_img_id),
            )
        conn.commit()

    # Photos attached to text documents. Only images that actually came across
    # can be linked — a merge import brings in faces of named clusters, so a
    # photo nobody is tagged in stays behind and its link is simply skipped.
    if doc_id_remap and img_id_remap:
        for di in incoming_data.get('document_images', []):
            local_doc_id = doc_id_remap.get(di['document_id'])
            local_img_id = img_id_remap.get(di['image_id'])
            if local_doc_id is None or local_img_id is None:
                continue
            conn.execute(
                "INSERT OR IGNORE INTO document_images (document_id, image_id, sort_order, caption) "
                "VALUES (?,?,?,?)",
                (local_doc_id, local_img_id, di.get('sort_order') or 0, di.get('caption')),
            )
        conn.commit()

    # ── 9. Auto-set thumbnail for persons without one ─────────────────────────
    for inc_cl_id, local_cl_id in cl_id_remap.items():
        cl_row = conn.execute(
            "SELECT person_id FROM clusters WHERE id = ?", (local_cl_id,)
        ).fetchone()
        if not cl_row or cl_row[0] is None:
            continue
        local_pid = cl_row[0]
        thumb_row = conn.execute(
            "SELECT thumbnail_face_id FROM persons WHERE id = ?", (local_pid,)
        ).fetchone()
        if not thumb_row or thumb_row[0] is not None:
            continue
        # Pick the highest-quality face from this cluster.
        face_row = conn.execute(
            "SELECT id FROM faces WHERE cluster_id = ? ORDER BY det_score DESC LIMIT 1",
            (local_cl_id,),
        ).fetchone()
        if face_row:
            rollback['updated_thumbnails'].append({
                'person_id': local_pid, 'old_thumbnail_face_id': None,
            })
            conn.execute(
                "UPDATE persons SET thumbnail_face_id = ? WHERE id = ?",
                (face_row[0], local_pid),
            )
    conn.commit()

    conn.close()
    return stats, rollback

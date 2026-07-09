"""
GEDCOM 5.5.1 export.

Produces a ZIP containing:
  family.ged           – the GEDCOM file (UTF-8, CRLF line endings)
  media/photo_<id>.jpg – primary face photo per person (thumbnail)
  media/doc_<id>_<name> – attached documents per person
"""

from __future__ import annotations

import io
import re
import sqlite3
import zipfile
from datetime import date
from pathlib import Path
from typing import Optional

# ── Helpers ───────────────────────────────────────────────────────────────────

_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
           'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']


def _gedcom_date(date_str: Optional[str], year: Optional[int]) -> Optional[str]:
    """Convert partial ISO date or plain year to a GEDCOM date string."""
    if date_str:
        parts = date_str.split('-')
        try:
            if len(parts) == 3:
                y, m, d_ = parts
                return f"{int(d_)} {_MONTHS[int(m) - 1]} {y}"
            if len(parts) == 2:
                y, m = parts
                return f"{_MONTHS[int(m) - 1]} {y}"
            if len(parts) == 1 and parts[0].isdigit():
                return parts[0]
        except (ValueError, IndexError):
            pass
    if year is not None:
        return str(year)
    return None


_MD_PATTERNS = [
    (re.compile(r'^#{1,6}\s+', re.M), ''),      # headings
    (re.compile(r'\*{1,3}'), ''),                # bold/italic stars
    (re.compile(r'_{1,3}'), ''),                 # bold/italic underscores
    (re.compile(r'~~'), ''),                     # strikethrough
    (re.compile(r'`([^`]*)`'), r'\1'),           # inline code
    (re.compile(r'@\[([^\]]+)\]\(#pid-\d+\)'), r'\1'),  # @[Name](#pid-ID) → Name
    (re.compile(r'\[([^\]]*)\]\([^)]*\)'), r'\1'),       # [text](url) → text
    (re.compile(r'^>\s*', re.M), ''),            # blockquote
    (re.compile(r'^[-*+]\s+', re.M), ''),        # list markers
    (re.compile(r'\[\d+\]'), ''),                # citation markers [n]
]


def _strip_markdown(text: str) -> str:
    for pat, repl in _MD_PATTERNS:
        text = pat.sub(repl, text)
    return text.strip()


def _safe(value: str, max_len: int = 248) -> str:
    """Trim to GEDCOM-safe length and strip newlines from a single-line value."""
    return value.replace('\r', ' ').replace('\n', ' ')[:max_len].strip()


def _emit_note(level: int, text: str, lines: list[str]) -> None:
    """Emit a NOTE record with CONT lines for multiline text."""
    paragraphs = [p.strip() for p in text.splitlines() if p.strip()]
    if not paragraphs:
        return
    lines.append(f"{level} NOTE {_safe(paragraphs[0])}")
    for para in paragraphs[1:]:
        lines.append(f"{level + 1} CONT {_safe(para)}")


# ── Family construction ────────────────────────────────────────────────────────

def _build_families(
    relations: list[sqlite3.Row],
    persons_by_id: dict[int, sqlite3.Row],
) -> list[dict]:
    """
    Convert flat relation rows into GEDCOM FAM dicts.

    Logic:
      1. Each spouse pair → one FAM (HUSB + WIFE).
      2. Each parent relation → child is added to the parent's existing FAM.
         If no FAM exists for that parent, a single-parent FAM is created.
    """
    families: list[dict] = []
    counter = 1

    # Map frozenset({husb_id, wife_id}) → fam dict for fast lookup
    parent_pair_to_fam: dict[frozenset, dict] = {}

    def new_fam(husb_id, wife_id, marr_year=None, marr_place=None,
                div_year=None, div_place=None) -> dict:
        nonlocal counter
        fam: dict = {
            'id': counter,
            'husb': husb_id,
            'wife': wife_id,
            'children': [],
            'marr_year': marr_year,
            'marr_place': marr_place,
            'div_year': div_year,
            'div_place': div_place,
        }
        counter += 1
        families.append(fam)
        return fam

    # Step 1: spouse pairs → FAM
    for rel in relations:
        if rel['type'] != 'spouse':
            continue
        pid_a, pid_b = rel['person_a_id'], rel['person_b_id']
        pa = persons_by_id.get(pid_a)
        pb = persons_by_id.get(pid_b)
        if pa is None or pb is None:
            continue
        # put male as HUSB, female as WIFE; default: a=husb
        if pa['sex'] == 'F' or pb['sex'] == 'M':
            husb_id, wife_id = pid_b, pid_a
        else:
            husb_id, wife_id = pid_a, pid_b
        fam = new_fam(husb_id, wife_id,
                      rel['marriage_year'], rel['marriage_place'],
                      rel['divorce_year'], rel['divorce_place'])
        parent_pair_to_fam[frozenset([husb_id, wife_id])] = fam

    # Step 2: assign children to families
    for rel in relations:
        if rel['type'] != 'parent':
            continue
        parent_id, child_id = rel['person_a_id'], rel['person_b_id']

        assigned = False
        for fam in families:
            if parent_id in (fam['husb'], fam['wife']):
                if child_id not in fam['children']:
                    fam['children'].append(child_id)
                assigned = True
                break

        if not assigned:
            # Single-parent or unknown other parent
            parent = persons_by_id.get(parent_id)
            if parent and parent['sex'] == 'F':
                fam = new_fam(None, parent_id)
            else:
                fam = new_fam(parent_id, None)
            fam['children'].append(child_id)

    return families


# ── Main builder ───────────────────────────────────────────────────────────────

def build_gedcom_zip(
    db_path: Path,
    docs_dir: Path,
    photo_mode: str = 'primary',   # 'none' | 'primary' | 'all'
    include_documents: bool = True,
    include_events: bool = True,
    include_sources: bool = True,
    include_notes: bool = True,
) -> io.BytesIO:
    """Return a BytesIO ZIP with family.ged + media/ files.

    photo_mode:
        'none'    – no photos exported
        'primary' – one thumbnail photo per person
        'all'     – every photo in which the person appears (cluster-based)
    """

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        persons       = conn.execute("SELECT * FROM persons").fetchall()
        relations     = conn.execute("SELECT * FROM relations").fetchall()
        documents     = conn.execute("SELECT * FROM documents").fetchall() if include_documents else []
        sources       = conn.execute("SELECT * FROM sources").fetchall() if include_sources else []
        notes         = conn.execute("SELECT * FROM person_notes").fetchall() if include_notes else []
        note_cites    = conn.execute("SELECT * FROM note_citations").fetchall() if include_notes else []
        events        = conn.execute("SELECT * FROM events").fetchall() if include_events else []
        event_persons = conn.execute("SELECT * FROM event_persons").fetchall() if include_events else []

        # person_id → list of (img_id, img_path)
        photos_by_person: dict[int, list[tuple[int, str]]] = {}

        if photo_mode == 'primary':
            rows = conn.execute("""
                SELECT p.id AS pid, i.id AS img_id, i.path AS img_path
                FROM persons p
                JOIN faces f ON f.id = p.thumbnail_face_id
                JOIN images i ON i.id = f.image_id
                WHERE p.thumbnail_face_id IS NOT NULL
            """).fetchall()
            for row in rows:
                photos_by_person[row['pid']] = [(row['img_id'], row['img_path'])]

        elif photo_mode == 'all':
            rows = conn.execute("""
                SELECT DISTINCT p.id AS pid, i.id AS img_id, i.path AS img_path
                FROM persons p
                JOIN clusters c ON c.person_id = p.id AND c.label != -1
                JOIN faces f ON f.cluster_id = c.id
                JOIN images i ON i.id = f.image_id
                ORDER BY p.id, i.id
            """).fetchall()
            for row in rows:
                photos_by_person.setdefault(row['pid'], []).append(
                    (row['img_id'], row['img_path'])
                )
    finally:
        conn.close()

    # ── Index structures ──────────────────────────────────────────────────────
    persons_by_id = {p['id']: p for p in persons}
    sources_by_id = {s['id']: s for s in sources}

    docs_by_person: dict[int, list] = {}
    for doc in documents:
        docs_by_person.setdefault(doc['person_id'], []).append(doc)

    notes_by_person: dict[int, list] = {}
    for note in notes:
        notes_by_person.setdefault(note['person_id'], []).append(note)

    cites_by_note: dict[int, list] = {}
    for nc in note_cites:
        cites_by_note.setdefault(nc['note_id'], []).append(nc)

    events_by_id = {ev['id']: ev for ev in events}
    events_for_person: dict[int, list] = {}
    for ep in event_persons:
        events_for_person.setdefault(ep['person_id'], []).append(ep['event_id'])

    # ── Build FAM records ─────────────────────────────────────────────────────
    families = _build_families(list(relations), persons_by_id)

    # person → FAMS / FAMC lists
    person_fams: dict[int, list[int]] = {}
    person_famc: dict[int, list[int]] = {}
    for fam in families:
        fid = fam['id']
        for pid in [fam['husb'], fam['wife']]:
            if pid:
                person_fams.setdefault(pid, []).append(fid)
        for cid in fam['children']:
            person_famc.setdefault(cid, []).append(fid)

    # ── Infer sex from FAM roles (HUSB → M, WIFE → F) ────────────────────────
    # Only fills in missing sex — never overrides an explicit value.
    inferred_sex: dict[int, str] = {p['id']: p['sex'] for p in persons if p['sex']}
    for fam in families:
        if fam['husb'] and fam['husb'] not in inferred_sex:
            inferred_sex[fam['husb']] = 'M'
        if fam['wife'] and fam['wife'] not in inferred_sex:
            inferred_sex[fam['wife']] = 'F'

    # ── Emit GEDCOM lines ─────────────────────────────────────────────────────
    lines: list[str] = []

    # HEAD
    today = date.today().strftime("%d %b %Y").upper()
    lines += [
        "0 HEAD",
        "1 GEDC",
        "2 VERS 5.5.1",
        "2 FORM LINEAGE-LINKED",
        "1 CHAR UTF-8",
        "1 SOUR Mnemosyne",
        "2 VERS 1.0",
        "2 NAME Mnemosyne Family Photo Organizer",
        f"1 DATE {today}",
    ]

    # ── INDI records ──────────────────────────────────────────────────────────
    for p in persons:
        pid = p['id']
        lines.append(f"0 @I{pid}@ INDI")

        # NAME
        given = ' '.join(filter(None, [p['first_name'], p['middle_name']])).strip()
        surn  = (p['last_name'] or '').strip()
        nick  = (p['nickname'] or '').strip()
        title = (p['title'] or '').strip()

        # GEDCOM /surname/ convention
        parts = []
        if given: parts.append(given)
        if surn:  parts.append(f"/{surn}/")
        display = ' '.join(parts) if parts else (p['name'] or 'Unknown')
        lines.append(f"1 NAME {_safe(display)}")
        if given:  lines.append(f"2 GIVN {_safe(given)}")
        if surn:   lines.append(f"2 SURN {_safe(surn)}")
        if nick:   lines.append(f"2 NICK {_safe(nick)}")
        if title:  lines.append(f"2 NPFX {_safe(title)}")

        # SEX — use explicit value, or infer from FAM roles
        sex = inferred_sex.get(pid) or p['sex']
        lines.append(f"1 SEX {'M' if sex == 'M' else 'F' if sex == 'F' else 'U'}")

        # Vital events helper
        def vital(tag: str, date_str, year, place):
            d = _gedcom_date(date_str, year)
            if d or place:
                lines.append(f"1 {tag}")
                if d:     lines.append(f"2 DATE {d}")
                if place: lines.append(f"2 PLAC {_safe(place)}")

        vital("BIRT", p['birth_date'],       p['birth_year'],       p['birth_place'])
        vital("CHR",  p['christening_date'], p['christening_year'], p['christening_place'])
        vital("DEAT", p['death_date'],       p['death_year'],       p['death_place'])
        vital("BURI", p['burial_date'],      p['burial_year'],      p['burial_place'])

        if p['occupation']:
            lines.append(f"1 OCCU {_safe(p['occupation'])}")

        # Legacy notes field
        if p['notes'] and include_notes:
            _emit_note(1, _strip_markdown(p['notes']), lines)

        # Structured notes
        if include_notes:
            for note in notes_by_person.get(pid, []):
                raw = note['content'] or ''
                text = _strip_markdown(raw)
                if note['title']:
                    text = f"{note['title']}\n{text}"
                # Append inline source references instead of 2 SOUR (not supported
                # by most GEDCOM importers under NOTE).
                if include_sources:
                    cites = sorted(cites_by_note.get(note['id'], []), key=lambda c: c['marker'])
                    refs = []
                    for nc in cites:
                        src = sources_by_id.get(nc['source_id']) if nc['source_id'] else None
                        if src:
                            ref = f"[{nc['marker']}] {src['title']}"
                            if nc['detail']:
                                ref += f", {nc['detail']}"
                            refs.append(ref)
                        elif nc['custom_label']:
                            ref = f"[{nc['marker']}] {nc['custom_label']}"
                            if nc['detail']:
                                ref += f", {nc['detail']}"
                            refs.append(ref)
                    if refs:
                        text = text + "\n" + "; ".join(refs)
                if text:
                    _emit_note(1, text, lines)

        # Events this person participated in
        if include_events:
            for ev_id in events_for_person.get(pid, []):
                ev = events_by_id.get(ev_id)
                if not ev:
                    continue
                ev_date = _gedcom_date(ev['date'], ev['year'])
                ev_type = ev['title'] or ev['event_type'] or 'Event'
                lines.append("1 EVEN")
                lines.append(f"2 TYPE {_safe(ev_type)}")
                if ev_date:       lines.append(f"2 DATE {ev_date}")
                if ev['place']:   lines.append(f"2 PLAC {_safe(ev['place'])}")
                if ev['description']:
                    _emit_note(2, ev['description'], lines)

        # Documents
        if include_documents:
            for doc in docs_by_person.get(pid, []):
                orig = doc['filename'] or 'file'
                # sanitise filename for ZIP arc name
                safe_orig = re.sub(r'[^\w.\-]', '_', orig)
                arc_name = f"media/doc_{doc['id']}_{safe_orig}"
                mime = (doc['mime_type'] or '').lower()
                if 'pdf' in mime:
                    form = 'PDF'
                elif 'png' in mime:
                    form = 'PNG'
                else:
                    form = 'JPEG'
                lines.append("1 OBJE")
                lines.append(f"2 FILE {arc_name}")
                lines.append(f"2 FORM {form}")
                if doc['title']:
                    lines.append(f"2 TITL {_safe(doc['title'])}")

        # Photos
        for idx, (img_id, img_path) in enumerate(photos_by_person.get(pid, [])):
            ext = Path(img_path).suffix.lower() or '.jpg'
            form = {'jpg': 'JPEG', 'jpeg': 'JPEG', 'png': 'PNG',
                    'gif': 'GIF', 'webp': 'JPEG'}.get(ext.lstrip('.'), 'JPEG')
            arc_name = f"media/photo_{img_id}{ext}"
            lines.append("1 OBJE")
            lines.append(f"2 FILE {arc_name}")
            lines.append(f"2 FORM {form}")
            lines.append(f"2 TITL {'Primary photo' if idx == 0 else f'Photo {idx + 1}'}")

        # FAMS / FAMC
        for fid in person_fams.get(pid, []):
            lines.append(f"1 FAMS @F{fid}@")
        for fid in person_famc.get(pid, []):
            lines.append(f"1 FAMC @F{fid}@")

    # ── FAM records ───────────────────────────────────────────────────────────
    for fam in families:
        lines.append(f"0 @F{fam['id']}@ FAM")
        if fam['husb']: lines.append(f"1 HUSB @I{fam['husb']}@")
        if fam['wife']: lines.append(f"1 WIFE @I{fam['wife']}@")
        for cid in fam['children']:
            lines.append(f"1 CHIL @I{cid}@")
        marr_date = _gedcom_date(None, fam['marr_year'])
        if marr_date or fam['marr_place']:
            lines.append("1 MARR")
            if marr_date:        lines.append(f"2 DATE {marr_date}")
            if fam['marr_place']: lines.append(f"2 PLAC {_safe(fam['marr_place'])}")
        div_date = _gedcom_date(None, fam['div_year'])
        if div_date or fam['div_place']:
            lines.append("1 DIV")
            if div_date:         lines.append(f"2 DATE {div_date}")
            if fam['div_place']:  lines.append(f"2 PLAC {_safe(fam['div_place'])}")

    # ── SOUR records ──────────────────────────────────────────────────────────
    if include_sources:
        for src in sources:
            lines.append(f"0 @S{src['id']}@ SOUR")
            if src['title']:       lines.append(f"1 TITL {_safe(src['title'])}")
            if src['author']:      lines.append(f"1 AUTH {_safe(src['author'])}")
            publ_parts = [src['publisher'], str(src['year']) if src['year'] else None, src['location']]
            publ = ', '.join(p for p in publ_parts if p)
            if publ:               lines.append(f"1 PUBL {_safe(publ)}")
            if src['description']: _emit_note(1, src['description'], lines)
            if src['url']:         lines.append(f"1 WWW {_safe(src['url'])}")

    lines.append("0 TRLR")

    gedcom_bytes = '\r\n'.join(lines).encode('utf-8')

    # ── Pack ZIP ──────────────────────────────────────────────────────────────
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
        zf.writestr('family.ged', gedcom_bytes)

        # Documents
        if include_documents:
            for doc in documents:
                doc_file = docs_dir / doc['stored_name']
                if doc_file.exists():
                    orig = doc['filename'] or 'file'
                    safe_orig = re.sub(r'[^\w.\-]', '_', orig)
                    zf.write(str(doc_file), f"media/doc_{doc['id']}_{safe_orig}")

        # Photos
        if photo_mode != 'none':
            seen_img_ids: set[int] = set()
            for photo_list in photos_by_person.values():
                for img_id, img_path in photo_list:
                    if img_id in seen_img_ids:
                        continue
                    seen_img_ids.add(img_id)
                    img_file = Path(img_path)
                    if img_file.exists():
                        ext = img_file.suffix.lower() or '.jpg'
                        zf.write(str(img_file), f"media/photo_{img_id}{ext}")

    buf.seek(0)
    return buf

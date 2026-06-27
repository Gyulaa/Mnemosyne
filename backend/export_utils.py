import gc
import io
import json
import re
import sqlite3
import unicodedata
import zipfile
from datetime import datetime
from pathlib import Path


def _make_id(name: str) -> str:
    ascii_name = unicodedata.normalize("NFD", name).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^\w\s]", "", ascii_name.lower()).strip()
    slug = re.sub(r"\s+", "_", slug) or "project"
    ts = int(datetime.now().timestamp())
    return f"{slug}_{ts}"


def _vacuum_copy(source: Path, dest: Path) -> None:
    """Create a clean, WAL-free copy of a SQLite DB using VACUUM INTO."""
    conn = sqlite3.connect(str(source))
    try:
        conn.execute(f"VACUUM INTO '{str(dest)}'")
    finally:
        conn.close()
        gc.collect()


def build_export_db(
    source_db_path: Path,
    dest_db_path: Path,
    cluster_ids: list[int] | None,
    include_genealogy: bool = True,
    person_ids: list[int] | None = None,
) -> dict[int, tuple[str, str]]:
    """
    Copy source DB to dest, optionally filter to specific cluster IDs, rewrite image
    paths to relative form.  Returns {image_id: (original_abs_path, new_rel_path)}.
    """
    _vacuum_copy(source_db_path, dest_db_path)

    conn = sqlite3.connect(str(dest_db_path))
    try:
        conn.execute("PRAGMA journal_mode=DELETE")
        conn.execute("PRAGMA foreign_keys=ON")

        if person_ids is not None and len(person_ids) > 0:
            pids_str = ",".join(str(x) for x in person_ids)

            # Derive cluster IDs linked to these persons.
            family_cluster_ids = [
                r[0] for r in conn.execute(
                    f"SELECT id FROM clusters WHERE person_id IN ({pids_str}) AND label != -1"
                ).fetchall()
            ]

            if family_cluster_ids:
                cids_str = ",".join(str(x) for x in family_cluster_ids)
                keep_images = f"SELECT DISTINCT image_id FROM faces WHERE cluster_id IN ({cids_str})"
                conn.execute(f"DELETE FROM faces WHERE image_id NOT IN ({keep_images})")
                conn.execute(f"DELETE FROM images WHERE id NOT IN ({keep_images})")

                noise_row = conn.execute("SELECT id FROM clusters WHERE label = -1").fetchone()
                if not noise_row:
                    conn.execute("INSERT INTO clusters (label, person_id) VALUES (-1, NULL)")
                    noise_row = conn.execute("SELECT id FROM clusters WHERE label = -1").fetchone()
                noise_id = noise_row[0]

                conn.execute(f"""
                    UPDATE faces
                    SET cluster_id = {noise_id},
                        manually_assigned = 0
                    WHERE cluster_id NOT IN (
                        SELECT id FROM clusters WHERE id IN ({cids_str}) OR label = -1
                    )
                """)
                conn.execute(f"DELETE FROM clusters WHERE id NOT IN ({cids_str}) AND label != -1")
            else:
                # No linked clusters — no images to include.
                conn.execute("DELETE FROM faces")
                conn.execute("DELETE FROM images")
                conn.execute("DELETE FROM clusters WHERE label != -1")

            # Filter persons and relations to the selected family group.
            conn.execute(f"""
                DELETE FROM relations
                WHERE person_a_id NOT IN ({pids_str})
                   OR person_b_id NOT IN ({pids_str})
            """)
            conn.execute(f"DELETE FROM persons WHERE id NOT IN ({pids_str})")
            conn.commit()

        elif cluster_ids is not None and len(cluster_ids) > 0:
            ids_str = ",".join(str(x) for x in cluster_ids)
            keep_images = f"SELECT DISTINCT image_id FROM faces WHERE cluster_id IN ({ids_str})"

            # 1. Faces reference images — delete faces first to satisfy FK.
            conn.execute(f"DELETE FROM faces WHERE image_id NOT IN ({keep_images})")
            # 2. Delete images that have no face from selected clusters.
            conn.execute(f"DELETE FROM images WHERE id NOT IN ({keep_images})")

            # 3. Ensure noise cluster exists — unselected faces move here so
            #    their embeddings survive for re-clustering in the new collection.
            noise_row = conn.execute("SELECT id FROM clusters WHERE label = -1").fetchone()
            if not noise_row:
                conn.execute("INSERT INTO clusters (label, person_id) VALUES (-1, NULL)")
                noise_row = conn.execute("SELECT id FROM clusters WHERE label = -1").fetchone()
            noise_id = noise_row[0]

            # 4. Move (not delete) faces from unselected named clusters to noise.
            conn.execute(f"""
                UPDATE faces
                SET cluster_id = {noise_id},
                    manually_assigned = 0
                WHERE cluster_id NOT IN (
                    SELECT id FROM clusters WHERE id IN ({ids_str}) OR label = -1
                )
            """)

            # 5. Delete unselected named clusters (faces are now in noise).
            conn.execute(f"DELETE FROM clusters WHERE id NOT IN ({ids_str}) AND label != -1")

            if include_genealogy:
                # Keep only persons linked to the remaining (selected) clusters.
                # Relations must be deleted first (they reference persons via FK).
                conn.execute("""
                    DELETE FROM relations
                    WHERE person_a_id NOT IN (
                        SELECT person_id FROM clusters WHERE person_id IS NOT NULL)
                       OR person_b_id NOT IN (
                        SELECT person_id FROM clusters WHERE person_id IS NOT NULL)
                """)
                conn.execute("""
                    DELETE FROM persons
                    WHERE id NOT IN (
                        SELECT person_id FROM clusters WHERE person_id IS NOT NULL
                    )
                """)
            else:
                # clusters.person_id references persons, so unlink before deleting.
                conn.execute("DELETE FROM relations")
                conn.execute("UPDATE clusters SET person_id = NULL")
                conn.execute("DELETE FROM persons")
            conn.commit()

        elif not include_genealogy:
            # Full-project export without genealogy.
            conn.execute("DELETE FROM relations")
            conn.execute("UPDATE clusters SET person_id = NULL")
            conn.execute("DELETE FROM persons")
            conn.commit()

        rows = conn.execute("SELECT id, path FROM images").fetchall()
        path_map: dict[int, tuple[str, str]] = {}
        for img_id, orig_path in rows:
            filename = Path(orig_path).name
            new_rel = f"images/{img_id}_{filename}"
            path_map[img_id] = (orig_path, new_rel)
            conn.execute("UPDATE images SET path = ? WHERE id = ?", (new_rel, img_id))

        conn.commit()
    finally:
        conn.close()
        gc.collect()

    return path_map


def create_project_zip(
    source_db_path: Path,
    project_info: dict,
    cluster_ids: list[int] | None,
    include_genealogy: bool = True,
    person_ids: list[int] | None = None,
) -> io.BytesIO:
    """Build a self-contained project ZIP (DB + images) and return it as a BytesIO."""
    import tempfile

    buf = io.BytesIO()
    # ignore_cleanup_errors=True: on Windows the SQLite file may still have a
    # transient OS-level lock even after conn.close() + gc.collect(); letting the
    # OS clean the temp dir later is safe since the data is already in `buf`.
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        tmp_db = Path(tmpdir) / "project.db"
        path_map = build_export_db(source_db_path, tmp_db, cluster_ids, include_genealogy, person_ids)

        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
            zf.writestr(
                "project.json",
                json.dumps(project_info, ensure_ascii=False, indent=2),
            )
            zf.write(str(tmp_db), "project.db")
            for _img_id, (orig_path, new_rel) in path_map.items():
                p = Path(orig_path)
                if p.exists():
                    zf.write(str(p), new_rel)

    buf.seek(0)
    return buf


def import_project_zip(zip_data: bytes, projects_dir: Path) -> dict:
    """
    Extract a project ZIP into a new project folder.
    Rewrites the relative image paths (images/<id>_<name>) back to absolute paths.
    Returns the new project info dict (with is_active=False).
    """
    with zipfile.ZipFile(io.BytesIO(zip_data), "r") as zf:
        names = zf.namelist()
        if "project.json" not in names:
            raise ValueError("Invalid archive: missing project.json")
        if "project.db" not in names:
            raise ValueError("Invalid archive: missing project.db")

        with zf.open("project.json") as f:
            project_info = json.loads(f.read())

        new_id = _make_id(project_info.get("name", "imported"))
        project_dir = projects_dir / new_id
        project_dir.mkdir(parents=True, exist_ok=True)

        project_dir_resolved = project_dir.resolve()
        for member in zf.infolist():
            target = (project_dir / member.filename).resolve()
            if not target.is_relative_to(project_dir_resolved):
                raise ValueError(f"Unsafe path in ZIP: {member.filename}")
            zf.extract(member, str(project_dir))

    project_info["id"] = new_id
    (project_dir / "project.json").write_text(
        json.dumps(project_info, ensure_ascii=False),
        encoding="utf-8",
    )

    src_db = project_dir / "project.db"
    dest_db = project_dir / "photo_organizer.db"
    if src_db.exists():
        src_db.rename(dest_db)

    if dest_db.exists():
        conn = sqlite3.connect(str(dest_db))
        try:
            rows = conn.execute("SELECT id, path FROM images").fetchall()
            for img_id, rel_path in rows:
                abs_path = str(project_dir / rel_path)
                conn.execute("UPDATE images SET path = ? WHERE id = ?", (abs_path, img_id))
            conn.commit()
        finally:
            conn.close()
            gc.collect()

    project_info["is_active"] = False
    return project_info

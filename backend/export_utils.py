import gc
import hashlib
import io
import json
import os
import re
import sqlite3
import threading
import unicodedata
import uuid
import zipfile
from datetime import datetime
from pathlib import Path


def _sha256_file(path: Path) -> str | None:
    try:
        h = hashlib.sha256()
        with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(65536), b''):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return None


def _build_local_image_index(projects_dir: Path, exclude_id: str) -> dict[str, str]:
    """Return {key → abs_path} index of all images in existing local projects.

    Keys have the form ``stid:<stable_id>`` or ``hash:<content_hash>``.
    Only files that actually exist on disk are indexed.
    Silently skips projects whose DB doesn't have the identity columns yet.
    """
    index: dict[str, str] = {}
    try:
        dirs = list(projects_dir.iterdir())
    except Exception:
        return index
    for proj_dir in dirs:
        if not proj_dir.is_dir() or proj_dir.name == exclude_id:
            continue
        db_path = proj_dir / "photo_organizer.db"
        if not db_path.exists():
            continue
        try:
            conn = sqlite3.connect(str(db_path))
            conn.row_factory = sqlite3.Row
            try:
                rows = conn.execute(
                    "SELECT path, stable_id, content_hash FROM images "
                    "WHERE stable_id IS NOT NULL OR content_hash IS NOT NULL"
                ).fetchall()
            except Exception:
                rows = []  # old schema without identity columns
            finally:
                conn.close()
            for row in rows:
                if not Path(row['path']).is_file():
                    continue
                if row['stable_id']:
                    index.setdefault(f"stid:{row['stable_id']}", row['path'])
                if row['content_hash']:
                    index.setdefault(f"hash:{row['content_hash']}", row['path'])
        except Exception:
            pass
    return index


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


def _delete_images(conn: sqlite3.Connection, keep_subquery: str) -> None:
    """Delete images (and dependent rows) that don't match keep_subquery."""
    conn.execute(f"DELETE FROM event_images WHERE image_id NOT IN ({keep_subquery})")
    try:
        conn.execute(f"DELETE FROM document_images WHERE image_id NOT IN ({keep_subquery})")
    except sqlite3.OperationalError:
        pass   # schema older than v6
    conn.execute(f"DELETE FROM faces WHERE image_id NOT IN ({keep_subquery})")
    conn.execute(f"DELETE FROM images WHERE id NOT IN ({keep_subquery})")


def _delete_document_children(conn: sqlite3.Connection, where_clause: str) -> None:
    """Remove rows hanging off documents matched by where_clause (on document_id).

    Tables added in schema v6/v10/v11, so tolerate their absence in older export inputs.
    """
    for table in ("document_citations", "document_images", "document_files", "document_description_citations"):
        try:
            conn.execute(f"DELETE FROM {table} WHERE {where_clause}")
        except sqlite3.OperationalError:
            pass


def _delete_persons(conn: sqlite3.Connection, where_clause: str) -> None:
    """Delete persons matching where_clause after cleaning up all FK child tables."""
    conn.execute(f"""
        DELETE FROM note_citations
        WHERE note_id IN (SELECT id FROM person_notes WHERE person_id IN (SELECT id FROM persons WHERE {where_clause}))
    """)
    conn.execute(f"DELETE FROM person_notes WHERE person_id IN (SELECT id FROM persons WHERE {where_clause})")
    conn.execute(f"DELETE FROM citations WHERE person_id IN (SELECT id FROM persons WHERE {where_clause})")
    conn.execute(f"DELETE FROM event_persons WHERE person_id IN (SELECT id FROM persons WHERE {where_clause})")
    conn.execute(f"DELETE FROM document_persons WHERE person_id IN (SELECT id FROM persons WHERE {where_clause})")
    _delete_document_children(
        conn, f"document_id IN (SELECT id FROM documents WHERE person_id IN (SELECT id FROM persons WHERE {where_clause}))"
    )
    conn.execute(f"DELETE FROM documents WHERE person_id IN (SELECT id FROM persons WHERE {where_clause})")
    # Documents nobody owns belong to the project as a whole, not to anyone in
    # the narrowed selection, so an export scoped to a person or cluster set
    # leaves them behind. `person_id IN (…)` above is never true of NULL, which
    # is why this needs a statement of its own.
    unowned = "person_id IS NULL AND id NOT IN (SELECT document_id FROM document_persons)"
    try:
        conn.execute(
            f"DELETE FROM document_note_citations WHERE note_id IN "
            f"(SELECT id FROM document_notes WHERE document_id IN (SELECT id FROM documents WHERE {unowned}))"
        )
        conn.execute(f"DELETE FROM document_notes WHERE document_id IN (SELECT id FROM documents WHERE {unowned})")
    except sqlite3.OperationalError:
        pass   # export input predates document notes
    _delete_document_children(conn, f"document_id IN (SELECT id FROM documents WHERE {unowned})")
    conn.execute(f"DELETE FROM documents WHERE {unowned}")
    conn.execute(f"""
        DELETE FROM relations
        WHERE person_a_id IN (SELECT id FROM persons WHERE {where_clause})
           OR person_b_id IN (SELECT id FROM persons WHERE {where_clause})
    """)
    # Derived sub-cluster centroids — CASCADE would handle this but we are explicit.
    conn.execute(f"DELETE FROM person_subclusters WHERE person_id IN (SELECT id FROM persons WHERE {where_clause})")
    conn.execute(f"DELETE FROM persons WHERE {where_clause}")


def build_export_db(
    source_db_path: Path,
    dest_db_path: Path,
    cluster_ids: list[int] | None,
    include_genealogy: bool = True,
    person_ids: list[int] | None = None,
    include_faceless: bool = True,
    include_notes: bool = True,
    include_sources: bool = True,
    include_events: bool = True,
    include_documents: bool = True,
    include_images: bool = True,
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

        # AI assistant conversations never leave the machine. This copy is of the
        # *whole* database, so the absence of an export toggle is not protection —
        # only an unconditional delete is. Children first, so the block does not
        # depend on cascade behaviour.
        for _chat_table in ("chat_tool_calls", "chat_messages", "chat_threads"):
            try:
                conn.execute(f"DELETE FROM {_chat_table}")
            except sqlite3.OperationalError:
                pass  # pre-v7 database being exported — nothing to strip

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
                _delete_images(conn, keep_images)

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
                conn.execute("DELETE FROM event_images")
                conn.execute("DELETE FROM faces")
                conn.execute("DELETE FROM images")
                conn.execute("DELETE FROM clusters WHERE label != -1")

            # Filter persons and relations to the selected family group.
            _delete_persons(conn, f"id NOT IN ({pids_str})")
            conn.commit()

        elif cluster_ids is not None and len(cluster_ids) > 0:
            ids_str = ",".join(str(x) for x in cluster_ids)
            keep_images = f"SELECT DISTINCT image_id FROM faces WHERE cluster_id IN ({ids_str})"

            # 1. Remove event_images + faces for excluded images, then the images themselves.
            _delete_images(conn, keep_images)

            # 2. Ensure noise cluster exists — unselected faces move here so
            #    their embeddings survive for re-clustering in the new collection.
            noise_row = conn.execute("SELECT id FROM clusters WHERE label = -1").fetchone()
            if not noise_row:
                conn.execute("INSERT INTO clusters (label, person_id) VALUES (-1, NULL)")
                noise_row = conn.execute("SELECT id FROM clusters WHERE label = -1").fetchone()
            noise_id = noise_row[0]

            # 3. Move (not delete) faces from unselected named clusters to noise.
            conn.execute(f"""
                UPDATE faces
                SET cluster_id = {noise_id},
                    manually_assigned = 0
                WHERE cluster_id NOT IN (
                    SELECT id FROM clusters WHERE id IN ({ids_str}) OR label = -1
                )
            """)

            # 4. Delete unselected named clusters (faces are now in noise).
            conn.execute(f"DELETE FROM clusters WHERE id NOT IN ({ids_str}) AND label != -1")

            if include_genealogy:
                # Keep only persons linked to the remaining (selected) clusters.
                _delete_persons(conn, "id NOT IN (SELECT person_id FROM clusters WHERE person_id IS NOT NULL)")
            else:
                # clusters.person_id references persons, so unlink before deleting.
                conn.execute("UPDATE clusters SET person_id = NULL")
                _delete_persons(conn, "1=1")  # delete all persons
            conn.commit()

        elif not include_genealogy:
            # Full-project export without genealogy.
            conn.execute("UPDATE clusters SET person_id = NULL")
            _delete_persons(conn, "1=1")
            conn.commit()

        # ── Images ───────────────────────────────────────────────────────────────
        if not include_images:
            _delete_images(conn, "0")   # delete all image files + faces
            conn.commit()
        elif not include_faceless:
            _delete_images(conn, "SELECT DISTINCT image_id FROM faces")
            conn.commit()

        # ── Notes ─────────────────────────────────────────────────────────────
        if not include_notes:
            conn.execute("DELETE FROM note_citations")
            conn.execute("DELETE FROM person_notes")
            conn.execute("DELETE FROM document_note_citations")
            conn.execute("DELETE FROM document_notes")
            conn.commit()

        # ── Sources & Citations ───────────────────────────────────────────────
        if not include_sources:
            conn.execute("DELETE FROM note_citations WHERE source_id IS NOT NULL")
            conn.execute("DELETE FROM document_note_citations WHERE source_id IS NOT NULL")
            conn.execute("DELETE FROM citations")
            conn.execute("DELETE FROM sources")
            conn.commit()

        # ── Events ────────────────────────────────────────────────────────────
        if not include_events:
            conn.execute("DELETE FROM event_images")
            conn.execute("DELETE FROM event_persons")
            conn.execute("DELETE FROM events")
            conn.commit()
        else:
            # Remove events that lost all participants during person filtering.
            conn.execute("DELETE FROM event_images WHERE event_id NOT IN (SELECT DISTINCT event_id FROM event_persons)")
            conn.execute("DELETE FROM events WHERE id NOT IN (SELECT DISTINCT event_id FROM event_persons)")
            conn.commit()

        # ── Documents ─────────────────────────────────────────────────────────
        if not include_documents:
            conn.execute("DELETE FROM document_persons")
            _delete_document_children(conn, "1=1")
            conn.execute("DELETE FROM documents")
            conn.commit()

        # ── Privacy filter (always applied) ───────────────────────────────────
        # Private images
        try:
            conn.execute("DELETE FROM event_images WHERE image_id IN (SELECT id FROM images WHERE is_private=1)")
            try:
                conn.execute("DELETE FROM document_images WHERE image_id IN (SELECT id FROM images WHERE is_private=1)")
            except sqlite3.OperationalError:
                pass
            conn.execute("DELETE FROM faces WHERE image_id IN (SELECT id FROM images WHERE is_private=1)")
            conn.execute("DELETE FROM images WHERE is_private=1")
        except Exception:
            pass
        # Private clusters → move faces to noise, then delete
        try:
            noise_row = conn.execute("SELECT id FROM clusters WHERE label = -1").fetchone()
            if not noise_row:
                conn.execute("INSERT INTO clusters (label, person_id) VALUES (-1, NULL)")
                noise_row = conn.execute("SELECT id FROM clusters WHERE label = -1").fetchone()
            noise_id = noise_row[0]
            conn.execute(
                f"UPDATE faces SET cluster_id={noise_id}, manually_assigned=0 "
                "WHERE cluster_id IN (SELECT id FROM clusters WHERE is_private=1 AND label != -1)"
            )
            conn.execute("DELETE FROM clusters WHERE is_private=1 AND label != -1")
        except Exception:
            pass
        # Private relations
        try:
            conn.execute("DELETE FROM relations WHERE is_private=1")
        except Exception:
            pass
        # Private documents
        try:
            conn.execute("DELETE FROM document_note_citations WHERE note_id IN (SELECT id FROM document_notes WHERE document_id IN (SELECT id FROM documents WHERE is_private=1))")
            conn.execute("DELETE FROM document_notes WHERE document_id IN (SELECT id FROM documents WHERE is_private=1)")
            conn.execute("DELETE FROM document_persons WHERE document_id IN (SELECT id FROM documents WHERE is_private=1)")
            _delete_document_children(conn, "document_id IN (SELECT id FROM documents WHERE is_private=1)")
            conn.execute("DELETE FROM documents WHERE is_private=1")
        except Exception:
            pass
        # Private notes
        try:
            conn.execute("DELETE FROM note_citations WHERE note_id IN (SELECT id FROM person_notes WHERE is_private=1)")
            conn.execute("DELETE FROM person_notes WHERE is_private=1")
        except Exception:
            pass
        # Private events
        try:
            conn.execute("DELETE FROM event_images WHERE event_id IN (SELECT id FROM events WHERE is_private=1)")
            conn.execute("DELETE FROM event_persons WHERE event_id IN (SELECT id FROM events WHERE is_private=1)")
            conn.execute("DELETE FROM events WHERE is_private=1")
        except Exception:
            pass
        conn.commit()

        rows = conn.execute(
            "SELECT id, path, stable_id, content_hash, source_path FROM images"
        ).fetchall()
        path_map: dict[int, tuple[str, str]] = {}
        for img_id, orig_path, stable_id, content_hash, src_path in rows:
            filename = Path(orig_path).name
            new_rel = f"images/{img_id}_{filename}"
            path_map[img_id] = (orig_path, new_rel)

            # Ensure identity fields are set (backfill for pre-feature images)
            new_stable = stable_id or str(uuid.uuid4())
            new_hash = content_hash
            if not new_hash:
                p = Path(orig_path)
                if p.exists():
                    new_hash = _sha256_file(p)
            # source_path must capture the ORIGINAL absolute path before it's
            # changed to the relative ZIP-internal path.
            new_src = src_path if src_path else orig_path

            conn.execute(
                "UPDATE images SET path=?, stable_id=?, content_hash=?, source_path=? WHERE id=?",
                (new_rel, new_stable, new_hash, new_src, img_id),
            )

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
    include_faceless: bool = True,
    include_notes: bool = True,
    include_sources: bool = True,
    include_events: bool = True,
    include_documents: bool = True,
    include_images: bool = True,
) -> io.BytesIO:
    """Build a self-contained project ZIP (DB + images + documents) and return it as a BytesIO."""
    import tempfile

    docs_dir = source_db_path.parent / "documents"

    buf = io.BytesIO()
    # ignore_cleanup_errors=True: on Windows the SQLite file may still have a
    # transient OS-level lock even after conn.close() + gc.collect(); letting the
    # OS clean the temp dir later is safe since the data is already in `buf`.
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        tmp_db = Path(tmpdir) / "project.db"
        path_map = build_export_db(
            source_db_path, tmp_db, cluster_ids,
            include_genealogy, person_ids, include_faceless,
            include_notes, include_sources, include_events,
            include_documents, include_images,
        )

        # Collect document files that are still referenced in the exported DB.
        doc_stored_names: list[str] = []
        if docs_dir.exists():
            doc_conn = sqlite3.connect(str(tmp_db))
            try:
                doc_stored_names = [
                    r[0] for r in doc_conn.execute(
                        "SELECT stored_name FROM documents "
                        "UNION ALL SELECT stored_name FROM document_files"
                    ).fetchall()
                ]
            finally:
                doc_conn.close()
                gc.collect()

        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
            zf.writestr(
                "project.json",
                json.dumps(project_info, ensure_ascii=False, indent=2),
            )
            zf.write(str(tmp_db), "project.db")

            # Images
            for _img_id, (orig_path, new_rel) in path_map.items():
                p = Path(orig_path)
                if p.exists():
                    zf.write(str(p), new_rel)

            # Documents — only files still referenced in the exported DB
            for stored_name in doc_stored_names:
                doc_file = docs_dir / stored_name
                if doc_file.exists():
                    zf.write(str(doc_file), f"documents/{stored_name}")

    buf.seek(0)
    return buf


class NonSeekableWriter:
    """Hide seek()/tell() from zipfile so it uses its streaming code path.

    On Windows, os.fdopen(pipe_fd, 'wb') returns a BufferedWriter that reports
    seekable() == True and whose tell() only tracks the buffer, not the total
    bytes written. zipfile trusts that, records bogus local-header offsets and
    emits a central directory pointing into the middle of the archive — the
    result opens as a handful of garbage entries and fails its CRC check.
    Exposing only write()/flush() makes zipfile wrap this in its own _Tellable
    byte counter and emit data descriptors, producing a valid streamed ZIP.
    """

    def __init__(self, fp):
        self._fp = fp

    def write(self, data):
        return self._fp.write(data)

    def flush(self):
        return self._fp.flush()


def stream_project_zip(
    source_db_path: Path,
    project_info: dict,
    cluster_ids: list[int] | None,
    include_genealogy: bool = True,
    person_ids: list[int] | None = None,
    include_faceless: bool = True,
    include_notes: bool = True,
    include_sources: bool = True,
    include_events: bool = True,
    include_documents: bool = True,
    include_images: bool = True,
):
    """Generator that yields ZIP bytes progressively via OS pipe.

    All heavy work (build_export_db, file I/O) runs inside _producer() so HTTP
    headers are sent before any blocking occurs and exceptions surface in logs.
    """
    import tempfile, traceback, time

    docs_dir = source_db_path.parent / "documents"
    read_fd, write_fd = os.pipe()
    exc: list = []

    def _producer():
        t0 = time.monotonic()
        print(f"[export] producer thread started", flush=True)
        try:
            with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
                with os.fdopen(write_fd, 'wb') as wf:
                    with zipfile.ZipFile(NonSeekableWriter(wf), 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
                        # project.json written first → first ZIP bytes flow immediately
                        zf.writestr(
                            "project.json",
                            json.dumps(project_info, ensure_ascii=False, indent=2),
                        )
                        print(f"[export] project.json written ({time.monotonic()-t0:.2f}s)", flush=True)

                        tmp_db = Path(tmpdir) / "project.db"
                        print(f"[export] starting build_export_db", flush=True)
                        path_map = build_export_db(
                            source_db_path, tmp_db, cluster_ids,
                            include_genealogy, person_ids, include_faceless,
                            include_notes, include_sources, include_events,
                            include_documents, include_images,
                        )
                        print(f"[export] build_export_db done ({time.monotonic()-t0:.2f}s), {len(path_map)} images", flush=True)

                        doc_stored_names: list[str] = []
                        if docs_dir.exists():
                            doc_conn = sqlite3.connect(str(tmp_db))
                            try:
                                doc_stored_names = [
                                    r[0] for r in doc_conn.execute(
                                        "SELECT stored_name FROM documents "
                                        "UNION ALL SELECT stored_name FROM document_files"
                                    ).fetchall()
                                ]
                            finally:
                                doc_conn.close()
                                gc.collect()

                        print(f"[export] writing project.db ({time.monotonic()-t0:.2f}s)", flush=True)
                        zf.write(str(tmp_db), "project.db")
                        print(f"[export] project.db written ({time.monotonic()-t0:.2f}s)", flush=True)

                        for _img_id, (orig_path, new_rel) in path_map.items():
                            p = Path(orig_path)
                            if p.exists():
                                zf.write(str(p), new_rel)
                        print(f"[export] images written ({time.monotonic()-t0:.2f}s)", flush=True)

                        for stored_name in doc_stored_names:
                            doc_file = docs_dir / stored_name
                            if doc_file.exists():
                                zf.write(str(doc_file), f"documents/{stored_name}")
                        print(f"[export] documents written, closing ZIP ({time.monotonic()-t0:.2f}s)", flush=True)
        except Exception as e:
            print(f"[export] PRODUCER ERROR at {time.monotonic()-t0:.2f}s: {e!r}", flush=True)
            traceback.print_exc()
            exc.append(e)
            # Ensure write end closes so reader sees EOF (already closed by context manager
            # if we got past os.fdopen, but guard for errors before that point)
            try:
                os.close(write_fd)
            except OSError:
                pass

    t = threading.Thread(target=_producer, daemon=True)
    t.start()
    try:
        with os.fdopen(read_fd, 'rb') as rf:
            while True:
                chunk = rf.read(65536)
                if not chunk:
                    break
                yield chunk
    finally:
        t.join()
    if exc:
        raise exc[0]


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

    images_reused = 0
    images_new = 0

    if dest_db.exists():
        # Ensure identity columns exist even in legacy imported DBs
        _ensure_identity_columns(dest_db)

        # Build index of every image already on this machine (excluding the new project)
        local_index = _build_local_image_index(projects_dir, exclude_id=new_id)

        conn = sqlite3.connect(str(dest_db))
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                "SELECT id, path, stable_id, content_hash, source_path FROM images"
            ).fetchall()
            for row in rows:
                img_id   = row['id']
                rel_path = row['path']
                stable_id    = row['stable_id']
                content_hash = row['content_hash']
                source_path  = row['source_path']

                local_path: str | None = None

                # Step 1 — stable_id match (same logical image)
                if stable_id:
                    local_path = local_index.get(f"stid:{stable_id}")

                # Step 2 — content_hash match (identical content, possibly different origin)
                if not local_path and content_hash:
                    local_path = local_index.get(f"hash:{content_hash}")

                # Step 3 — source_path hint: file still lives at original path AND hash matches
                if not local_path and source_path and content_hash:
                    sp = Path(source_path)
                    if sp.is_file() and _sha256_file(sp) == content_hash:
                        local_path = source_path

                if local_path:
                    conn.execute(
                        "UPDATE images SET path=? WHERE id=?", (local_path, img_id)
                    )
                    # Delete the redundant extracted copy to free disk space immediately
                    extracted = project_dir / rel_path
                    if extracted.is_file():
                        try:
                            extracted.unlink()
                        except Exception:
                            pass
                    images_reused += 1
                else:
                    abs_path = str(project_dir / rel_path)
                    conn.execute(
                        "UPDATE images SET path=? WHERE id=?", (abs_path, img_id)
                    )
                    images_new += 1

            conn.commit()
        finally:
            conn.close()
            gc.collect()

    project_info["is_active"] = False
    project_info["images_reused"] = images_reused
    project_info["images_new"] = images_new
    return project_info


def _ensure_identity_columns(db_path: Path) -> None:
    """Add stable_id/content_hash/source_path to images if missing (legacy DBs)."""
    conn = sqlite3.connect(str(db_path))
    try:
        for col in ("stable_id TEXT", "content_hash TEXT", "source_path TEXT"):
            try:
                conn.execute(f"ALTER TABLE images ADD COLUMN {col}")
                conn.commit()
            except Exception:
                pass
    finally:
        conn.close()

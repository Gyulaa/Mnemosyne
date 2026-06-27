import json
import os
import re
import shutil
import unicodedata
from datetime import datetime
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .database import configure_engine, init_db_schema

ROOT_DIR = Path(os.environ.get('MNEMOSYNE_APP_DIR') or str(Path(__file__).parent.parent))
PROJECTS_DIR = ROOT_DIR / "projects"
CONFIG_FILE = ROOT_DIR / "config.json"
LEGACY_DB = ROOT_DIR / "photo_organizer.db"


def _make_id(name: str) -> str:
    ascii_name = unicodedata.normalize("NFD", name).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^\w\s]", "", ascii_name.lower()).strip()
    slug = re.sub(r"\s+", "_", slug) or "project"
    ts = int(datetime.now().timestamp())
    return f"{slug}_{ts}"


def _read_project_json(path: Path) -> dict:
    """Read project.json, auto-migrating CP1252-encoded files to UTF-8."""
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("cp1252")
        path.write_text(json.dumps(json.loads(text), ensure_ascii=False), encoding="utf-8")
    return json.loads(text)


class ProjectManager:
    def __init__(self):
        self._engine = None
        self._SessionLocal = None
        self._active_id: str | None = None
        PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
        self._boot()

    # ── boot ──────────────────────────────────────────────────────────────────

    def _boot(self):
        # Migrate old single-DB setup to a Default project
        if LEGACY_DB.exists() and not any(PROJECTS_DIR.iterdir()):
            self._migrate_legacy()

        active_id = self._read_config().get("active_project")
        if active_id and (PROJECTS_DIR / active_id).exists():
            self._activate(active_id)
        elif any(d for d in PROJECTS_DIR.iterdir() if d.is_dir()):
            first = next(d for d in sorted(PROJECTS_DIR.iterdir()) if d.is_dir())
            self._activate(first.name)
        else:
            info = self._create_project_internal("Default")
            self._write_config(info["id"])
            self._activate(info["id"])

    def _migrate_legacy(self):
        project_id = _make_id("Default")
        project_dir = PROJECTS_DIR / project_id
        project_dir.mkdir(parents=True, exist_ok=True)
        shutil.move(str(LEGACY_DB), str(project_dir / "photo_organizer.db"))
        for ext in (".db-shm", ".db-wal"):
            p = ROOT_DIR / f"photo_organizer{ext}"
            if p.exists():
                p.unlink(missing_ok=True)
        info = {"id": project_id, "name": "Default", "created": datetime.now().isoformat()}
        (project_dir / "project.json").write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
        self._write_config(project_id)

    # ── internal helpers ───────────────────────────────────────────────────────

    def _activate(self, project_id: str):
        db_path = PROJECTS_DIR / project_id / "photo_organizer.db"
        engine = create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False},
        )
        configure_engine(engine)
        init_db_schema(engine)
        self._engine = engine
        self._SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        self._active_id = project_id

    def _create_project_internal(self, name: str) -> dict:
        project_id = _make_id(name)
        project_dir = PROJECTS_DIR / project_id
        project_dir.mkdir(parents=True, exist_ok=True)
        info = {"id": project_id, "name": name.strip(), "created": datetime.now().isoformat()}
        (project_dir / "project.json").write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
        return info

    def _read_config(self) -> dict:
        if CONFIG_FILE.exists():
            try:
                return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {}

    def _write_config(self, active_id: str):
        CONFIG_FILE.write_text(json.dumps({"active_project": active_id}), encoding="utf-8")

    # ── public API ─────────────────────────────────────────────────────────────

    def create_project(self, name: str) -> dict:
        info = self._create_project_internal(name)
        self._write_config(info["id"])
        self._activate(info["id"])
        return info

    def list_projects(self) -> list[dict]:
        result = []
        for d in sorted(PROJECTS_DIR.iterdir()):
            pj = d / "project.json"
            if d.is_dir() and pj.exists():
                try:
                    info = _read_project_json(pj)
                    info["is_active"] = d.name == self._active_id
                    result.append(info)
                except Exception:
                    pass
        return result

    def switch_project(self, project_id: str) -> dict:
        project_dir = PROJECTS_DIR / project_id
        if not project_dir.exists():
            raise FileNotFoundError(f"Project not found: {project_id}")
        self._write_config(project_id)
        self._activate(project_id)
        info = _read_project_json(project_dir / "project.json")
        info["is_active"] = True
        return info

    def delete_project(self, project_id: str) -> dict | None:
        """Delete a project. If active, switches to another (creates Default if none left).
        Returns new active project info when the active project was deleted, else None."""
        project_dir = PROJECTS_DIR / project_id
        if not project_dir.exists():
            raise FileNotFoundError(f"Project not found: {project_id}")

        was_active = project_id == self._active_id

        # Release all SQLAlchemy pooled connections before deleting files.
        # On Windows, open file handles prevent shutil.rmtree from succeeding.
        if was_active and self._engine is not None:
            self._engine.dispose()
            self._engine = None
            self._SessionLocal = None
            self._active_id = None

        shutil.rmtree(str(project_dir))

        if not was_active:
            return None

        others = [
            d for d in sorted(PROJECTS_DIR.iterdir())
            if d.is_dir() and (d / "project.json").exists()
        ]
        if others:
            new_id = others[0].name
        else:
            new_info = self._create_project_internal("Default")
            new_id = new_info["id"]

        self._write_config(new_id)
        self._activate(new_id)
        info = _read_project_json(PROJECTS_DIR / new_id / "project.json")
        info["is_active"] = True
        return info

    def rename_project(self, project_id: str, new_name: str) -> dict:
        project_dir = PROJECTS_DIR / project_id
        if not project_dir.exists():
            raise FileNotFoundError(f"Project not found: {project_id}")
        pj = project_dir / "project.json"
        info = _read_project_json(pj)
        info["name"] = new_name.strip()
        pj.write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
        info["is_active"] = project_id == self._active_id
        return info

    # ── properties used by main.py and scanner ─────────────────────────────────

    @property
    def session_factory(self):
        return self._SessionLocal

    @property
    def active_id(self) -> str | None:
        return self._active_id

    def get_db(self):
        db = self._SessionLocal()
        try:
            yield db
        finally:
            db.close()


project_manager = ProjectManager()

import json
import re
import shutil
from datetime import datetime
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .database import configure_engine, init_db_schema

ROOT_DIR = Path(__file__).parent.parent
PROJECTS_DIR = ROOT_DIR / "projects"
CONFIG_FILE = ROOT_DIR / "config.json"
LEGACY_DB = ROOT_DIR / "photo_organizer.db"


def _make_id(name: str) -> str:
    slug = re.sub(r"[^\w\s]", "", name.lower()).strip()
    slug = re.sub(r"\s+", "_", slug) or "project"
    ts = int(datetime.now().timestamp())
    return f"{slug}_{ts}"


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
        (project_dir / "project.json").write_text(json.dumps(info, ensure_ascii=False))
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
        (project_dir / "project.json").write_text(json.dumps(info, ensure_ascii=False))
        return info

    def _read_config(self) -> dict:
        if CONFIG_FILE.exists():
            try:
                return json.loads(CONFIG_FILE.read_text())
            except Exception:
                pass
        return {}

    def _write_config(self, active_id: str):
        CONFIG_FILE.write_text(json.dumps({"active_project": active_id}))

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
                    info = json.loads(pj.read_text())
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
        info = json.loads((project_dir / "project.json").read_text())
        info["is_active"] = True
        return info

    def delete_project(self, project_id: str):
        if project_id == self._active_id:
            raise ValueError("Cannot delete the active project")
        project_dir = PROJECTS_DIR / project_id
        if not project_dir.exists():
            raise FileNotFoundError(f"Project not found: {project_id}")
        shutil.rmtree(str(project_dir))

    def rename_project(self, project_id: str, new_name: str) -> dict:
        project_dir = PROJECTS_DIR / project_id
        if not project_dir.exists():
            raise FileNotFoundError(f"Project not found: {project_id}")
        pj = project_dir / "project.json"
        info = json.loads(pj.read_text())
        info["name"] = new_name.strip()
        pj.write_text(json.dumps(info, ensure_ascii=False))
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

from sqlalchemy import (
    Column, Integer, String, Float, LargeBinary, Boolean,
    ForeignKey, DateTime, event, text,
)
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class Image(Base):
    __tablename__ = "images"
    id = Column(Integer, primary_key=True, index=True)
    path = Column(String, unique=True, nullable=False, index=True)
    mtime = Column(Float, nullable=False)
    exif_date = Column(DateTime, nullable=True)
    scan_status = Column(String, default="pending", index=True)  # pending/done/no_face/error
    error_msg = Column(String, nullable=True)
    scanned_at = Column(DateTime, nullable=True)
    meta_json = Column(String, nullable=True)   # JSON: {width, height, make, model}
    faces = relationship("Face", back_populates="image", cascade="all, delete-orphan")


class Face(Base):
    __tablename__ = "faces"
    id = Column(Integer, primary_key=True, index=True)
    image_id = Column(Integer, ForeignKey("images.id"), nullable=False, index=True)
    bbox_json = Column(String, nullable=False)
    embedding = Column(LargeBinary, nullable=False)
    det_score = Column(Float, nullable=False)
    cluster_id = Column(Integer, ForeignKey("clusters.id"), nullable=True, index=True)
    manually_assigned = Column(Boolean, nullable=False, default=False, server_default="0")
    image = relationship("Image", back_populates="faces")
    cluster = relationship("Cluster", back_populates="faces")


class Cluster(Base):
    __tablename__ = "clusters"
    id = Column(Integer, primary_key=True, index=True)
    label = Column(Integer, nullable=False)
    person_id = Column(Integer, ForeignKey("persons.id"), nullable=True, index=True)
    faces = relationship("Face", back_populates="cluster")
    person = relationship("Person", back_populates="clusters")


class Person(Base):
    __tablename__ = "persons"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=True)
    title = Column(String, nullable=True)             # Dr., Prof., Sr., Jr., …
    last_name = Column(String, nullable=True)
    first_name = Column(String, nullable=True)
    middle_name = Column(String, nullable=True)
    nickname = Column(String, nullable=True)
    sex = Column(String, nullable=True)               # 'M' | 'F'
    birth_year = Column(Integer, nullable=True)
    birth_place = Column(String, nullable=True)
    christening_year = Column(Integer, nullable=True)
    christening_place = Column(String, nullable=True)
    death_year = Column(Integer, nullable=True)
    death_place = Column(String, nullable=True)
    burial_year = Column(Integer, nullable=True)
    burial_place = Column(String, nullable=True)
    occupation = Column(String, nullable=True)
    birth_date = Column(String, nullable=True)        # "YYYY" | "YYYY-MM" | "YYYY-MM-DD"
    death_date = Column(String, nullable=True)
    christening_date = Column(String, nullable=True)
    burial_date = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    thumbnail_face_id = Column(Integer, nullable=True)
    clusters = relationship("Cluster", back_populates="person")
    relations_as_a = relationship("Relation", foreign_keys="Relation.person_a_id", back_populates="person_a", cascade="all, delete-orphan")
    relations_as_b = relationship("Relation", foreign_keys="Relation.person_b_id", back_populates="person_b", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="person", cascade="all, delete-orphan")


class Relation(Base):
    __tablename__ = "relations"
    id = Column(Integer, primary_key=True, index=True)
    person_a_id = Column(Integer, ForeignKey("persons.id"), nullable=False)
    person_b_id = Column(Integer, ForeignKey("persons.id"), nullable=False)
    type = Column(String, nullable=False)  # 'parent' (a=szülő, b=gyerek) | 'spouse'
    marriage_year = Column(Integer, nullable=True)
    marriage_place = Column(String, nullable=True)
    divorce_year = Column(Integer, nullable=True)
    divorce_place = Column(String, nullable=True)
    person_a = relationship("Person", foreign_keys=[person_a_id], back_populates="relations_as_a")
    person_b = relationship("Person", foreign_keys=[person_b_id], back_populates="relations_as_b")


class Document(Base):
    __tablename__ = "documents"
    id = Column(Integer, primary_key=True, index=True)
    person_id = Column(Integer, ForeignKey("persons.id"), nullable=False, index=True)
    stored_name = Column(String, nullable=False)   # UUID-alapú fájlnév a lemezen
    filename = Column(String, nullable=False)       # eredeti fájlnév (megjelenítésre)
    mime_type = Column(String, nullable=True)
    title = Column(String, nullable=True)
    doc_type = Column(String, nullable=True)        # birth_cert | death_cert | ...
    year = Column(Integer, nullable=True)
    description = Column(String, nullable=True)
    created_at = Column(String, nullable=True)      # ISO timestamp
    person = relationship("Person", back_populates="documents")


def configure_engine(engine):
    """Attach WAL-mode pragma listener to a SQLAlchemy engine."""
    @event.listens_for(engine, "connect")
    def _set_pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


def init_db_schema(engine):
    """Create tables and run schema migrations for any engine."""
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        for stmt in [
            "ALTER TABLE faces ADD COLUMN manually_assigned BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE images ADD COLUMN meta_json TEXT",
            "ALTER TABLE persons ADD COLUMN death_year INTEGER",
            "ALTER TABLE persons ADD COLUMN notes TEXT",
            "ALTER TABLE persons ADD COLUMN thumbnail_face_id INTEGER",
            "ALTER TABLE persons ADD COLUMN birth_year INTEGER",
            # Name parts
            "ALTER TABLE persons ADD COLUMN title TEXT",
            "ALTER TABLE persons ADD COLUMN last_name TEXT",
            "ALTER TABLE persons ADD COLUMN first_name TEXT",
            "ALTER TABLE persons ADD COLUMN middle_name TEXT",
            "ALTER TABLE persons ADD COLUMN nickname TEXT",
            # Phase 2: extended biographical fields
            "ALTER TABLE persons ADD COLUMN sex TEXT",
            "ALTER TABLE persons ADD COLUMN birth_place TEXT",
            "ALTER TABLE persons ADD COLUMN christening_year INTEGER",
            "ALTER TABLE persons ADD COLUMN christening_place TEXT",
            "ALTER TABLE persons ADD COLUMN death_place TEXT",
            "ALTER TABLE persons ADD COLUMN burial_year INTEGER",
            "ALTER TABLE persons ADD COLUMN burial_place TEXT",
            "ALTER TABLE persons ADD COLUMN occupation TEXT",
            # Phase 3: full/partial dates stored as TEXT ("YYYY", "YYYY-MM", "YYYY-MM-DD")
            "ALTER TABLE persons ADD COLUMN birth_date TEXT",
            "ALTER TABLE persons ADD COLUMN death_date TEXT",
            "ALTER TABLE persons ADD COLUMN christening_date TEXT",
            "ALTER TABLE persons ADD COLUMN burial_date TEXT",
            # Phase 2: marriage/divorce data on relations
            "ALTER TABLE relations ADD COLUMN marriage_year INTEGER",
            "ALTER TABLE relations ADD COLUMN marriage_place TEXT",
            "ALTER TABLE relations ADD COLUMN divorce_year INTEGER",
            "ALTER TABLE relations ADD COLUMN divorce_place TEXT",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass  # column already exists

        # Back-fill _date from _year for existing rows (idempotent: only sets NULL date cols)
        for col in ("birth", "death", "christening", "burial"):
            try:
                conn.execute(text(
                    f"UPDATE persons SET {col}_date = CAST({col}_year AS TEXT) "
                    f"WHERE {col}_year IS NOT NULL AND {col}_date IS NULL"
                ))
                conn.commit()
            except Exception:
                pass

        # Documents table (Phase 2)
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS documents (
                id          INTEGER PRIMARY KEY,
                person_id   INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
                stored_name TEXT NOT NULL,
                filename    TEXT NOT NULL,
                mime_type   TEXT,
                title       TEXT,
                doc_type    TEXT,
                year        INTEGER,
                description TEXT,
                created_at  TEXT
            )
        """))
        conn.commit()

        # Schema version tracking — used for future migrations.
        # Current version: 1 (baseline with all columns above).
        conn.execute(text(
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)"
        ))
        row = conn.execute(text("SELECT version FROM schema_version")).fetchone()
        if row is None:
            conn.execute(text("INSERT INTO schema_version VALUES (1)"))
        conn.commit()

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
    dismissed = Column(Boolean, nullable=False, default=False, server_default="0")
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
    hidden_auto_events = Column(String, nullable=True)  # JSON list of suppressed auto-event types
    thumbnail_face_id = Column(Integer, nullable=True)
    clusters = relationship("Cluster", back_populates="person")
    relations_as_a = relationship("Relation", foreign_keys="Relation.person_a_id", back_populates="person_a", cascade="all, delete-orphan")
    relations_as_b = relationship("Relation", foreign_keys="Relation.person_b_id", back_populates="person_b", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="person", cascade="all, delete-orphan")
    citations = relationship("Citation", back_populates="person", cascade="all, delete-orphan")
    person_notes = relationship("PersonNote", back_populates="person", cascade="all, delete-orphan")


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
    doc_type = Column(String, nullable=True)        # key from document_types
    year = Column(Integer, nullable=True)
    description = Column(String, nullable=True)
    created_at = Column(String, nullable=True)      # ISO timestamp
    person = relationship("Person", back_populates="documents")
    source = relationship("Source", back_populates="document", uselist=False)
    linked_persons = relationship("DocumentPerson", back_populates="document", cascade="all, delete-orphan")
    document_notes = relationship("DocumentNote", back_populates="document", cascade="all, delete-orphan")


class DocumentPerson(Base):
    __tablename__ = "document_persons"
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True)
    person_id   = Column(Integer, ForeignKey("persons.id",   ondelete="CASCADE"), primary_key=True)
    role        = Column(String, nullable=True)
    document    = relationship("Document", back_populates="linked_persons")
    person      = relationship("Person")


class DocumentType(Base):
    __tablename__ = "document_types"
    id         = Column(Integer, primary_key=True, index=True)
    key        = Column(String, nullable=False, unique=True)
    label      = Column(String, nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)


class PersonNote(Base):
    __tablename__ = "person_notes"
    id = Column(Integer, primary_key=True, index=True)
    person_id = Column(Integer, ForeignKey("persons.id"), nullable=False, index=True)
    title = Column(String, nullable=True)
    content = Column(String, nullable=False, default='')
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(String, nullable=True)
    updated_at = Column(String, nullable=True)
    person = relationship("Person", back_populates="person_notes")
    note_citations = relationship("NoteCitation", back_populates="note", cascade="all, delete-orphan")


class NoteCitation(Base):
    __tablename__ = "note_citations"
    id = Column(Integer, primary_key=True, index=True)
    note_id = Column(Integer, ForeignKey("person_notes.id"), nullable=False, index=True)
    source_id = Column(Integer, ForeignKey("sources.id"), nullable=True)   # NULL for custom-text citations
    marker = Column(Integer, nullable=False)   # 1, 2, 3 … — the [n] in text
    detail = Column(String, nullable=True)     # page / timestamp / extra info
    custom_label = Column(String, nullable=True)  # free-text label when source_id is NULL
    note = relationship("PersonNote", back_populates="note_citations")
    source = relationship("Source")


class DocumentNote(Base):
    __tablename__ = "document_notes"
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    title = Column(String, nullable=True)
    content = Column(String, nullable=False, default='')
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(String, nullable=True)
    updated_at = Column(String, nullable=True)
    document = relationship("Document", back_populates="document_notes")
    note_citations = relationship("DocumentNoteCitation", back_populates="note", cascade="all, delete-orphan")


class DocumentNoteCitation(Base):
    __tablename__ = "document_note_citations"
    id = Column(Integer, primary_key=True, index=True)
    note_id = Column(Integer, ForeignKey("document_notes.id"), nullable=False, index=True)
    source_id = Column(Integer, ForeignKey("sources.id"), nullable=True)
    marker = Column(Integer, nullable=False)
    detail = Column(String, nullable=True)
    custom_label = Column(String, nullable=True)
    note = relationship("DocumentNote", back_populates="note_citations")
    source = relationship("Source")


class Source(Base):
    __tablename__ = "sources"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    source_type = Column(String, nullable=True)    # register|census|book|audio|website|oral|other
    author = Column(String, nullable=True)
    year = Column(Integer, nullable=True)
    publisher = Column(String, nullable=True)
    location = Column(String, nullable=True)
    url = Column(String, nullable=True)
    description = Column(String, nullable=True)
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(String, nullable=True)
    document = relationship("Document", back_populates="source")
    citations = relationship("Citation", back_populates="source", cascade="all, delete-orphan")


class Citation(Base):
    __tablename__ = "citations"
    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(Integer, ForeignKey("sources.id"), nullable=False, index=True)
    person_id = Column(Integer, ForeignKey("persons.id"), nullable=False, index=True)
    fact = Column(String, nullable=True)   # birth|christening|death|burial|occupation|general
    detail = Column(String, nullable=True)  # page/entry/timestamp
    notes = Column(String, nullable=True)
    source = relationship("Source", back_populates="citations")
    person = relationship("Person")


class Event(Base):
    __tablename__ = "events"
    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String, nullable=False, default="custom")
    title = Column(String, nullable=True)
    date = Column(String, nullable=True)   # ISO partial: "YYYY" | "YYYY-MM" | "YYYY-MM-DD"
    year = Column(Integer, nullable=True)
    place = Column(String, nullable=True)
    description = Column(String, nullable=True)
    created_at = Column(String, nullable=True)
    updated_at = Column(String, nullable=True)
    event_persons = relationship("EventPerson", back_populates="event", cascade="all, delete-orphan")
    event_images = relationship("EventImage", back_populates="event", cascade="all, delete-orphan")


class EventPerson(Base):
    __tablename__ = "event_persons"
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False, index=True)
    person_id = Column(Integer, ForeignKey("persons.id"), nullable=False, index=True)
    role = Column(String, nullable=False, default="participant")  # primary | participant
    featured = Column(Boolean, nullable=False, default=False)
    event = relationship("Event", back_populates="event_persons")
    person = relationship("Person")


class EventImage(Base):
    __tablename__ = "event_images"
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False, index=True)
    image_id = Column(Integer, ForeignKey("images.id"), nullable=False, index=True)
    event = relationship("Event", back_populates="event_images")
    image = relationship("Image")


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
            "ALTER TABLE faces ADD COLUMN dismissed BOOLEAN NOT NULL DEFAULT 0",
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
            # Phase 4: UI suppression of auto-generated timeline events
            "ALTER TABLE persons ADD COLUMN hidden_auto_events TEXT",
            # Phase 5: featured participant flag on event-person rows
            "ALTER TABLE event_persons ADD COLUMN featured BOOLEAN NOT NULL DEFAULT 0",
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

        # PersonNote + NoteCitation tables
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS person_notes (
                id         INTEGER PRIMARY KEY,
                person_id  INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
                title      TEXT,
                content    TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT,
                updated_at TEXT
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS note_citations (
                id           INTEGER PRIMARY KEY,
                note_id      INTEGER NOT NULL REFERENCES person_notes(id) ON DELETE CASCADE,
                source_id    INTEGER REFERENCES sources(id) ON DELETE CASCADE,
                marker       INTEGER NOT NULL,
                detail       TEXT,
                custom_label TEXT
            )
        """))
        conn.commit()

        # Migration: add custom_label + make source_id nullable (recreate table if needed)
        try:
            col_info = conn.execute(text("PRAGMA table_info(note_citations)")).mappings().all()
            col_names = {r['name'] for r in col_info}
            source_notnull = next((r['notnull'] for r in col_info if r['name'] == 'source_id'), 0)
            if 'custom_label' not in col_names or source_notnull:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS note_citations_v2 (
                        id           INTEGER PRIMARY KEY,
                        note_id      INTEGER NOT NULL REFERENCES person_notes(id) ON DELETE CASCADE,
                        source_id    INTEGER REFERENCES sources(id) ON DELETE CASCADE,
                        marker       INTEGER NOT NULL,
                        detail       TEXT,
                        custom_label TEXT
                    )
                """))
                existing_cols = ', '.join(c for c in ['id','note_id','source_id','marker','detail','custom_label'] if c in col_names)
                conn.execute(text(f"INSERT INTO note_citations_v2 ({existing_cols}) SELECT {existing_cols} FROM note_citations"))
                conn.execute(text("DROP TABLE note_citations"))
                conn.execute(text("ALTER TABLE note_citations_v2 RENAME TO note_citations"))
                conn.commit()
        except Exception:
            pass

        # Migrate old Person.notes → first PersonNote entry (idempotent)
        try:
            rows = conn.execute(text(
                "SELECT id, notes FROM persons WHERE notes IS NOT NULL AND notes != '' "
                "AND id NOT IN (SELECT DISTINCT person_id FROM person_notes)"
            )).fetchall()
            for row in rows:
                conn.execute(text(
                    "INSERT INTO person_notes (person_id, title, content, sort_order, created_at, updated_at) "
                    "VALUES (:pid, NULL, :content, 0, datetime('now'), datetime('now'))"
                ), {"pid": row[0], "content": row[1]})
            conn.commit()
        except Exception:
            pass

        # Sources + Citations tables
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sources (
                id          INTEGER PRIMARY KEY,
                title       TEXT NOT NULL,
                source_type TEXT,
                author      TEXT,
                year        INTEGER,
                publisher   TEXT,
                location    TEXT,
                url         TEXT,
                description TEXT,
                document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
                created_at  TEXT
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS citations (
                id        INTEGER PRIMARY KEY,
                source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
                fact      TEXT,
                detail    TEXT,
                notes     TEXT
            )
        """))
        conn.commit()

        # Events + participants + linked images
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS events (
                id          INTEGER PRIMARY KEY,
                event_type  TEXT NOT NULL DEFAULT 'custom',
                title       TEXT,
                date        TEXT,
                year        INTEGER,
                place       TEXT,
                description TEXT,
                created_at  TEXT,
                updated_at  TEXT
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS event_persons (
                id        INTEGER PRIMARY KEY,
                event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
                person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
                role      TEXT NOT NULL DEFAULT 'participant',
                featured  BOOLEAN NOT NULL DEFAULT 0,
                UNIQUE(event_id, person_id)
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS event_images (
                id       INTEGER PRIMARY KEY,
                event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
                image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
                UNIQUE(event_id, image_id)
            )
        """))
        conn.commit()

        # Document notes + citations
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS document_notes (
                id          INTEGER PRIMARY KEY,
                document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                title       TEXT,
                content     TEXT NOT NULL DEFAULT '',
                sort_order  INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT,
                updated_at  TEXT
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS document_note_citations (
                id           INTEGER PRIMARY KEY,
                note_id      INTEGER NOT NULL REFERENCES document_notes(id) ON DELETE CASCADE,
                source_id    INTEGER REFERENCES sources(id) ON DELETE CASCADE,
                marker       INTEGER NOT NULL,
                detail       TEXT,
                custom_label TEXT
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

        # v1 → v2: add event_id to sources
        current_version = conn.execute(text("SELECT version FROM schema_version")).fetchone()[0]
        if current_version < 2:
            try:
                conn.execute(text("ALTER TABLE sources ADD COLUMN event_id INTEGER REFERENCES events(id) ON DELETE SET NULL"))
            except Exception:
                pass
            conn.execute(text("UPDATE schema_version SET version = 2"))
            conn.commit()

        # v2 → v3: document_types + document_persons (multi-person documents)
        current_version = conn.execute(text("SELECT version FROM schema_version")).fetchone()[0]
        if current_version < 3:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS document_types (
                    id         INTEGER PRIMARY KEY,
                    key        TEXT NOT NULL UNIQUE,
                    label      TEXT NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS document_persons (
                    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                    person_id   INTEGER NOT NULL REFERENCES persons(id)   ON DELETE CASCADE,
                    role        TEXT,
                    PRIMARY KEY (document_id, person_id)
                )
            """))
            conn.commit()
            # Pre-populate default document types
            default_types = [
                ("birth_cert",    "Birth certificate",    0),
                ("death_cert",    "Death certificate",    1),
                ("marriage_cert", "Marriage certificate", 2),
                ("baptism",       "Baptism record",       3),
                ("burial_record", "Burial record",        4),
                ("passport",      "Passport",             5),
                ("military",      "Military record",      6),
                ("land_record",   "Land record",          7),
                ("will",          "Will / Testament",     8),
                ("letter",        "Letter",               9),
                ("photo",         "Photograph",           10),
                ("other",         "Document",             11),
            ]
            for key, label, order in default_types:
                try:
                    conn.execute(text(
                        "INSERT OR IGNORE INTO document_types (key, label, sort_order) VALUES (:k, :l, :o)"
                    ), {"k": key, "l": label, "o": order})
                except Exception:
                    pass
            conn.commit()
            # Migrate existing documents: copy person_id → document_persons
            try:
                conn.execute(text("""
                    INSERT OR IGNORE INTO document_persons (document_id, person_id)
                    SELECT id, person_id FROM documents WHERE person_id IS NOT NULL
                """))
            except Exception:
                pass
            conn.commit()
            conn.execute(text("UPDATE schema_version SET version = 3"))
            conn.commit()

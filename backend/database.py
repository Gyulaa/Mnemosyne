import re

from sqlalchemy import (
    Column, Integer, String, Float, LargeBinary, Boolean,
    ForeignKey, DateTime, UniqueConstraint, event, text,
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
    stable_id    = Column(String, nullable=True, index=True)   # UUID, assigned once, never changes
    content_hash = Column(String, nullable=True, index=True)   # SHA-256 hex of file content
    source_path  = Column(String, nullable=True)               # original abs path when first added
    is_private   = Column(Boolean, nullable=False, default=False, server_default="0")
    phash        = Column(Integer, nullable=True)   # 64-bit dHash for near-duplicate detection
    duplicate_of = Column(Integer, ForeignKey("images.id"), nullable=True)  # FK to original image
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
    is_private = Column(Boolean, nullable=False, default=False, server_default="0")
    faces = relationship("Face", back_populates="cluster")
    person = relationship("Person", back_populates="clusters")


class PersonSubcluster(Base):
    """Internal sub-cluster centroid for a named person.
    Computed automatically after clustering/linking; used to improve
    future centroid-matching across age-spanning face sets."""
    __tablename__ = "person_subclusters"
    id         = Column(Integer, primary_key=True, index=True)
    person_id  = Column(Integer, ForeignKey("persons.id", ondelete="CASCADE"), nullable=False, index=True)
    centroid   = Column(LargeBinary, nullable=False)   # float32 normalized embedding
    face_count = Column(Integer, nullable=False)
    year_min   = Column(Integer, nullable=True)
    year_max   = Column(Integer, nullable=True)
    person     = relationship("Person", back_populates="subclusters")


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
    religion = Column(String, nullable=True)
    nationality = Column(String, nullable=True)
    cause_of_death = Column(String, nullable=True)
    education = Column(String, nullable=True)
    birth_date = Column(String, nullable=True)        # "YYYY" | "YYYY-MM" | "YYYY-MM-DD"
    death_date = Column(String, nullable=True)
    christening_date = Column(String, nullable=True)
    burial_date = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    hidden_auto_events = Column(String, nullable=True)  # JSON list of suppressed auto-event types
    thumbnail_face_id = Column(Integer, nullable=True)
    clusters = relationship("Cluster", back_populates="person")
    subclusters = relationship("PersonSubcluster", back_populates="person", cascade="all, delete-orphan")
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
    is_private = Column(Boolean, nullable=False, default=False, server_default="0")
    person_a = relationship("Person", foreign_keys=[person_a_id], back_populates="relations_as_a")
    person_b = relationship("Person", foreign_keys=[person_b_id], back_populates="relations_as_b")


class Document(Base):
    __tablename__ = "documents"
    id = Column(Integer, primary_key=True, index=True)
    # The original single owner, kept in step with `document_persons` by hand.
    # NULL means the document belongs to the project rather than to a person —
    # a chronicle or a research memo written before anyone is linked to it.
    person_id = Column(Integer, ForeignKey("persons.id"), nullable=True, index=True)
    stored_name = Column(String, nullable=False)   # UUID-alapú fájlnév a lemezen
    filename = Column(String, nullable=False)       # eredeti fájlnév (megjelenítésre)
    mime_type = Column(String, nullable=True)
    title = Column(String, nullable=True)
    doc_type = Column(String, nullable=True)        # key from document_types
    year = Column(Integer, nullable=True)
    description = Column(String, nullable=True)
    created_at = Column(String, nullable=True)      # ISO timestamp
    is_private = Column(Boolean, nullable=False, default=False, server_default="0")
    # True for documents written inside the app (Markdown body stored as a .md
    # file in the project's documents dir, so exports/downloads work unchanged).
    is_text = Column(Boolean, nullable=False, default=False, server_default="0")
    person = relationship("Person", back_populates="documents")
    source = relationship("Source", back_populates="document", uselist=False)
    linked_persons = relationship("DocumentPerson", back_populates="document", cascade="all, delete-orphan")
    document_notes = relationship("DocumentNote", back_populates="document", cascade="all, delete-orphan")
    body_citations = relationship("DocumentCitation", back_populates="document", cascade="all, delete-orphan")
    body_images = relationship("DocumentImage", back_populates="document", cascade="all, delete-orphan")


class DocumentCitation(Base):
    """A [n] reference inside a text document's Markdown body.

    Mirrors NoteCitation/DocumentNoteCitation: source_id points at a Source
    (a document promoted to a source, an event, …), or is NULL for free-text.
    """
    __tablename__ = "document_citations"
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    source_id = Column(Integer, ForeignKey("sources.id"), nullable=True)
    marker = Column(Integer, nullable=False)
    detail = Column(String, nullable=True)
    custom_label = Column(String, nullable=True)
    document = relationship("Document", back_populates="body_citations")
    source = relationship("Source")


class DocumentImage(Base):
    """A photo from the library attached to a text document."""
    __tablename__ = "document_images"
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    image_id = Column(Integer, ForeignKey("images.id", ondelete="CASCADE"), nullable=False, index=True)
    sort_order = Column(Integer, nullable=False, default=0)
    caption = Column(String, nullable=True)
    document = relationship("Document", back_populates="body_images")
    image = relationship("Image")
    __table_args__ = (UniqueConstraint("document_id", "image_id", name="uq_document_image"),)


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
    is_private = Column(Boolean, nullable=False, default=False, server_default="0")
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
    event = relationship("Event", back_populates="source")
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
    is_private = Column(Boolean, nullable=False, default=False, server_default="0")
    event_persons = relationship("EventPerson", back_populates="event", cascade="all, delete-orphan")
    event_images = relationship("EventImage", back_populates="event", cascade="all, delete-orphan")
    source = relationship("Source", back_populates="event", uselist=False)


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


class ChatThread(Base):
    """One AI assistant conversation.

    Project-scoped (a thread about one family is meaningless in another
    project) and **never exported** — `build_export_db` deletes all three chat
    tables unconditionally, because the export copies the whole database and
    only then filters it.
    """
    __tablename__ = "chat_threads"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=True)
    provider = Column(String, nullable=True)     # 'anthropic'
    model = Column(String, nullable=True)        # model id used for this thread
    created_at = Column(String, nullable=True)   # ISO timestamp
    updated_at = Column(String, nullable=True)
    messages = relationship(
        "ChatMessage", back_populates="thread",
        cascade="all, delete-orphan", order_by="ChatMessage.id",
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("chat_threads.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String, nullable=False)        # 'user' | 'assistant'
    content = Column(String, nullable=True)
    created_at = Column(String, nullable=True)
    # Usage is recorded per assistant message so the UI can show running cost.
    input_tokens = Column(Integer, nullable=True)
    output_tokens = Column(Integer, nullable=True)
    cache_read_tokens = Column(Integer, nullable=True)
    thread = relationship("ChatThread", back_populates="messages")
    tool_calls = relationship(
        "ChatToolCall", back_populates="message",
        cascade="all, delete-orphan", order_by="ChatToolCall.id",
    )


class ChatToolCall(Base):
    """One tool invocation made while producing an assistant message.

    Persisted so the conversation can be replayed in the UI with its evidence
    trail intact — in genealogy the tool results are what make an answer
    checkable rather than merely plausible.
    """
    __tablename__ = "chat_tool_calls"
    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=False, index=True)
    tool_name = Column(String, nullable=False)
    arguments_json = Column(String, nullable=True)
    result_json = Column(String, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    is_error = Column(Boolean, nullable=False, default=False, server_default="0")
    message = relationship("ChatMessage", back_populates="tool_calls")


def configure_engine(engine):
    """Attach WAL-mode pragma listener to a SQLAlchemy engine."""
    @event.listens_for(engine, "connect")
    def _set_pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


def configure_readonly_engine(engine):
    """Attach a `query_only` pragma listener — the AI assistant's data path.

    `PRAGMA query_only=ON` makes every write on the connection fail with
    SQLITE_READONLY, which is the structural guarantee behind the read-only
    tool set. Preferred over a `mode=ro` URI because that can fail outright
    when the database is in WAL mode and needs recovery.
    """
    @event.listens_for(engine, "connect")
    def _set_pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA query_only=ON")
        cur.close()


def init_db_schema(engine):
    """Create tables and run schema migrations for any engine."""
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        for stmt in [
            "ALTER TABLE faces ADD COLUMN manually_assigned BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE faces ADD COLUMN dismissed BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE images ADD COLUMN meta_json TEXT",
            "ALTER TABLE images ADD COLUMN stable_id TEXT",
            "ALTER TABLE images ADD COLUMN content_hash TEXT",
            "ALTER TABLE images ADD COLUMN source_path TEXT",
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
            # Phase 6: additional biographical fields
            "ALTER TABLE persons ADD COLUMN religion TEXT",
            "ALTER TABLE persons ADD COLUMN nationality TEXT",
            "ALTER TABLE persons ADD COLUMN cause_of_death TEXT",
            "ALTER TABLE persons ADD COLUMN education TEXT",
            # Phase 5: featured participant flag on event-person rows
            "ALTER TABLE event_persons ADD COLUMN featured BOOLEAN NOT NULL DEFAULT 0",
            # Phase 2: marriage/divorce data on relations
            "ALTER TABLE relations ADD COLUMN marriage_year INTEGER",
            "ALTER TABLE relations ADD COLUMN marriage_place TEXT",
            "ALTER TABLE relations ADD COLUMN divorce_year INTEGER",
            "ALTER TABLE relations ADD COLUMN divorce_place TEXT",
            # Duplicate detection
            "ALTER TABLE images ADD COLUMN phash INTEGER",
            "ALTER TABLE images ADD COLUMN duplicate_of INTEGER REFERENCES images(id)",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass  # column already exists

        # Indexes for image identity columns (idempotent CREATE INDEX IF NOT EXISTS)
        for idx_stmt in [
            "CREATE INDEX IF NOT EXISTS ix_images_stable_id ON images (stable_id)",
            "CREATE INDEX IF NOT EXISTS ix_images_content_hash ON images (content_hash)",
        ]:
            try:
                conn.execute(text(idx_stmt))
                conn.commit()
            except Exception:
                pass

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

        # v3 → v4: person_subclusters for temporal-drift-aware centroid matching
        current_version = conn.execute(text("SELECT version FROM schema_version")).fetchone()[0]
        if current_version < 4:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS person_subclusters (
                    id         INTEGER PRIMARY KEY,
                    person_id  INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
                    centroid   BLOB NOT NULL,
                    face_count INTEGER NOT NULL,
                    year_min   INTEGER,
                    year_max   INTEGER
                )
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_person_subclusters_person_id ON person_subclusters(person_id)"))
            conn.execute(text("UPDATE schema_version SET version = 4"))
            conn.commit()

        # v4 → v5: is_private flag on 6 entity types
        current_version = conn.execute(text("SELECT version FROM schema_version")).fetchone()[0]
        if current_version < 5:
            for tbl_col in [
                "images ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT 0",
                "clusters ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT 0",
                "relations ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT 0",
                "documents ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT 0",
                "person_notes ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT 0",
                "events ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT 0",
            ]:
                try:
                    conn.execute(text(f"ALTER TABLE {tbl_col}"))
                    conn.commit()
                except Exception:
                    pass
            conn.execute(text("UPDATE schema_version SET version = 5"))
            conn.commit()

        # v5 → v6: in-app text documents — Markdown body, its own citations,
        # and attached library photos.
        current_version = conn.execute(text("SELECT version FROM schema_version")).fetchone()[0]
        if current_version < 6:
            try:
                conn.execute(text("ALTER TABLE documents ADD COLUMN is_text BOOLEAN NOT NULL DEFAULT 0"))
                conn.commit()
            except Exception:
                pass
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS document_citations (
                    id           INTEGER PRIMARY KEY,
                    document_id  INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                    source_id    INTEGER REFERENCES sources(id) ON DELETE CASCADE,
                    marker       INTEGER NOT NULL,
                    detail       TEXT,
                    custom_label TEXT
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS document_images (
                    id          INTEGER PRIMARY KEY,
                    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                    image_id    INTEGER NOT NULL REFERENCES images(id)    ON DELETE CASCADE,
                    sort_order  INTEGER NOT NULL DEFAULT 0,
                    caption     TEXT,
                    UNIQUE(document_id, image_id)
                )
            """))
            conn.execute(text("UPDATE schema_version SET version = 6"))
            conn.commit()

        # v6 → v7: AI assistant conversations. Project-scoped and never
        # exported — see the DELETE block at the top of build_export_db.
        current_version = conn.execute(text("SELECT version FROM schema_version")).fetchone()[0]
        if current_version < 7:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS chat_threads (
                    id         INTEGER PRIMARY KEY,
                    title      TEXT,
                    provider   TEXT,
                    model      TEXT,
                    created_at TEXT,
                    updated_at TEXT
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id                INTEGER PRIMARY KEY,
                    thread_id         INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
                    role              TEXT NOT NULL,
                    content           TEXT,
                    created_at        TEXT,
                    input_tokens      INTEGER,
                    output_tokens     INTEGER,
                    cache_read_tokens INTEGER
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS chat_tool_calls (
                    id             INTEGER PRIMARY KEY,
                    message_id     INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
                    tool_name      TEXT NOT NULL,
                    arguments_json TEXT,
                    result_json    TEXT,
                    duration_ms    INTEGER,
                    is_error       BOOLEAN NOT NULL DEFAULT 0
                )
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_chat_messages_thread_id ON chat_messages(thread_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_chat_tool_calls_message_id ON chat_tool_calls(message_id)"))
            conn.execute(text("UPDATE schema_version SET version = 7"))
            conn.commit()

        # v7 → v8: documents.person_id becomes nullable, so a document can exist
        # without belonging to anybody. SQLite cannot drop a NOT NULL with
        # ALTER TABLE, so this one needs a table rebuild — see the helper.
        current_version = conn.execute(text("SELECT version FROM schema_version")).fetchone()[0]
        if current_version < 8:
            # PRAGMA foreign_keys is silently ignored inside a transaction, and
            # the rebuild is wrong without it — so hand the work to the raw
            # DBAPI connection with nothing open on it.
            conn.commit()
            _drop_document_owner_not_null(conn.connection.dbapi_connection)
            conn.execute(text("UPDATE schema_version SET version = 8"))
            conn.commit()


def _drop_document_owner_not_null(raw) -> None:
    """Rebuild `documents` with a nullable `person_id`. Idempotent.

    SQLite has no ALTER COLUMN, so the only way to relax the constraint is the
    documented create-copy-drop-rename dance. Two details are load-bearing:

    * Foreign keys must be **off**. `document_persons.document_id` cascades, so
      dropping the old table with them on would delete every person link in the
      project instead of just the table.
    * The new DDL is derived from the stored one rather than written out here,
      so a column added to the model later is carried over instead of silently
      dropped by a hardcoded column list.
    """
    cols = raw.execute("PRAGMA table_info(documents)").fetchall()
    if not cols:
        return                                  # fresh database — create_all already made it nullable
    owner = next((c for c in cols if c[1] == "person_id"), None)
    if owner is None or not owner[3]:
        return                                  # already nullable

    ddl = raw.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='documents'"
    ).fetchone()[0]
    new_ddl = re.sub(r"(\bperson_id\s+INTEGER)\s+NOT\s+NULL", r"\1", ddl, count=1, flags=re.IGNORECASE)
    if new_ddl == ddl:
        return                                  # unrecognised DDL — leave the table alone rather than guess
    new_ddl = re.sub(r"^\s*CREATE\s+TABLE\s+[\"'`\[]?documents[\"'`\]]?",
                     "CREATE TABLE documents_rebuild", new_ddl, count=1, flags=re.IGNORECASE)

    col_list = ", ".join(f'"{c[1]}"' for c in cols)
    raw.execute("PRAGMA foreign_keys=OFF")
    # A plain RENAME would try to rewrite references to the old name across the
    # whole schema; legacy mode keeps it a rename and nothing more.
    raw.execute("PRAGMA legacy_alter_table=ON")
    try:
        raw.execute("BEGIN")
        raw.execute(new_ddl)
        raw.execute(f"INSERT INTO documents_rebuild ({col_list}) SELECT {col_list} FROM documents")
        raw.execute("DROP TABLE documents")
        raw.execute("ALTER TABLE documents_rebuild RENAME TO documents")
        raw.execute("CREATE INDEX IF NOT EXISTS ix_documents_id ON documents (id)")
        raw.execute("CREATE INDEX IF NOT EXISTS ix_documents_person_id ON documents (person_id)")
        violations = raw.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise RuntimeError(f"documents rebuild would orphan {len(violations)} row(s)")
        raw.commit()
    except Exception:
        raw.rollback()
        raise
    finally:
        raw.execute("PRAGMA legacy_alter_table=OFF")
        raw.execute("PRAGMA foreign_keys=ON")

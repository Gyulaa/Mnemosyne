import re
import uuid

from sqlalchemy import (
    Column, Integer, String, Float, LargeBinary, Boolean,
    ForeignKey, DateTime, UniqueConstraint, event, text,
)
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


def _new_stable_id() -> str:
    return str(uuid.uuid4())


# Tables whose rows travel between databases and must be recognisable on
# arrival. A local integer id means nothing in someone else's project, so a
# merge without these has to *guess* which local row an incoming one is — which
# is what the name/birth-year heuristic in `merge_import.py` does, and what it
# cannot do at all for a document. `images` had this first; the rest followed
# when sharing a branch with a relative became a round trip rather than a dump.
#
# Read by `_backfill_stable_ids` below and by `ensure_stable_ids` in
# `export_utils.py`, which fills them in on the **source** database before an
# export copy is taken — an id invented in the copy would differ on every send.
STABLE_ID_TABLES = (
    "persons", "relations", "documents", "events", "sources", "person_notes",
    "images",
)


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
    stable_id    = Column(String, nullable=True, index=True, default=_new_stable_id)  # UUID, assigned once, never changes
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
    stable_id = Column(String, nullable=True, index=True, default=_new_stable_id)  # see STABLE_ID_TABLES
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
    stable_id = Column(String, nullable=True, index=True, default=_new_stable_id)  # see STABLE_ID_TABLES
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
    stable_id = Column(String, nullable=True, index=True, default=_new_stable_id)  # see STABLE_ID_TABLES
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
    date = Column(String, nullable=True)   # ISO partial: "YYYY" | "YYYY-MM" | "YYYY-MM-DD"
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
    extra_files = relationship("DocumentFile", back_populates="document", cascade="all, delete-orphan")
    description_citations = relationship("DocumentDescriptionCitation", back_populates="document", cascade="all, delete-orphan")
    # Set when the document was imported from a transcript batch. viewonly, so
    # the ORM never writes through it: the page owns the link, and deleting the
    # document leaves the page's own ON DELETE SET NULL to clear it — the
    # transcript survives the document, which is the point.
    transcript = relationship(
        "TranscriptPage", uselist=False, viewonly=True,
        primaryjoin="Document.id == TranscriptPage.document_id",
    )


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


class DocumentDescriptionCitation(Base):
    """A [n] reference inside a document's `description` field.

    Every document has a description, not just text documents, so this is
    kept separate from DocumentCitation (which is scoped to the Markdown
    body of an in-app text document) rather than reusing it under a
    discriminator column.
    """
    __tablename__ = "document_description_citations"
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    source_id = Column(Integer, ForeignKey("sources.id"), nullable=True)
    marker = Column(Integer, nullable=False)
    detail = Column(String, nullable=True)
    custom_label = Column(String, nullable=True)
    document = relationship("Document", back_populates="description_citations")
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


class DocumentFile(Base):
    """An extra file on a document beyond its primary one.

    A single upload action can bring in several files at once — every page of
    a scanned letter, front and back of a certificate — that all belong to one
    document record rather than becoming one document each. The first file
    stays the row's own stored_name/filename/mime_type as before; the rest
    live here, ordered the way they were uploaded.
    """
    __tablename__ = "document_files"
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    stored_name = Column(String, nullable=False)
    filename = Column(String, nullable=False)
    mime_type = Column(String, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    document = relationship("Document", back_populates="extra_files")


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
    stable_id = Column(String, nullable=True, index=True, default=_new_stable_id)  # see STABLE_ID_TABLES
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
    stable_id = Column(String, nullable=True, index=True, default=_new_stable_id)  # see STABLE_ID_TABLES
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
    fact = Column(String, nullable=True)   # birth|christening|death|burial|occupation|marriage|general
    # Set when the fact belongs to a relation rather than to the person alone —
    # a marriage. Both spouses' panels then read the same citation, and
    # `person_id` records only whose screen it was entered from.
    relation_id = Column(Integer, ForeignKey("relations.id"), nullable=True, index=True)
    detail = Column(String, nullable=True)  # page/entry/timestamp
    notes = Column(String, nullable=True)
    source = relationship("Source", back_populates="citations")
    person = relationship("Person")


class Event(Base):
    __tablename__ = "events"
    id = Column(Integer, primary_key=True, index=True)
    stable_id = Column(String, nullable=True, index=True, default=_new_stable_id)  # see STABLE_ID_TABLES
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
    description_citations = relationship(
        "EventDescriptionCitation", back_populates="event", cascade="all, delete-orphan",
    )
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


class EventDescriptionCitation(Base):
    """A [n] reference inside an event's `description` field.

    The same shape as DocumentDescriptionCitation, and separate from it for the
    same reason that one is separate from DocumentCitation: the owner differs,
    so folding them together would mean a discriminator column and an
    event/document ambiguity in every query that reads one.

    Like every other citation table the FKs declare no ON DELETE action, so the
    raw-SQL paths that delete an event (`delete_person`, `build_export_db`,
    `execute_rollback`) have to clear these rows first — see the event-child
    checklist in the README. The ORM path is covered by the cascade on
    `Event.description_citations`.
    """
    __tablename__ = "event_description_citations"
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False, index=True)
    source_id = Column(Integer, ForeignKey("sources.id"), nullable=True)
    marker = Column(Integer, nullable=False)
    detail = Column(String, nullable=True)
    custom_label = Column(String, nullable=True)
    event = relationship("Event", back_populates="description_citations")
    source = relationship("Source")


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


class TranscriptBatch(Base):
    """A folder of scans being triaged before anything is imported.

    The pages a batch holds are **not** documents yet, and most of them never
    will be: a parish register folder is read to find the handful of entries
    that concern this family. So the transcript lives here, on a row that
    points at a file still sitting outside the project, and only a page the
    user picks is copied into `documents/` and given a Document row.

    Never exported — `build_export_db` drops both tables unconditionally, for
    the same reason the chat tables are dropped: they are working state about
    files that may not even belong to the project.
    """
    __tablename__ = "transcript_batches"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    folder = Column(String, nullable=True)       # source folder on disk, outside the project
    created_at = Column(String, nullable=True)
    # pending | transcribing | analysing | ready | failed
    status = Column(String, nullable=False, default="pending", server_default="pending")
    provider = Column(String, nullable=True)
    model = Column(String, nullable=True)
    analysis = Column(String, nullable=True)         # the batch-level report, Markdown
    # JSON list of the tool calls the report made against the project — what it
    # looked up, and what came back. Kept so the answer stays checkable after
    # the fact, exactly as `chat_tool_calls` does for a conversation.
    analysis_steps = Column(String, nullable=True)
    analysis_error = Column(String, nullable=True)
    analysed_at = Column(String, nullable=True)
    pages = relationship(
        "TranscriptPage", back_populates="batch",
        cascade="all, delete-orphan", order_by="TranscriptPage.sort_order",
    )
    questions = relationship(
        "TranscriptQuestion", back_populates="batch",
        cascade="all, delete-orphan", order_by="TranscriptQuestion.id",
    )


class TranscriptQuestion(Base):
    """One question asked about a batch, and the answer it got.

    Stored rather than kept in the browser, which is where it started. The
    answers name pages, and opening a page it recommended is the *first* thing
    a reader does — at which point a conversation living in component state is
    gone, along with the reason they opened the page. A record of what was asked
    is also how the tool calls stay checkable after the fact, exactly as
    `analysis_steps` does for the report.

    Working state like the rest of these tables: `build_export_db` drops it
    unconditionally. It is about a folder of files that may never belong to the
    project, and half of it is questions the user typed while deciding.
    """
    __tablename__ = "transcript_questions"
    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(Integer, ForeignKey("transcript_batches.id", ondelete="CASCADE"), index=True)
    question = Column(String, nullable=False)
    answer = Column(String, nullable=True)
    # JSON list, same shape as `analysis_steps`: what the model looked up.
    steps = Column(String, nullable=True)
    error = Column(String, nullable=True)
    created_at = Column(String, nullable=True)
    batch = relationship("TranscriptBatch", back_populates="questions")


class TranscriptPage(Base):
    """One file that has been (or is waiting to be) read by the model.

    `document_id` is NULL until the user imports the page. It is
    ON DELETE SET NULL rather than CASCADE because deleting the imported
    document should not destroy the transcript — the page simply returns to
    being an un-imported candidate.
    """
    __tablename__ = "transcript_pages"
    id = Column(Integer, primary_key=True, index=True)
    # NULL for a transcript that belongs to a document rather than to a folder
    # scan — see the v16 -> v17 migration.
    batch_id = Column(Integer, ForeignKey("transcript_batches.id", ondelete="CASCADE"), nullable=True, index=True)
    source_path = Column(String, nullable=True)   # absolute path of the file on disk
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="SET NULL"), nullable=True, index=True)
    filename = Column(String, nullable=False)
    mime_type = Column(String, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    # pending | running | done | failed
    status = Column(String, nullable=False, default="pending", server_default="pending")
    method = Column(String, nullable=True)        # 'text_layer' | 'vision'
    text = Column(String, nullable=True)          # verbatim transcript, original language
    modern_text = Column(String, nullable=True)   # modern rendering of the same
    extraction = Column(String, nullable=True)    # JSON: the register entry's fields
    language = Column(String, nullable=True)
    # Filled by the local matching pass, never by the model — see transcriber.py.
    relevance = Column(String, nullable=True)     # 'high' | 'medium' | 'low' | 'none'
    relevance_note = Column(String, nullable=True)
    # JSON: which two people, in which roles, and what relationship the record
    # and the tree agree on. Structured rather than a sentence because it has
    # to render in the user's language and link to the people it names — a
    # prose string could do neither.
    corroboration = Column(String, nullable=True)
    edited = Column(Boolean, nullable=False, default=False, server_default="0")
    error = Column(String, nullable=True)
    model = Column(String, nullable=True)
    input_tokens = Column(Integer, nullable=True)
    output_tokens = Column(Integer, nullable=True)
    created_at = Column(String, nullable=True)
    batch = relationship("TranscriptBatch", back_populates="pages")


class ShareProfile(Base):
    """A named, reusable answer to "what does this relative get?".

    `is_private` is a property of a *record*, but "who may see this" is a
    relation between a record and a recipient — one boolean cannot hold several
    of them, which is why marking people private one at a time never scaled to
    a second collaborator. A profile instead stores the *rules* that pick the
    person set (`share_filter.py` evaluates them), so the selection is made once
    and re-run on every later export.

    This is working state, not project content: it records who *else* the user
    shares with, which is nobody's business but theirs. `build_export_db`
    therefore deletes the table unconditionally, next to the chat tables.
    """
    __tablename__ = "share_profiles"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    notes = Column(String, nullable=True)
    rules_json = Column(String, nullable=False, default="{}")     # see share_filter.resolve_person_set
    options_json = Column(String, nullable=False, default="{}")   # content toggles + living policy
    last_exported_at = Column(String, nullable=True)
    last_export_counts_json = Column(String, nullable=True)
    created_at = Column(String, nullable=True)
    updated_at = Column(String, nullable=True)


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
            # v18 -> v19: cross-database identity — see STABLE_ID_TABLES.
            # `images` already had its column; the others are new here.
            *(
                f"ALTER TABLE {t} ADD COLUMN stable_id TEXT"
                for t in STABLE_ID_TABLES if t != "images"
            ),
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass  # column already exists

        # Indexes for identity columns (idempotent CREATE INDEX IF NOT EXISTS)
        for idx_stmt in [
            "CREATE INDEX IF NOT EXISTS ix_images_content_hash ON images (content_hash)",
            *(
                f"CREATE INDEX IF NOT EXISTS ix_{t}_stable_id ON {t} (stable_id)"
                for t in STABLE_ID_TABLES
            ),
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

        # v8 → v9: documents.date — a partial date (YYYY | YYYY-MM | YYYY-MM-DD)
        # alongside the existing year, mirroring events.date/events.year so a
        # document can record a month and day without losing year-based
        # sorting and filtering.
        current_version = conn.execute(text("SELECT version FROM schema_version")).fetchone()[0]
        if current_version < 9:
            try:
                conn.execute(text("ALTER TABLE documents ADD COLUMN date TEXT"))
            except Exception:
                pass
            conn.execute(text("UPDATE schema_version SET version = 9"))
            conn.commit()

        # v9 → v10: document_files — a document created from several files at
        # once (every page of a scanned letter, front and back of a
        # certificate) keeps its first file as the row's own stored_name as
        # before; the rest live in this table.
        current_version = conn.execute(text("SELECT version FROM schema_version")).fetchone()[0]
        if current_version < 10:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS document_files (
                    id          INTEGER PRIMARY KEY,
                    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                    stored_name TEXT NOT NULL,
                    filename    TEXT NOT NULL,
                    mime_type   TEXT,
                    sort_order  INTEGER NOT NULL DEFAULT 0
                )
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_document_files_document_id ON document_files(document_id)"))
            conn.execute(text("UPDATE schema_version SET version = 10"))
            conn.commit()

        # v10 → v11: document_description_citations — [n] references inside a
        # document's `description` field, kept separate from document_citations
        # (the in-app text document's Markdown body) since every document has
        # a description, not just text documents.
        current_version = conn.execute(text("SELECT version FROM schema_version")).fetchone()[0]
        if current_version < 11:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS document_description_citations (
                    id           INTEGER PRIMARY KEY,
                    document_id  INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                    source_id    INTEGER REFERENCES sources(id) ON DELETE CASCADE,
                    marker       INTEGER NOT NULL,
                    detail       TEXT,
                    custom_label TEXT
                )
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_document_description_citations_document_id ON document_description_citations(document_id)"))
            conn.execute(text("UPDATE schema_version SET version = 11"))
            conn.commit()

        # v11 → v12: transcript_batches / transcript_pages — a folder of scans
        # read by the model before anything is imported. The pages point at
        # files still outside the project, so this is working state, not
        # project content: build_export_db drops both tables.
        current_version = conn.execute(text("SELECT version FROM schema_version")).fetchone()[0]
        if current_version < 12:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS transcript_batches (
                    id             INTEGER PRIMARY KEY,
                    name           TEXT NOT NULL,
                    folder         TEXT,
                    created_at     TEXT,
                    status         TEXT NOT NULL DEFAULT 'pending',
                    provider       TEXT,
                    model          TEXT,
                    analysis       TEXT,
                    analysis_error TEXT,
                    analysed_at    TEXT
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS transcript_pages (
                    id             INTEGER PRIMARY KEY,
                    batch_id       INTEGER NOT NULL REFERENCES transcript_batches(id) ON DELETE CASCADE,
                    source_path    TEXT,
                    document_id    INTEGER REFERENCES documents(id) ON DELETE SET NULL,
                    filename       TEXT NOT NULL,
                    mime_type      TEXT,
                    sort_order     INTEGER NOT NULL DEFAULT 0,
                    status         TEXT NOT NULL DEFAULT 'pending',
                    method         TEXT,
                    text           TEXT,
                    modern_text    TEXT,
                    extraction     TEXT,
                    language       TEXT,
                    relevance      TEXT,
                    relevance_note TEXT,
                    edited         INTEGER NOT NULL DEFAULT 0,
                    error          TEXT,
                    model          TEXT,
                    input_tokens   INTEGER,
                    output_tokens  INTEGER,
                    created_at     TEXT
                )
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_transcript_pages_batch_id ON transcript_pages(batch_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_transcript_pages_document_id ON transcript_pages(document_id)"))
            conn.execute(text("UPDATE schema_version SET version = 12"))
            conn.commit()

        # v12 → v13: transcript_batches.analysis_steps — the tool calls the
        # batch report made, so its reasoning is auditable after the fact.
        current_version = conn.execute(text("SELECT version FROM schema_version")).fetchone()[0]
        if current_version < 13:
            cols = [r[1] for r in conn.execute(text("PRAGMA table_info(transcript_batches)"))]
            if "analysis_steps" not in cols:
                conn.execute(text("ALTER TABLE transcript_batches ADD COLUMN analysis_steps TEXT"))
            conn.execute(text("UPDATE schema_version SET version = 13"))
            conn.commit()

        # v13 → v14: transcript_pages.corroboration — the relationship a page
        # and the tree agree on, with the ids of the two people it names.
        current_version = conn.execute(text("SELECT version FROM schema_version")).fetchone()[0]
        if current_version < 14:
            cols = [r[1] for r in conn.execute(text("PRAGMA table_info(transcript_pages)"))]
            if "corroboration" not in cols:
                conn.execute(text("ALTER TABLE transcript_pages ADD COLUMN corroboration TEXT"))
            conn.execute(text("UPDATE schema_version SET version = 14"))
            conn.commit()

        # v14 -> v15: citations.relation_id — a marriage's sources belong to the
        # marriage, not to whichever spouse's panel they were entered from. The
        # id used to be encoded in the fact string (`marriage_<relation id>`),
        # which only the person who entered it could see and which a merge
        # import carried across verbatim, pointing it at an unrelated marriage.
        current_version = conn.execute(text("SELECT version FROM schema_version")).fetchone()[0]
        if current_version < 15:
            cols = [r[1] for r in conn.execute(text("PRAGMA table_info(citations)"))]
            if "relation_id" not in cols:
                conn.execute(text("ALTER TABLE citations ADD COLUMN relation_id INTEGER REFERENCES relations(id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_citations_relation_id ON citations(relation_id)"))
            # Only rows whose marriage still exists: nothing enforced the old
            # key, so a citation can name a relation that was deleted years
            # ago, and this connection has foreign keys ON — pointing the new
            # column at a missing row would fail the constraint and take the
            # whole startup migration with it. Such a citation was already
            # unreachable in the UI; it is left exactly as it was rather than
            # deleted, since nothing is gained by destroying it here.
            conn.execute(text(
                "UPDATE citations SET relation_id = CAST(substr(fact, 10) AS INTEGER), fact = 'marriage' "
                "WHERE substr(fact, 1, 9) = 'marriage_' AND substr(fact, 10) GLOB '[0-9]*' "
                "AND CAST(substr(fact, 10) AS INTEGER) IN (SELECT id FROM relations)"
            ))
            conn.execute(text("UPDATE schema_version SET version = 15"))
            conn.commit()

        # v15 -> v16: transcript_questions. A new *table*, so `create_all` has
        # already made it — the version bump is what records that a database
        # opened by an older build has caught up.
        current_version = conn.execute(text("SELECT version FROM schema_version")).fetchone()[0]
        if current_version < 16:
            conn.execute(text("UPDATE schema_version SET version = 16"))
            conn.commit()

        # v16 -> v17: transcript_pages.batch_id becomes nullable, so a document
        # already in the project can carry a transcript without inventing a
        # batch to hang it off. A synthetic batch would be actively dangerous:
        # batch_id is ON DELETE CASCADE, so deleting that placeholder would
        # take every document transcript with it.
        #
        # The guard is the column, not the version. The helper declines quietly
        # in two cases — no table yet, and a stored DDL it does not recognise —
        # and a version bump sitting next to it would record success either way,
        # locking the database into a state a version-only check never revisits.
        # `PRAGMA table_info` is the fact; the stored version is a claim about
        # it. Re-checking costs one PRAGMA per startup once the column is right.
        _drop_transcript_batch_not_null(conn.connection.dbapi_connection)
        current_version = conn.execute(text("SELECT version FROM schema_version")).fetchone()[0]
        if current_version < 17:
            conn.execute(text("UPDATE schema_version SET version = 17"))
            conn.commit()

        # v17 -> v18: event_description_citations, so an event description can
        # carry [n] references like a document description does. A new *table*,
        # so `create_all` has already made it — the version bump only records
        # that a database opened by an older build has caught up.
        current_version = conn.execute(text("SELECT version FROM schema_version")).fetchone()[0]
        if current_version < 18:
            conn.execute(text("UPDATE schema_version SET version = 18"))
            conn.commit()

        # v18 -> v19: `stable_id` on every table whose rows travel between
        # databases (STABLE_ID_TABLES), plus the `share_profiles` table — a new
        # *table*, so `create_all` has already made it.
        #
        # The backfill runs on **every** startup rather than once behind the
        # version check, and the guard is the data, not the stored version. A
        # row inserted by a raw-SQL path that has not learned to write a
        # `stable_id` would otherwise stay anonymous forever, and a
        # version-only check never looks at that database again. It costs one
        # indexed COUNT per table once everything is filled in.
        _backfill_stable_ids(conn)
        current_version = conn.execute(text("SELECT version FROM schema_version")).fetchone()[0]
        if current_version < 19:
            conn.execute(text("UPDATE schema_version SET version = 19"))
            conn.commit()



def _backfill_stable_ids(conn) -> int:
    """Give every row in STABLE_ID_TABLES a `stable_id`. Idempotent.

    Takes a SQLAlchemy `Connection`. Returns how many rows were filled in, which
    is 0 on every startup after the first.

    The uuid is generated per row in Python rather than in SQL because SQLite
    has no uuid function and `randomblob` would need hex-slicing per row anyway —
    and a single expression evaluated once for a whole UPDATE would give every
    row the *same* id, which is worse than none at all.
    """
    filled = 0
    for table in STABLE_ID_TABLES:
        try:
            ids = [
                r[0] for r in conn.execute(
                    text(f"SELECT id FROM {table} WHERE stable_id IS NULL")
                ).fetchall()
            ]
        except Exception:
            continue        # table or column not there yet — nothing to fill
        if not ids:
            continue
        for row_id in ids:
            conn.execute(
                text(f"UPDATE {table} SET stable_id = :sid WHERE id = :rid"),
                {"sid": _new_stable_id(), "rid": row_id},
            )
        conn.commit()
        filled += len(ids)
    return filled


def _drop_transcript_batch_not_null(raw) -> None:
    """Rebuild `transcript_pages` with a nullable `batch_id`. Idempotent.

    Same create-copy-drop-rename dance as `_drop_document_owner_not_null`, and
    the same two load-bearing details: foreign keys **off** while the old table
    is dropped, and the new DDL derived from the stored one so a column added
    to the model later is carried over rather than silently lost.
    """
    cols = raw.execute("PRAGMA table_info(transcript_pages)").fetchall()
    if not cols:
        return                                  # fresh database — create_all already made it nullable
    batch = next((c for c in cols if c[1] == "batch_id"), None)
    if batch is None or not batch[3]:
        return                                  # already nullable

    ddl = raw.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='transcript_pages'"
    ).fetchone()[0]
    new_ddl = re.sub(r"(\bbatch_id\s+INTEGER)\s+NOT\s+NULL", r"\1", ddl, count=1, flags=re.IGNORECASE)
    if new_ddl == ddl:
        return                                  # unrecognised DDL — leave the table alone rather than guess
    new_ddl = re.sub(r"^\s*CREATE\s+TABLE\s+[\"'`\[]?transcript_pages[\"'`\]]?",
                     "CREATE TABLE transcript_pages_rebuild", new_ddl, count=1, flags=re.IGNORECASE)

    col_list = ", ".join(f'"{c[1]}"' for c in cols)
    raw.execute("PRAGMA foreign_keys=OFF")
    raw.execute("PRAGMA legacy_alter_table=ON")
    try:
        raw.execute("BEGIN")
        raw.execute(new_ddl)
        raw.execute(f"INSERT INTO transcript_pages_rebuild ({col_list}) SELECT {col_list} FROM transcript_pages")
        raw.execute("DROP TABLE transcript_pages")
        raw.execute("ALTER TABLE transcript_pages_rebuild RENAME TO transcript_pages")
        raw.execute("CREATE INDEX IF NOT EXISTS ix_transcript_pages_id ON transcript_pages (id)")
        raw.execute("CREATE INDEX IF NOT EXISTS ix_transcript_pages_batch_id ON transcript_pages (batch_id)")
        raw.execute("CREATE INDEX IF NOT EXISTS ix_transcript_pages_document_id ON transcript_pages (document_id)")
        violations = raw.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise RuntimeError(f"transcript_pages rebuild would orphan {len(violations)} row(s)")
        raw.commit()
    except Exception:
        raw.rollback()
        raise
    finally:
        raw.execute("PRAGMA legacy_alter_table=OFF")
        raw.execute("PRAGMA foreign_keys=ON")

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

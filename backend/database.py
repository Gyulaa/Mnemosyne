from pathlib import Path
from sqlalchemy import (
    Column, Integer, String, Float, LargeBinary, Boolean,
    ForeignKey, DateTime, event, create_engine, text,
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker, relationship

DB_PATH = Path(__file__).parent.parent / "photo_organizer.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def _set_pragmas(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


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
    label = Column(Integer, nullable=False)  # DBSCAN label (-1 = noise)
    person_id = Column(Integer, ForeignKey("persons.id"), nullable=True, index=True)
    faces = relationship("Face", back_populates="cluster")
    person = relationship("Person", back_populates="clusters")


class Person(Base):
    __tablename__ = "persons"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=True)
    birth_year = Column(Integer, nullable=True)
    notes = Column(String, nullable=True)
    thumbnail_face_id = Column(Integer, nullable=True)  # soft ref to Face.id
    clusters = relationship("Cluster", back_populates="person")


class Relation(Base):
    __tablename__ = "relations"
    id = Column(Integer, primary_key=True, index=True)
    person_a_id = Column(Integer, ForeignKey("persons.id"), nullable=False)
    person_b_id = Column(Integer, ForeignKey("persons.id"), nullable=False)
    type = Column(String, nullable=False)  # parent/child/spouse/sibling/other


def init_db():
    Base.metadata.create_all(bind=engine)
    # Schema migrations for existing databases
    with engine.connect() as conn:
        for stmt in [
            "ALTER TABLE faces ADD COLUMN manually_assigned BOOLEAN NOT NULL DEFAULT 0",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass  # Column already exists


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

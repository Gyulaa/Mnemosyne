from pydantic import BaseModel
from typing import Optional


class ScanStartRequest(BaseModel):
    path: str
    skip_duplicates: bool = False


class ScanStatusResponse(BaseModel):
    running: bool
    processed: int
    total: int
    errors: int
    dupes_skipped: int = 0
    current_path: Optional[str] = None


class DuplicateImageInfo(BaseModel):
    id: int
    path: str
    scan_status: str
    similarity: str  # 'exact' | 'near'
    hamming_distance: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None
    exif_date: Optional[str] = None


class DuplicateGroup(BaseModel):
    original: DuplicateImageInfo
    duplicates: list[DuplicateImageInfo]


class ClusterRunRequest(BaseModel):
    eps: float = 0.4
    min_samples: int = 3
    min_det_score: float = 0.0


class ClusterResult(BaseModel):
    faces: int
    clusters: int
    noise: int


class ClusterNameRequest(BaseModel):
    person_name: str
    title: Optional[str] = None
    last_name: Optional[str] = None
    first_name: Optional[str] = None
    middle_name: Optional[str] = None
    nickname: Optional[str] = None


class FaceAssignRequest(BaseModel):
    cluster_id: int


class BatchFaceAssignRequest(BaseModel):
    face_ids: list[int]
    cluster_id: int


class CreateClusterRequest(BaseModel):
    face_ids: Optional[list[int]] = None
    person_name: Optional[str] = None
    title: Optional[str] = None
    last_name: Optional[str] = None
    first_name: Optional[str] = None
    middle_name: Optional[str] = None
    nickname: Optional[str] = None


class SourceCreate(BaseModel):
    title: str
    source_type: Optional[str] = None   # register|census|book|audio|website|oral|other
    author: Optional[str] = None
    year: Optional[int] = None
    publisher: Optional[str] = None
    location: Optional[str] = None
    url: Optional[str] = None
    description: Optional[str] = None
    document_id: Optional[int] = None
    event_id: Optional[int] = None


class SourceUpdate(BaseModel):
    title: Optional[str] = None
    source_type: Optional[str] = None
    author: Optional[str] = None
    year: Optional[int] = None
    publisher: Optional[str] = None
    location: Optional[str] = None
    url: Optional[str] = None
    description: Optional[str] = None


class CitationCreate(BaseModel):
    source_id: int
    fact: Optional[str] = None    # birth|christening|death|burial|occupation|general
    detail: Optional[str] = None  # page / entry / audio timestamp
    notes: Optional[str] = None


class PromoteToSourceRequest(BaseModel):
    title: Optional[str] = None   # defaults to document filename/title
    source_type: Optional[str] = None


class NoteCreate(BaseModel):
    title: Optional[str] = None
    content: str = ''
    sort_order: int = 0


class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    sort_order: Optional[int] = None
    is_private: Optional[bool] = None


class NoteCitationCreate(BaseModel):
    source_id: Optional[int] = None   # NULL for custom-text citations
    marker: int
    detail: Optional[str] = None
    custom_label: Optional[str] = None  # free-text label when source_id is absent


class EventCreate(BaseModel):
    event_type: str = "custom"
    title: Optional[str] = None
    date: Optional[str] = None    # ISO partial
    year: Optional[int] = None
    place: Optional[str] = None
    description: Optional[str] = None
    person_id: Optional[int] = None   # primary person (optional for standalone events)
    extra_person_ids: list[int] = []  # additional participants from photo detection


class EventUpdate(BaseModel):
    event_type: Optional[str] = None
    title: Optional[str] = None
    date: Optional[str] = None
    year: Optional[int] = None
    place: Optional[str] = None
    description: Optional[str] = None
    is_private: Optional[bool] = None


class EventImageAdd(BaseModel):
    image_id: int


class EventPersonAdd(BaseModel):
    person_id: int
    role: str = "participant"


class BulkDownloadRequest(BaseModel):
    ids: list[int]
    include_notes: bool = True


class TextDocumentCreate(BaseModel):
    """A document written inside the app rather than uploaded."""
    title: Optional[str] = None
    doc_type: Optional[str] = "other"
    year: Optional[int] = None
    description: Optional[str] = None
    content: str = ''
    person_ids: list[int] = []


class TextDocumentBody(BaseModel):
    content: str = ''


class DocumentImageAdd(BaseModel):
    image_id: int
    caption: Optional[str] = None


# ── AI assistant ──────────────────────────────────────────────────────────────

class AiSettingsUpdate(BaseModel):
    """Patch for the `ai` block in config.json.

    Omitted fields keep their stored value; `api_key=""` clears the key, which
    is how the UI disconnects. The key is write-only — no response ever carries
    it back unmasked.
    """
    provider: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None
    allow_private: Optional[bool] = None
    enabled: Optional[bool] = None
    # Only for OpenAI-compatible endpoints that are not OpenAI itself.
    base_url: Optional[str] = None


class ChatThreadCreate(BaseModel):
    title: Optional[str] = None


class ChatThreadUpdate(BaseModel):
    title: str


class ChatSendRequest(BaseModel):
    message: str
    lang: str = 'en'
    name_order: str = 'en'
    style: str = 'structured'

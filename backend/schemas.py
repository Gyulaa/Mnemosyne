from pydantic import BaseModel
from typing import Optional


class ScanStartRequest(BaseModel):
    path: str


class ScanStatusResponse(BaseModel):
    running: bool
    processed: int
    total: int
    errors: int
    current_path: Optional[str] = None


class ClusterRunRequest(BaseModel):
    eps: float = 0.4
    min_samples: int = 2
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


class NoteCitationCreate(BaseModel):
    source_id: int
    marker: int
    detail: Optional[str] = None

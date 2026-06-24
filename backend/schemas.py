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


class FaceAssignRequest(BaseModel):
    cluster_id: int


class BatchFaceAssignRequest(BaseModel):
    face_ids: list[int]
    cluster_id: int


class CreateClusterRequest(BaseModel):
    face_ids: Optional[list[int]] = None
    person_name: Optional[str] = None

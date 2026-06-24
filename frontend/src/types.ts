export interface ScanStatus {
  running: boolean
  processed: number
  total: number
  errors: number
  current_path: string | null
}

export interface Stats {
  total_images: number
  scanned: number
  no_face: number
  errors: number
  pending: number
  total_faces: number
  total_clusters: number
  noise_faces: number
  named_persons: number
}

export interface Cluster {
  id: number
  label: number
  face_count: number
  person_id: number | null
  person_name: string | null
  preview_face_ids: number[]
}

export interface FaceInfo {
  id: number
  image_id: number
  image_path: string
  bbox: number[]
  det_score: number
}

export interface SimilarFaceInfo extends FaceInfo {
  similarity: number
}

export interface Project {
  id: string
  name: string
  created: string
  is_active: boolean
}

export interface FsItem {
  name: string
  path: string
  is_drive: boolean
}

export interface FsListing {
  path: string
  parent: string | null
  items: FsItem[]
}

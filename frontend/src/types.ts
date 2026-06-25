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
  exif_date?: string | null
}

export interface ImagePerson {
  person_id: number
  person_name: string | null
  face_id: number
  cluster_id: number
}

export interface GraphNode {
  id: number
  name: string
  face_count: number
  photo_count: number
  thumbnail_face_id: number | null
  cluster_id: number | null
}

export interface GraphEdge {
  source: number
  target: number
  weight: number
  intimacy_score: number
}

export interface ConnectionsData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface ImageItem {
  id: number
  path: string
  filename: string
  folder: string
  scan_status: 'pending' | 'done' | 'no_face' | 'error'
  error_msg: string | null
  scanned_at: string | null
  exif_date: string | null
  meta_json: string | null
  face_count: number
  first_face_id: number | null
}

export interface ImagesPage {
  total: number
  page: number
  page_size: number
  status_counts: { done: number; no_face: number; error: number; pending: number }
  items: ImageItem[]
}

export interface ClusterConnection {
  person_id: number
  person_name: string
  shared_photos: number
  intimacy_score: number
  cluster_id: number | null
  thumbnail_face_id: number | null
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

export interface LinkedCluster {
  id: number
  label: number
  face_count: number
  preview_face_ids?: number[]
}

export interface PersonFull {
  id: number
  name: string | null
  birth_year: number | null
  death_year: number | null
  notes: string | null
  thumbnail_face_id: number | null
  face_count: number
  clusters: LinkedCluster[]
}

export interface Relation {
  id: number
  type: 'parent' | 'spouse' | 'sibling'
  person_a_id: number
  person_b_id: number
}

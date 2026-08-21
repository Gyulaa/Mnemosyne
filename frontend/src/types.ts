export interface ScanStatus {
  running: boolean
  processed: number
  total: number
  errors: number
  dupes_skipped: number
  current_path: string | null
}

export interface MaintenanceStatus {
  running: boolean
  removed_images: number
  removed_faces: number
}

export interface DuplicateImageInfo {
  id: number
  path: string
  scan_status: string
  similarity: string
  hamming_distance: number | null
  width: number | null
  height: number | null
  exif_date: string | null
}

export interface DuplicateGroup {
  original: DuplicateImageInfo
  duplicates: DuplicateImageInfo[]
}

export interface Stats {
  total_images: number
  scanned: number
  no_face: number
  errors: number
  pending: number
  duplicates: number
  total_faces: number
  total_clusters: number
  noise_faces: number
  named_persons: number
}

export interface Cluster {
  id: number
  label: number
  face_count: number
  dismissed_count?: number
  person_id: number | null
  person_name: string | null
  person: DocumentPersonRef | null
  preview_face_ids: number[]
  is_private?: boolean
}

export interface FaceInfo {
  id: number
  image_id: number
  image_path: string
  bbox: number[]
  det_score: number
  exif_date?: string | null
  dismissed?: boolean
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
  is_private: boolean
}

export interface ImagesPage {
  total: number
  page: number
  page_size: number
  status_counts: { done: number; no_face: number; error: number; pending: number }
  private_count: number
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
  /** Person the tree opens on, and who the assistant treats as "I". */
  default_proband_id?: number | null
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
  title: string | null
  last_name: string | null
  first_name: string | null
  middle_name: string | null
  nickname: string | null
  sex: 'M' | 'F' | null
  birth_year: number | null
  birth_place: string | null
  birth_date: string | null
  christening_year: number | null
  christening_place: string | null
  christening_date: string | null
  death_year: number | null
  death_place: string | null
  death_date: string | null
  burial_year: number | null
  burial_place: string | null
  burial_date: string | null
  occupation: string | null
  religion: string | null
  nationality: string | null
  cause_of_death: string | null
  education: string | null
  notes: string | null
  hidden_auto_events: string[]
  thumbnail_face_id: number | null
  face_count: number
  clusters: LinkedCluster[]
}

export interface Relation {
  id: number
  type: 'parent' | 'spouse' | 'sibling'
  person_a_id: number
  person_b_id: number
  marriage_year: number | null
  marriage_place: string | null
  divorce_year: number | null
  divorce_place: string | null
  is_private: boolean
}

/** Linked-person stub on a document — carries name parts so the UI can honour the name-order setting. */
export interface DocumentPersonRef {
  id: number
  name: string | null
  title: string | null
  first_name: string | null
  middle_name: string | null
  last_name: string | null
}

export interface DocumentImageRef {
  id: number
  image_id: number
  image_path: string | null
  caption: string | null
  sort_order: number
}

/** An extra file on a document beyond its primary one — e.g. page 2 of a scanned letter. */
export interface DocumentFileRef {
  id: number
  filename: string
  mime_type: string | null
  sort_order: number
}

export interface PersonDocument {
  id: number
  /** Original single owner; null when the document belongs to no one. See `persons`. */
  person_id: number | null
  stored_name: string
  filename: string
  mime_type: string | null
  title: string | null
  doc_type: string | null
  year: number | null
  /** ISO partial: "YYYY" | "YYYY-MM" | "YYYY-MM-DD" — the document's own date, kept in sync with `year`. */
  date: string | null
  description: string | null
  created_at: string | null
  is_private: boolean
  /** Written inside the app: Markdown body, editable in the text editor. */
  is_text: boolean
  source_id: number | null
  persons: DocumentPersonRef[]
  /** [n] references in the Markdown body — text documents only. */
  citations: NoteCitation[]
  /** Library photos attached to the body — text documents only. */
  images: DocumentImageRef[]
  /** Extra files beyond the primary one, from a multi-file upload. */
  files: DocumentFileRef[]
  /** [n] references in the `description` field. */
  description_citations: NoteCitation[]
}

export interface DocumentType {
  id: number
  key: string
  label: string
  sort_order: number
}

export interface Source {
  id: number
  title: string
  source_type: string | null  // register|census|book|audio|website|oral|other
  author: string | null
  year: number | null
  publisher: string | null
  location: string | null
  url: string | null
  description: string | null
  document_id: number | null
  event_id: number | null
  created_at: string | null
  citation_count: number
}

export interface NoteCitation {
  id: number
  note_id: number
  source_id: number | null
  marker: number
  detail: string | null
  custom_label: string | null
  source_title: string | null
  source_type: string | null
  source_document_id: number | null
  source_event_id: number | null
  source_year: number | null
  source_author: string | null
}

export interface PersonNote {
  id: number
  person_id: number
  title: string | null
  content: string
  sort_order: number
  created_at: string | null
  updated_at: string | null
  is_private: boolean
  citations: NoteCitation[]
}

export interface DocumentNote {
  id: number
  document_id: number
  title: string | null
  content: string
  sort_order: number
  created_at: string | null
  updated_at: string | null
  citations: NoteCitation[]
}

export interface Citation {
  id: number
  source_id: number
  person_id: number
  fact: string | null   // birth|christening|death|burial|occupation|general
  detail: string | null
  notes: string | null
  source_title: string | null
  source_type: string | null
  source_document_id: number | null
  source_year: number | null
  source_author: string | null
}

export interface EventPerson {
  id: number           // event_persons.id
  person_id: number
  role: string         // primary | participant
  featured: boolean
  person_name: string | null
  thumbnail_face_id: number | null
  /** Face cropped from this event's own photos; null if the person isn't
   *  recognised in any of them. Prefer this over thumbnail_face_id on chips. */
  event_face_id: number | null
}

export interface EventImage {
  id: number           // event_images.id
  image_id: number
  image_path: string | null
  first_face_id: number | null
}

// ── GEDCOM import ─────────────────────────────────────────────────────────────

export type GedcomImportAction = 'merge' | 'create' | 'skip'

export interface GedcomImportMatch {
  id: number
  name: string
  birth_year: number | null
  confidence: 'exact' | 'high' | 'low'
}

export interface GedcomImportPersonRelative {
  role: 'parent' | 'spouse' | 'child'
  name: string
}

export interface GedcomImportPerson {
  xref: string
  name: string | null
  first_name: string | null
  last_name: string | null
  birth_year: number | null
  birth_place: string | null
  death_year: number | null
  sex: 'M' | 'F' | null
  events_count: number
  notes_count: number
  docs_count: number
  relatives: GedcomImportPersonRelative[]
  suggested_match: GedcomImportMatch | null
  action: GedcomImportAction
  merge_with_id: number | null
}

export interface GedcomPreview {
  token: string
  persons: GedcomImportPerson[]
  relations_count: number
  events_count: number
  sources_count: number
  notes_count: number
  documents_count: number
}

export interface GedcomImportDecision {
  xref: string
  action: GedcomImportAction
  merge_with_id: number | null
}

export interface GedcomImportStats {
  persons_created: number
  persons_merged: number
  persons_skipped: number
  relations_added: number
  events_added: number
  sources_added: number
  notes_added: number
  documents_added: number
  rollback_available?: boolean
}

export interface GedcomRollbackStatus {
  available: boolean
  expires_in_seconds?: number
}

// ── ZIP merge import ──────────────────────────────────────────────────────────

export type MergeAction = 'merge' | 'create' | 'skip'

export interface MergeMatchSuggestion {
  id: number
  name: string | null
  first_name: string | null
  last_name: string | null
  birth_year: number | null
  confidence: 'exact' | 'high' | 'low'
  match_source?: 'name' | 'family'
  context_conflict?: boolean
}

export interface MergePersonEntry {
  incoming_id: number
  name: string | null
  first_name: string | null
  last_name: string | null
  birth_year: number | null
  death_year: number | null
  sex: 'M' | 'F' | null
  occupation: string | null
  birth_place: string | null
  suggested_match: MergeMatchSuggestion | null
  action: MergeAction
  merge_with_id: number | null
  new_fields: Record<string, unknown>
  context_status: 'confirmed' | 'conflict' | 'none'
  incoming_family: { role: string; name: string; birth_year: number | null }[]
}

export interface MergePreviewResponse {
  token: string
  persons: MergePersonEntry[]
  relations_count: number
  events_count: number
  documents_count: number
  notes_count: number
  sources_count?: number
  images_count?: number
  clusters_count?: number
}

export interface MergeDecision {
  incoming_id: number
  action: MergeAction
  merge_with_id: number | null
}

export interface MergeOptions {
  include_documents: boolean
  include_events: boolean
  include_sources: boolean
  merge_strategy: 'fill_missing' | 'incoming_priority'
  include_images: boolean
}

export interface MergeStats {
  persons_created: number
  persons_merged: number
  persons_skipped: number
  relations_added: number
  events_added: number
  documents_added: number
  sources_added?: number
  rollback_available?: boolean
  images_imported?: number
  clusters_linked?: number
}

export interface PersonEvent {
  id: number
  event_type: string   // custom|military|education|emigration|immigration|occupation|award|religious|travel
  title: string | null
  date: string | null  // ISO partial
  year: number | null
  place: string | null
  description: string | null
  created_at: string | null
  updated_at: string | null
  is_private: boolean
  source_id: number | null
  persons: EventPerson[]
  images: EventImage[]
}

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'up_to_date' | 'dev_build' | 'update_available' | 'downloading' | 'ready' | 'applying' | 'error'
  current_version: string
  latest_version: string | null
  release_name: string | null
  release_url: string | null
  download_url: string | null
  downloaded: number
  total: number
  zip_path: string | null
  error: string | null
}


// ── AI assistant ──────────────────────────────────────────────────────────────

export interface AiModel {
  id: string
  provider: string
  label: string
  note?: string
  /** True for models the bundled manifest describes; false for ones only the
   *  provider reported, which carry fallback capabilities. */
  curated?: boolean
  caps: {
    tools: boolean
    vision: boolean
    streaming: boolean
    prompt_cache: boolean
    context: number
    max_output: number
  }
  pricing?: { in: number; out: number; cache_read?: number; cache_write?: number }
}

export interface AiModelCatalog {
  provider: string
  models: AiModel[]
  providers: AiProvider[]
  default: string
  /** When the live list was last fetched from the provider; null if never. */
  fetched_at: string | null
  /** True once a live list exists — false means these are manifest defaults. */
  live: boolean
  /** Set when a refresh was attempted and failed; the cached list still shows. */
  error: string | null
}

export interface AiProvider {
  id: string
  label: string
  default_model: string
  key_hint?: string
  console?: string
}

export interface AiSettings {
  provider: string
  model: string
  /** Masked for display only — the raw key never leaves the backend. */
  api_key_masked: string
  configured: boolean
  /** Which providers already have a key stored, so switching is one click. */
  configured_providers: Record<string, boolean>
  providers: AiProvider[]
  allow_private: boolean
  enabled: boolean
  caps: AiModel['caps']
}

export interface ChatThread {
  id: number
  title: string | null
  provider: string | null
  model: string | null
  created_at: string | null
  updated_at: string | null
}

export interface ChatToolCall {
  id: number | string
  name: string
  input: Record<string, unknown>
  result: unknown
  duration_ms: number | null
  is_error: boolean
}

export interface ChatMessage {
  id: number
  thread_id: number
  role: 'user' | 'assistant'
  content: string
  created_at: string | null
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  tool_calls: ChatToolCall[]
}

/** One SSE frame from POST /api/ai/threads/{id}/stream. */
export type ChatStreamEvent =
  | { type: 'user_saved'; message_id: number; title: string | null }
  | { type: 'text'; text: string }
  | { type: 'tool_start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; id: string; name: string; result: unknown; duration_ms: number; is_error: boolean }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string; kind: string; retryable: boolean }
  | { type: 'saved'; message_id: number }
  | { type: 'done'; usage: { input: number; output: number; cache_read: number; cache_write: number }; failed: boolean; estimated_cost_usd: number | null }

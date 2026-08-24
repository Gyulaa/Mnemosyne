import type { ScanStatus, MaintenanceStatus, Stats, Cluster, FaceInfo, SimilarFaceInfo, Project, ConnectionsData, ClusterConnection, ImageItem, ImagesPage, FsListing, PersonFull, Relation, ImagePerson, LinkedCluster, PersonDocument, DocumentType, Source, Citation, PersonNote, DocumentNote, NoteCitation, PersonEvent, GedcomPreview, GedcomImportDecision, GedcomImportStats, GedcomRollbackStatus, MergePreviewResponse, MergeDecision, MergeOptions, MergeStats, UpdateStatus, DuplicateGroup, AiSettings, AiModel, AiModelCatalog, AiProvider, WebResearchSettings, ChatThread, ChatMessage, ChatStreamEvent, DocumentAiSettings, TranscriptBatch, TranscriptBatchDetail, TranscriptPageFull, TranscriptStatus, TranscriptQuestion, PlaceUsage, FieldValueMap } from './types'

const BASE = '/api'

/**
 * Hand a URL to the browser's native download manager.
 * The server sends Content-Disposition: attachment, so this streams to disk
 * instead of navigating away — no memory ceiling, and the browser owns the
 * progress bar and cancel button.
 */
export function downloadViaBrowser(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(body || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

const post = <T>(url: string, body?: unknown) =>
  fetchJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

const patch = <T>(url: string, body?: unknown) =>
  fetchJson<T>(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

const put = <T>(url: string, body?: unknown) =>
  fetchJson<T>(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

export const api = {
  scan: {
    start: (path: string, skipDuplicates = false) =>
      post(`${BASE}/scan/start`, { path, skip_duplicates: skipDuplicates }),
    stop:  () => post(`${BASE}/scan/stop`),
    status: () => fetchJson<ScanStatus>(`${BASE}/scan/status`),
    maintenanceStatus: () => fetchJson<MaintenanceStatus>(`${BASE}/maintenance/status`),
    duplicateGroups: () => fetchJson<DuplicateGroup[]>(`${BASE}/images/duplicate-groups`),
    resolveDuplicate: (imageId: number, action: 'keep' | 'dismiss' | 'delete') =>
      post<{ ok: boolean; action: string }>(`${BASE}/images/${imageId}/resolve-duplicate?action=${action}`),
    importFiles: async (files: File[]): Promise<{ ok: boolean; count: number; path: string }> => {
      const fd = new FormData()
      for (const f of files) fd.append('files', f)
      const res = await fetch(`${BASE}/scan/import-files`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  },
  cluster: {
    run: (eps: number, minSamples: number, minDetScore = 0) =>
      post<{ faces: number; clusters: number; noise: number }>(
        `${BASE}/cluster/run`,
        { eps, min_samples: minSamples, min_det_score: minDetScore },
      ),
    list:  () => fetchJson<Cluster[]>(`${BASE}/clusters`),
    faces: (id: number, sort = 'id_asc') => fetchJson<FaceInfo[]>(`${BASE}/clusters/${id}/faces?sort=${sort}`),
    rename: (id: number, name: string, parts?: { title?: string | null; last_name?: string | null; first_name?: string | null; middle_name?: string | null; nickname?: string | null }) =>
      patch<{ ok: boolean; person_id: number | null; person_name: string | null }>(
        `${BASE}/clusters/${id}`,
        { person_name: name, ...parts },
      ),
    delete: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/clusters/${id}`, { method: 'DELETE' }),
    batchDelete: (ids: number[]) =>
      post<{ ok: boolean; count: number }>(`${BASE}/clusters/batch-delete`, { cluster_ids: ids }),
    create: (faceIds?: number[], personName?: string, nameParts?: { title?: string | null; last_name?: string | null; first_name?: string | null; middle_name?: string | null; nickname?: string | null }) =>
      post<{ ok: boolean; cluster_id: number; label: number; person_id: number | null; person_name: string | null }>(
        `${BASE}/clusters`,
        { face_ids: faceIds ?? null, person_name: personName ?? null, ...nameParts },
      ),
    mergeInto: (sourceId: number, targetId: number) =>
      post<{ ok: boolean; target_cluster_id: number }>(
        `${BASE}/clusters/${sourceId}/merge-into/${targetId}`,
      ),
    linkPerson: (clusterId: number, personId: number | null) =>
      post<{ ok: boolean; person_id: number | null; person_name: string | null }>(
        `${BASE}/clusters/${clusterId}/link-person`,
        { person_id: personId },
      ),
    unlinked: () => fetchJson<LinkedCluster[]>(`${BASE}/clusters/unnamed`),
    similarNoise: (id: number, limit = 20, threshold = 0.5) =>
      fetchJson<SimilarFaceInfo[]>(
        `${BASE}/clusters/${id}/similar-noise?limit=${limit}&threshold=${threshold}`,
      ),
    split: (id: number, eps: number, minSamples = 2) =>
      post<{ ok: boolean; sub_clusters: number; kept_in_original: number; noise_moved: number; new_clusters: { cluster_id: number; face_count: number }[]; message?: string }>(
        `${BASE}/clusters/${id}/split?eps=${eps}&min_samples=${minSamples}`,
      ),
    connections: (id: number) =>
      fetchJson<ClusterConnection[]>(`${BASE}/clusters/${id}/connections`),
    togglePrivacy: (id: number, isPrivate: boolean) =>
      patch<{ ok: boolean; is_private: boolean }>(`${BASE}/clusters/${id}/privacy`, { is_private: isPrivate }),
  },
  face: {
    assign: (faceId: number, clusterId: number) =>
      patch<{ ok: boolean }>(`${BASE}/faces/${faceId}`, { cluster_id: clusterId }),
    batchAssign: (faceIds: number[], clusterId: number) =>
      post<{ ok: boolean; count: number }>(
        `${BASE}/faces/batch-assign`,
        { face_ids: faceIds, cluster_id: clusterId },
      ),
    batchUnclassify: (faceIds: number[]) =>
      post<{ ok: boolean; count: number }>(
        `${BASE}/faces/batch-unclassify`,
        { face_ids: faceIds },
      ),
    batchDismiss: (faceIds: number[]) =>
      post<{ ok: boolean; count: number }>(
        `${BASE}/faces/batch-dismiss`,
        { face_ids: faceIds },
      ),
    batchRestore: (faceIds: number[]) =>
      post<{ ok: boolean; count: number }>(
        `${BASE}/faces/batch-restore`,
        { face_ids: faceIds },
      ),
    batchDelete: (faceIds: number[]) =>
      post<{ ok: boolean; count: number }>(
        `${BASE}/faces/batch-delete`,
        { face_ids: faceIds },
      ),
  },
  project: {
    list:     () => fetchJson<Project[]>(`${BASE}/projects`),
    active:   () => fetchJson<Project>(`${BASE}/projects/active`),
    create:   (name: string) => post<Project>(`${BASE}/projects`, { name }),
    activate: (id: string) => post<Project>(`${BASE}/projects/${encodeURIComponent(id)}/activate`),
    rename:   (id: string, name: string) => patch<Project>(`${BASE}/projects/${encodeURIComponent(id)}`, { name }),
    setDefaultProband: (id: string, personId: number | null) =>
      patch<Project>(`${BASE}/projects/${encodeURIComponent(id)}`, { default_proband_id: personId }),
    delete:   (id: string) =>
      fetchJson<{ ok: boolean; new_active: import('./types').Project | null }>(`${BASE}/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    exportZip: async (
      clusterIds?: number[],
      name?: string,
      includeGenealogy = true,
      personIds?: number[],
      includeFaceless = true,
      includeNotes = true,
      includeSources = true,
      includeEvents = true,
      includeDocuments = true,
      includeImages = true,
      signal?: AbortSignal,
    ): Promise<Blob> => {
      const p = new URLSearchParams()
      if (clusterIds?.length) p.set('cluster_ids', clusterIds.join(','))
      if (personIds?.length) p.set('person_ids', personIds.join(','))
      if (name) p.set('name', name)
      if (!includeGenealogy) p.set('include_genealogy', 'false')
      if (!includeFaceless) p.set('include_faceless', 'false')
      if (!includeNotes) p.set('include_notes', 'false')
      if (!includeSources) p.set('include_sources', 'false')
      if (!includeEvents) p.set('include_events', 'false')
      if (!includeDocuments) p.set('include_documents', 'false')
      if (!includeImages) p.set('include_images', 'false')
      const res = await fetch(`${BASE}/projects/export?${p}`, { signal })
      if (!res.ok) throw new Error(await res.text())
      return res.blob()
    },
    /**
     * Build the export URL for a native browser download.
     * Multi-GB archives must NOT go through fetch()+blob(): the whole body would
     * be buffered in browser memory and blow past Chrome's blob quota
     * ("TypeError: Failed to fetch"). Navigating instead lets the browser stream
     * straight to disk with its own progress UI and cancel button.
     */
    exportUrl: (
      clusterIds?: number[],
      name?: string,
      includeGenealogy = true,
      personIds?: number[],
      includeFaceless = true,
      includeNotes = true,
      includeSources = true,
      includeEvents = true,
      includeDocuments = true,
      includeImages = true,
      /** The source photographs of every transcript batch. Off by default —
       *  they are the largest thing an archive can carry. */
      includeScans = false,
    ): string => {
      const p = new URLSearchParams()
      if (clusterIds?.length) p.set('cluster_ids', clusterIds.join(','))
      if (personIds?.length) p.set('person_ids', personIds.join(','))
      if (name) p.set('name', name)
      if (!includeGenealogy) p.set('include_genealogy', 'false')
      if (!includeFaceless) p.set('include_faceless', 'false')
      if (!includeNotes) p.set('include_notes', 'false')
      if (!includeSources) p.set('include_sources', 'false')
      if (!includeEvents) p.set('include_events', 'false')
      if (!includeDocuments) p.set('include_documents', 'false')
      if (!includeImages) p.set('include_images', 'false')
      if (includeScans) p.set('include_scans', 'true')
      return `${BASE}/projects/export?${p}`
    },
    exportGedcom: async (opts?: {
      photoMode?: 'none' | 'primary' | 'all'
      includeDocuments?: boolean
      includeEvents?: boolean
      includeSources?: boolean
      includeNotes?: boolean
    }, signal?: AbortSignal): Promise<Blob> => {
      const p = new URLSearchParams()
      if (opts?.photoMode) p.set('photo_mode', opts.photoMode)
      if (opts?.includeDocuments === false) p.set('include_documents', 'false')
      if (opts?.includeEvents === false) p.set('include_events', 'false')
      if (opts?.includeSources === false) p.set('include_sources', 'false')
      if (opts?.includeNotes === false) p.set('include_notes', 'false')
      const qs = p.toString()
      const res = await fetch(`${BASE}/export/gedcom${qs ? `?${qs}` : ''}`, { signal })
      if (!res.ok) throw new Error(await res.text())
      return res.blob()
    },
    previewGedcomImport: async (file: File): Promise<GedcomPreview> => {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${BASE}/import/gedcom/preview`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    confirmGedcomImport: async (token: string, decisions: GedcomImportDecision[], options?: Record<string, boolean>): Promise<GedcomImportStats> => {
      const res = await fetch(`${BASE}/import/gedcom/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, decisions, options: options ?? {} }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    rollbackGedcomImport: async (): Promise<{ ok: boolean; deleted: Record<string, number> }> => {
      const res = await fetch(`${BASE}/import/gedcom/rollback`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    gedcomRollbackStatus: (): Promise<GedcomRollbackStatus> =>
      fetchJson<GedcomRollbackStatus>(`${BASE}/import/gedcom/rollback-status`),
    importZip: async (file: File): Promise<Project & { images_reused: number; images_new: number }> => {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${BASE}/projects/import`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    previewMerge: async (file: File): Promise<MergePreviewResponse> => {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${BASE}/import/merge/preview`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    confirmMerge: async (token: string, decisions: MergeDecision[], options: MergeOptions): Promise<MergeStats> => {
      const res = await fetch(`${BASE}/import/merge/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, decisions, options }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    rollbackMerge: async (): Promise<{ ok: boolean; deleted: Record<string, number> }> => {
      const res = await fetch(`${BASE}/import/gedcom/rollback`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  },
  connections: {
    get: (minPhotos = 1) =>
      fetchJson<ConnectionsData>(`${BASE}/connections?min_photos=${minPhotos}`),
  },
  images: {
    list: (page: number, pageSize: number, filter: string, search: string, sort = 'id_desc', includePersonIds: number[] = [], excludePersonIds: number[] = [], includeMode: 'or' | 'and' = 'or') => {
      const p = new URLSearchParams({
        page: String(page), page_size: String(pageSize), filter, search, sort, include_mode: includeMode,
      })
      if (includePersonIds.length) p.set('include_person_ids', includePersonIds.join(','))
      if (excludePersonIds.length) p.set('exclude_person_ids', excludePersonIds.join(','))
      return fetchJson<ImagesPage>(`${BASE}/images?${p}`)
    },
    exportZip: async (filter: string, search: string, sort: string, includePersonIds: number[], excludePersonIds: number[], includeMode: string, signal?: AbortSignal): Promise<Blob> => {
      const p = new URLSearchParams({ filter, search, sort, include_mode: includeMode })
      if (includePersonIds.length) p.set('include_person_ids', includePersonIds.join(','))
      if (excludePersonIds.length) p.set('exclude_person_ids', excludePersonIds.join(','))
      const res = await fetch(`${BASE}/images/export-zip?${p}`, { signal })
      if (!res.ok) throw new Error(await res.text())
      return res.blob()
    },
    exportSelectedZip: async (imageIds: number[], signal?: AbortSignal): Promise<Blob> => {
      const p = new URLSearchParams({ image_ids: imageIds.join(',') })
      const res = await fetch(`${BASE}/images/export-zip?${p}`, { signal })
      if (!res.ok) throw new Error(await res.text())
      return res.blob()
    },
    /** Export URL for a native browser download — see project.exportUrl. */
    exportUrl: (filter: string, search: string, sort: string, includePersonIds: number[], excludePersonIds: number[], includeMode: string): string => {
      const p = new URLSearchParams({ filter, search, sort, include_mode: includeMode })
      if (includePersonIds.length) p.set('include_person_ids', includePersonIds.join(','))
      if (excludePersonIds.length) p.set('exclude_person_ids', excludePersonIds.join(','))
      return `${BASE}/images/export-zip?${p}`
    },
    delete: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/images/${id}`, { method: 'DELETE' }),
    bulkDelete: (ids: number[]) =>
      post<{ ok: boolean; count: number }>(`${BASE}/images/bulk-delete`, { image_ids: ids }),
    get: (id: number) =>
      fetchJson<ImageItem>(`${BASE}/images/${id}`),
    persons: (id: number) =>
      fetchJson<ImagePerson[]>(`${BASE}/images/${id}/persons`),
    withEvents: () =>
      fetchJson<number[]>(`${BASE}/images/with-events`),
    togglePrivacy: (id: number, isPrivate: boolean) =>
      patch<{ ok: boolean; is_private: boolean }>(`${BASE}/images/${id}/privacy`, { is_private: isPrivate }),
  },
  stats: () => fetchJson<Stats>(`${BASE}/stats`),
  fs: {
    list: (path: string) =>
      fetchJson<FsListing>(`${BASE}/fs/list?path=${encodeURIComponent(path)}`),
  },
  persons: {
    list: () => fetchJson<PersonFull[]>(`${BASE}/persons`),
    create: (fields: Partial<Omit<PersonFull, 'id' | 'thumbnail_face_id' | 'face_count' | 'clusters'>> & { name: string }) =>
      post<PersonFull>(`${BASE}/persons`, fields),
    update: (id: number, patch: Partial<Omit<PersonFull, 'id' | 'thumbnail_face_id' | 'face_count' | 'clusters'>>) =>
      fetchJson<PersonFull>(`${BASE}/persons/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    delete: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/persons/${id}`, { method: 'DELETE' }),
    mergeInto: (sourceId: number, targetId: number) =>
      post<PersonFull>(`${BASE}/persons/${sourceId}/merge-into/${targetId}`),
  },
  relations: {
    list: () => fetchJson<Relation[]>(`${BASE}/relations`),
    create: (type: 'parent' | 'spouse' | 'sibling', person_a_id: number, person_b_id: number) =>
      post<Relation>(`${BASE}/relations`, { type, person_a_id, person_b_id }),
    update: (id: number, fields: Partial<Pick<Relation, 'marriage_year' | 'marriage_place' | 'divorce_year' | 'divorce_place'>>) =>
      patch<Relation>(`${BASE}/relations/${id}`, fields),
    togglePrivacy: (id: number, isPrivate: boolean) =>
      patch<Relation>(`${BASE}/relations/${id}`, { is_private: isPrivate }),
    delete: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/relations/${id}`, { method: 'DELETE' }),
  },
  places: {
    /** Every place the project uses, most-used first. Filtered client-side. */
    list: () => fetchJson<PlaceUsage[]>(`${BASE}/places`),
  },
  fieldValues: {
    /** Values already used in the registered vocabulary fields, all at once. */
    list: () => fetchJson<FieldValueMap>(`${BASE}/field-values`),
  },
  documents: {
    listAll: () => fetchJson<PersonDocument[]>(`${BASE}/documents`),
    list: (personId: number) => fetchJson<PersonDocument[]>(`${BASE}/persons/${personId}/documents`),
    /**
     * Upload one or more files as a single document. An empty `personIds`
     * stores it as a document of the project itself. Several files become one
     * document with the first as its primary file and the rest as `files` —
     * every page of a scanned letter uploaded together, for instance.
     */
    upload: async (personIds: number[], files: File[], meta: { title?: string; doc_type?: string; year?: number; date?: string; description?: string }): Promise<PersonDocument> => {
      const fd = new FormData()
      for (const f of files) fd.append('files', f)
      fd.append('person_ids', personIds.join(','))
      if (meta.title) fd.append('title', meta.title)
      if (meta.doc_type) fd.append('doc_type', meta.doc_type)
      if (meta.year != null) fd.append('year', String(meta.year))
      if (meta.date) fd.append('date', meta.date)
      if (meta.description) fd.append('description', meta.description)
      const res = await fetch(`${BASE}/documents/upload`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    update: (id: number, fields: Partial<Pick<PersonDocument, 'title' | 'doc_type' | 'year' | 'date' | 'description'>>) =>
      patch<PersonDocument>(`${BASE}/documents/${id}`, fields),
    /**
     * Read one of this document's files with the vision model and append the
     * text to its description. `fileId` names an extra file; omitted means the
     * primary one.
     *
     * The reading is already saved when this returns — it cost a page of the
     * month's budget and must not depend on a modal being saved afterwards. The
     * `text` is handed back as well so a caller holding an unsaved draft can
     * append to that instead of overwriting it.
     */
    transcribe: (id: number, opts: { fileId?: number | null; lang?: string } = {}) =>
      post<{ document: PersonDocument; text: string }>(`${BASE}/documents/${id}/transcribe`, {
        file_id: opts.fileId ?? null, lang: opts.lang ?? 'en',
      }),
    /** Create a document written in-app; its Markdown body is stored as a .md file. */
    createText: (fields: {
      title?: string; doc_type?: string; year?: number; date?: string; description?: string
      content: string; person_ids: number[]
    }) => post<PersonDocument>(`${BASE}/documents/text`, fields),
    getText: (id: number) =>
      fetchJson<{ id: number; content: string }>(`${BASE}/documents/${id}/text`),
    saveText: (id: number, content: string) =>
      put<{ id: number; content: string }>(`${BASE}/documents/${id}/text`, { content }),
    addCitation: (docId: number, fields: { source_id?: number; marker: number; detail?: string; custom_label?: string }) =>
      post<NoteCitation>(`${BASE}/documents/${docId}/citations`, fields),
    deleteCitation: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/document-citations/${id}`, { method: 'DELETE' }),
    addDescriptionCitation: (docId: number, fields: { source_id?: number; marker: number; detail?: string; custom_label?: string }) =>
      post<NoteCitation>(`${BASE}/documents/${docId}/description-citations`, fields),
    deleteDescriptionCitation: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/document-description-citations/${id}`, { method: 'DELETE' }),
    addImage: (docId: number, imageId: number) =>
      post<PersonDocument>(`${BASE}/documents/${docId}/images`, { image_id: imageId }),
    removeImage: (docId: number, imageId: number) =>
      fetchJson<PersonDocument>(`${BASE}/documents/${docId}/images/${imageId}`, { method: 'DELETE' }),
    togglePrivacy: (id: number, isPrivate: boolean) =>
      patch<PersonDocument>(`${BASE}/documents/${id}`, { is_private: isPrivate }),
    delete: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/documents/${id}`, { method: 'DELETE' }),
    bulkDelete: (ids: number[]) =>
      post<{ ok: boolean; count: number }>(`${BASE}/documents/bulk-delete`, { document_ids: ids }),
    fileUrl: (id: number, download = false) =>
      `${BASE}/documents/${id}/file${download ? '?dl=1' : ''}`,
    /** URL for an extra file (beyond the primary one) on a document. */
    extraFileUrl: (docId: number, fileId: number, download = false) =>
      `${BASE}/documents/${docId}/files/${fileId}${download ? '?dl=1' : ''}`,
    removeFile: (docId: number, fileId: number) =>
      fetchJson<PersonDocument>(`${BASE}/documents/${docId}/files/${fileId}`, { method: 'DELETE' }),
    /**
     * Remove the primary file. The document's first extra file takes its place,
     * so this is only allowed while there is one — a document always has a file.
     */
    removePrimaryFile: (docId: number) =>
      fetchJson<PersonDocument>(`${BASE}/documents/${docId}/file`, { method: 'DELETE' }),
    promoteToSource: (docId: number, title?: string, sourceType?: string) =>
      post<Source>(`${BASE}/documents/${docId}/promote-to-source`, { title, source_type: sourceType }),
    linkPerson: (docId: number, personId: number) =>
      post<PersonDocument>(`${BASE}/documents/${docId}/persons/${personId}`, {}),
    unlinkPerson: (docId: number, personId: number) =>
      fetchJson<PersonDocument>(`${BASE}/documents/${docId}/persons/${personId}`, { method: 'DELETE' }),
    bulkDownload: async (ids: number[], includeNotes: boolean): Promise<void> => {
      const res = await fetch(`${BASE}/documents/bulk-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, include_notes: includeNotes }),
      })
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'documents.zip'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    },
  },
  documentTypes: {
    list: () => fetchJson<DocumentType[]>(`${BASE}/document-types`),
    create: (key: string, label: string) => post<DocumentType>(`${BASE}/document-types`, { key, label }),
    update: (id: number, fields: Partial<Pick<DocumentType, 'label' | 'sort_order'>>) =>
      patch<DocumentType>(`${BASE}/document-types/${id}`, fields),
    delete: (id: number) => fetchJson<{ ok: boolean }>(`${BASE}/document-types/${id}`, { method: 'DELETE' }),
  },
  sources: {
    list: () => fetchJson<Source[]>(`${BASE}/sources`),
    create: (fields: { title: string; source_type?: string; author?: string; year?: number; publisher?: string; location?: string; url?: string; description?: string; document_id?: number; event_id?: number }) =>
      post<Source>(`${BASE}/sources`, fields),
    update: (id: number, fields: Partial<Omit<Source, 'id' | 'created_at' | 'citation_count' | 'document_id'>>) =>
      patch<Source>(`${BASE}/sources/${id}`, fields),
    delete: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/sources/${id}`, { method: 'DELETE' }),
  },
  citations: {
    listForPerson: (personId: number) =>
      fetchJson<Citation[]>(`${BASE}/persons/${personId}/citations`),
    add: (personId: number, fields: { source_id: number; fact?: string; detail?: string; notes?: string; relation_id?: number }) =>
      post<Citation>(`${BASE}/persons/${personId}/citations`, fields),
    update: (id: number, fields: Partial<Pick<Citation, 'fact' | 'detail' | 'notes'>>) =>
      patch<Citation>(`${BASE}/citations/${id}`, fields),
    delete: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/citations/${id}`, { method: 'DELETE' }),
  },
  documentNotes: {
    list: (docId: number) => fetchJson<DocumentNote[]>(`${BASE}/documents/${docId}/notes`),
    create: (docId: number, fields: { title?: string; content?: string }) =>
      post<DocumentNote>(`${BASE}/documents/${docId}/notes`, fields),
    update: (id: number, fields: { title?: string | null; content?: string }) =>
      patch<DocumentNote>(`${BASE}/document-notes/${id}`, fields),
    delete: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/document-notes/${id}`, { method: 'DELETE' }),
    addCitation: (noteId: number, fields: { source_id?: number; marker: number; detail?: string; custom_label?: string }) =>
      post<NoteCitation>(`${BASE}/document-notes/${noteId}/citations`, fields),
    deleteCitation: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/document-note-citations/${id}`, { method: 'DELETE' }),
  },
  notes: {
    list: (personId: number) => fetchJson<PersonNote[]>(`${BASE}/persons/${personId}/notes`),
    listAll: () => fetchJson<{ id: number; person_id: number; title: string | null; content: string }[]>(`${BASE}/notes`),
    create: (personId: number, fields: { title?: string; content?: string; sort_order?: number }) =>
      post<PersonNote>(`${BASE}/persons/${personId}/notes`, fields),
    update: (id: number, fields: { title?: string | null; content?: string; sort_order?: number; is_private?: boolean }) =>
      patch<PersonNote>(`${BASE}/notes/${id}`, fields),
    togglePrivacy: (id: number, isPrivate: boolean) =>
      patch<PersonNote>(`${BASE}/notes/${id}`, { is_private: isPrivate }),
    delete: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/notes/${id}`, { method: 'DELETE' }),
    addCitation: (noteId: number, fields: { source_id?: number; marker: number; detail?: string; custom_label?: string }) =>
      post<NoteCitation>(`${BASE}/notes/${noteId}/citations`, fields),
    updateCitation: (id: number, fields: { source_id?: number; marker?: number; detail?: string }) =>
      patch<NoteCitation>(`${BASE}/note-citations/${id}`, fields),
    deleteCitation: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/note-citations/${id}`, { method: 'DELETE' }),
  },
  events: {
    list: (hasPhotos = false) =>
      fetchJson<PersonEvent[]>(`${BASE}/events?has_photos=${hasPhotos}`),
    listForPerson: (personId: number) =>
      fetchJson<PersonEvent[]>(`${BASE}/persons/${personId}/events`),
    create: (fields: {
      event_type?: string; title?: string; date?: string; year?: number
      place?: string; description?: string; person_id?: number; extra_person_ids?: number[]
    }) => post<PersonEvent>(`${BASE}/events`, fields),
    update: (id: number, fields: Partial<Pick<PersonEvent, 'event_type' | 'title' | 'date' | 'year' | 'place' | 'description' | 'is_private'>>) =>
      patch<PersonEvent>(`${BASE}/events/${id}`, fields),
    togglePrivacy: (id: number, isPrivate: boolean) =>
      patch<PersonEvent>(`${BASE}/events/${id}`, { is_private: isPrivate }),
    delete: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/events/${id}`, { method: 'DELETE' }),
    addImage: (eventId: number, imageId: number) =>
      post<PersonEvent>(`${BASE}/events/${eventId}/images`, { image_id: imageId }),
    removeImage: (eventImageId: number) =>
      fetchJson<PersonEvent | { ok: boolean }>(`${BASE}/event-images/${eventImageId}`, { method: 'DELETE' }),
    addPerson: (eventId: number, personId: number, role = 'participant') =>
      post<PersonEvent>(`${BASE}/events/${eventId}/persons`, { person_id: personId, role }),
    removePerson: (eventPersonId: number) =>
      fetchJson<PersonEvent | { ok: boolean }>(`${BASE}/event-persons/${eventPersonId}`, { method: 'DELETE' }),
    listForImage: (imageId: number) =>
      fetchJson<PersonEvent[]>(`${BASE}/images/${imageId}/events`),
    patchEventPerson: (epId: number, fields: { featured?: boolean }) =>
      patch<PersonEvent>(`${BASE}/event-persons/${epId}`, fields),
    exportImagesZip: async (eventId: number, signal?: AbortSignal): Promise<Blob> => {
      const res = await fetch(`${BASE}/events/${eventId}/images/zip`, { signal })
      if (!res.ok) throw new Error(await res.text())
      return res.blob()
    },
    promoteToSource: (eventId: number, title?: string, sourceType?: string) =>
      post<Source>(`${BASE}/events/${eventId}/promote-to-source`, { title, source_type: sourceType }),
  },
  faceThumbnailUrl: (id: number, size = 160) =>
    `${BASE}/faces/${id}/thumbnail?size=${size}`,
  imageViewUrl: (id: number, maxSize = 1200) =>
    `${BASE}/images/${id}/view?max_size=${maxSize}`,
  update: {
    getStatus: () => fetchJson<UpdateStatus>(`${BASE}/update/status`),
    check:     () => post<{ ok: boolean }>(`${BASE}/update/check`),
    download:  () => post<{ ok: boolean }>(`${BASE}/update/download`),
    apply:     () => post<{ ok: boolean }>(`${BASE}/update/apply`),
  },
  /**
   * Reading scanned documents. A batch points at a folder *outside* the
   * project; nothing is copied in until a page is imported, which is the point
   * — most pages in a register folder are never wanted.
   */
  transcripts: {
    getSettings: () => fetchJson<DocumentAiSettings>(`${BASE}/ai/document-settings`),
    saveSettings: (fields: Partial<{ enabled: boolean; provider: string; model: string; monthly_pages: number }>) =>
      put<DocumentAiSettings>(`${BASE}/ai/document-settings`, fields),

    listBatches: () => fetchJson<TranscriptBatch[]>(`${BASE}/transcripts/batches`),
    createBatch: (folder: string, name?: string, recursive = true) =>
      post<TranscriptBatch>(`${BASE}/transcripts/batches`, { folder, name: name ?? null, recursive }),
    getBatch: (id: number) => fetchJson<TranscriptBatchDetail>(`${BASE}/transcripts/batches/${id}`),
    deleteBatch: (id: number) =>
      fetchJson<void>(`${BASE}/transcripts/batches/${id}`, { method: 'DELETE' }).catch(() => undefined),

    /** `pageIds` reads exactly those pages whatever state they are in; omit it
     *  to read everything still unread. */
    start: (id: number, lang: string, nameOrder: string, retryFailed = false, pageIds?: number[]) =>
      post<{ started: boolean; message: string }>(`${BASE}/transcripts/batches/${id}/start`, {
        lang, name_order: nameOrder, retry_failed: retryFailed, page_ids: pageIds ?? [],
      }),
    /** Re-run matching and the report without paying to read every page again. */
    analyse: (id: number, lang: string, nameOrder: string) =>
      post<{ started: boolean; message: string }>(`${BASE}/transcripts/batches/${id}/analyse`, { lang, name_order: nameOrder }),
    /** Recompute the relevance marks. No model call, no cost. */
    rematch: (id: number) => post<TranscriptBatch & { changed: number }>(`${BASE}/transcripts/batches/${id}/rematch`),
    /**
     * One question about one batch, answered from its transcripts. The
     * conversation is stored on the batch, so nothing is sent back with it.
     */
    ask: (id: number, body: { question: string; lang: string; name_order: string }) =>
      post<TranscriptQuestion>(`${BASE}/transcripts/batches/${id}/ask`, body),
    clearQuestions: (id: number) =>
      fetchJson<void>(`${BASE}/transcripts/batches/${id}/questions`, { method: 'DELETE' }),
    stop: () => post<{ stopped: boolean; message: string }>(`${BASE}/transcripts/stop`),
    status: () => fetchJson<TranscriptStatus>(`${BASE}/transcripts/status`),

    getPage: (id: number) => fetchJson<TranscriptPageFull>(`${BASE}/transcripts/pages/${id}`),
    updatePage: (id: number, fields: Partial<{ text: string }>) =>
      patch<TranscriptPageFull>(`${BASE}/transcripts/pages/${id}`, fields),
    /** The scan itself, for showing next to its transcript. */
    fileUrl: (id: number) => `${BASE}/transcripts/pages/${id}/file`,
    importPage: (id: number, fields: { person_ids: number[]; title?: string | null; doc_type?: string; date?: string | null; description?: string | null }) =>
      post<PersonDocument>(`${BASE}/transcripts/pages/${id}/import`, fields),
  },

  ai: {
    getSettings: () => fetchJson<AiSettings>(`${BASE}/ai/settings`),
    saveSettings: (fields: Partial<{ provider: string; model: string; api_key: string; allow_private: boolean; enabled: boolean; base_url: string }>) =>
      put<AiSettings>(`${BASE}/ai/settings`, fields),

    /** A separate opt-in from the assistant itself — see WebResearchSettings. */
    getWebSettings: () => fetchJson<WebResearchSettings>(`${BASE}/ai/web-settings`),
    saveWebSettings: (fields: Partial<{ enabled: boolean; api_key: string; daily_limit: number }>) =>
      put<WebResearchSettings>(`${BASE}/ai/web-settings`, fields),
    /**
     * Models for the picker. The list comes from the provider itself (cached
     * server-side for a week); the bundled manifest only adds labels and
     * prices. `refresh` forces a live fetch.
     */
    listModels: (provider?: string, refresh = false) => {
      const q = new URLSearchParams()
      if (provider) q.set('provider', provider)
      if (refresh) q.set('refresh', 'true')
      const qs = q.toString()
      return fetchJson<AiModelCatalog>(`${BASE}/ai/models${qs ? `?${qs}` : ''}`)
    },

    listThreads: () => fetchJson<ChatThread[]>(`${BASE}/ai/threads`),
    createThread: (title?: string) => post<ChatThread>(`${BASE}/ai/threads`, { title: title ?? null }),
    renameThread: (id: number, title: string) => patch<ChatThread>(`${BASE}/ai/threads/${id}`, { title }),
    deleteThread: (id: number) => fetchJson<{ ok: boolean }>(`${BASE}/ai/threads/${id}`, { method: 'DELETE' }),
    listMessages: (threadId: number) => fetchJson<ChatMessage[]>(`${BASE}/ai/threads/${threadId}/messages`),

    /**
     * Stream one turn. Deliberately not react-query: this is a long-lived
     * SSE body read with a ReadableStream, not a request/response cache entry.
     * `onEvent` fires per frame; the promise settles when the stream ends.
     */
    stream: async (
      threadId: number,
      body: { message: string; lang: string; name_order: string; style: string },
      onEvent: (ev: ChatStreamEvent) => void,
      signal?: AbortSignal,
    ): Promise<void> => {
      const res = await fetch(`${BASE}/ai/threads/${threadId}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok || !res.body) throw new Error((await res.text()) || `HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // Frames are separated by a blank line; the last chunk may be partial.
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          const line = frame.trim()
          if (!line.startsWith('data: ')) continue
          try {
            onEvent(JSON.parse(line.slice(6)) as ChatStreamEvent)
          } catch {
            /* ignore a malformed frame rather than killing the stream */
          }
        }
      }
    },
  },
}

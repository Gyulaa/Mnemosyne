import type { ScanStatus, Stats, Cluster, FaceInfo, SimilarFaceInfo, Project, ConnectionsData, ClusterConnection, ImageItem, ImagesPage, FsListing, PersonFull, Relation, ImagePerson, LinkedCluster, PersonDocument, Source, Citation, PersonNote, NoteCitation, PersonEvent } from './types'

const BASE = '/api'

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

export const api = {
  scan: {
    start: (path: string) => post(`${BASE}/scan/start`, { path }),
    stop:  () => post(`${BASE}/scan/stop`),
    status: () => fetchJson<ScanStatus>(`${BASE}/scan/status`),
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
    create: (faceIds?: number[], personName?: string) =>
      post<{ ok: boolean; cluster_id: number; label: number; person_id: number | null; person_name: string | null }>(
        `${BASE}/clusters`,
        { face_ids: faceIds ?? null, person_name: personName ?? null },
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
  },
  project: {
    list:     () => fetchJson<Project[]>(`${BASE}/projects`),
    active:   () => fetchJson<Project>(`${BASE}/projects/active`),
    create:   (name: string) => post<Project>(`${BASE}/projects`, { name }),
    activate: (id: string) => post<Project>(`${BASE}/projects/${encodeURIComponent(id)}/activate`),
    rename:   (id: string, name: string) => patch<Project>(`${BASE}/projects/${encodeURIComponent(id)}`, { name }),
    delete:   (id: string) =>
      fetchJson<{ ok: boolean; new_active: import('./types').Project | null }>(`${BASE}/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    exportZip: async (clusterIds?: number[], name?: string, includeGenealogy = true, personIds?: number[], includeFaceless = true): Promise<Blob> => {
      const p = new URLSearchParams()
      if (clusterIds?.length) p.set('cluster_ids', clusterIds.join(','))
      if (personIds?.length) p.set('person_ids', personIds.join(','))
      if (name) p.set('name', name)
      if (!includeGenealogy) p.set('include_genealogy', 'false')
      if (!includeFaceless) p.set('include_faceless', 'false')
      const res = await fetch(`${BASE}/projects/export?${p}`)
      if (!res.ok) throw new Error(await res.text())
      return res.blob()
    },
    importZip: async (file: File): Promise<Project> => {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${BASE}/projects/import`, { method: 'POST', body: fd })
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
    exportZip: async (filter: string, search: string, sort: string, includePersonIds: number[], excludePersonIds: number[], includeMode: string): Promise<Blob> => {
      const p = new URLSearchParams({ filter, search, sort, include_mode: includeMode })
      if (includePersonIds.length) p.set('include_person_ids', includePersonIds.join(','))
      if (excludePersonIds.length) p.set('exclude_person_ids', excludePersonIds.join(','))
      const res = await fetch(`${BASE}/images/export-zip?${p}`)
      if (!res.ok) throw new Error(await res.text())
      return res.blob()
    },
    exportSelectedZip: async (imageIds: number[]): Promise<Blob> => {
      const p = new URLSearchParams({ image_ids: imageIds.join(',') })
      const res = await fetch(`${BASE}/images/export-zip?${p}`)
      if (!res.ok) throw new Error(await res.text())
      return res.blob()
    },
    delete: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/images/${id}`, { method: 'DELETE' }),
    bulkDelete: (ids: number[]) =>
      post<{ ok: boolean; count: number }>(`${BASE}/images/bulk-delete`, { image_ids: ids }),
    persons: (id: number) =>
      fetchJson<ImagePerson[]>(`${BASE}/images/${id}/persons`),
    withEvents: () =>
      fetchJson<number[]>(`${BASE}/images/with-events`),
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
  },
  relations: {
    list: () => fetchJson<Relation[]>(`${BASE}/relations`),
    create: (type: 'parent' | 'spouse' | 'sibling', person_a_id: number, person_b_id: number) =>
      post<Relation>(`${BASE}/relations`, { type, person_a_id, person_b_id }),
    update: (id: number, fields: Partial<Pick<Relation, 'marriage_year' | 'marriage_place' | 'divorce_year' | 'divorce_place'>>) =>
      patch<Relation>(`${BASE}/relations/${id}`, fields),
    delete: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/relations/${id}`, { method: 'DELETE' }),
  },
  documents: {
    list: (personId: number) => fetchJson<PersonDocument[]>(`${BASE}/persons/${personId}/documents`),
    upload: async (personId: number, file: File, meta: { title?: string; doc_type?: string; year?: number; description?: string }): Promise<PersonDocument> => {
      const fd = new FormData()
      fd.append('file', file)
      if (meta.title) fd.append('title', meta.title)
      if (meta.doc_type) fd.append('doc_type', meta.doc_type)
      if (meta.year != null) fd.append('year', String(meta.year))
      if (meta.description) fd.append('description', meta.description)
      const res = await fetch(`${BASE}/persons/${personId}/documents`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    update: (id: number, fields: Partial<Pick<PersonDocument, 'title' | 'doc_type' | 'year' | 'description'>>) =>
      patch<PersonDocument>(`${BASE}/documents/${id}`, fields),
    delete: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/documents/${id}`, { method: 'DELETE' }),
    fileUrl: (id: number, download = false) =>
      `${BASE}/documents/${id}/file${download ? '?dl=1' : ''}`,
    promoteToSource: (docId: number, title?: string, sourceType?: string) =>
      post<Source>(`${BASE}/documents/${docId}/promote-to-source`, { title, source_type: sourceType }),
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
    add: (personId: number, fields: { source_id: number; fact?: string; detail?: string; notes?: string }) =>
      post<Citation>(`${BASE}/persons/${personId}/citations`, fields),
    update: (id: number, fields: Partial<Pick<Citation, 'fact' | 'detail' | 'notes'>>) =>
      patch<Citation>(`${BASE}/citations/${id}`, fields),
    delete: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/citations/${id}`, { method: 'DELETE' }),
  },
  notes: {
    list: (personId: number) => fetchJson<PersonNote[]>(`${BASE}/persons/${personId}/notes`),
    create: (personId: number, fields: { title?: string; content?: string; sort_order?: number }) =>
      post<PersonNote>(`${BASE}/persons/${personId}/notes`, fields),
    update: (id: number, fields: { title?: string | null; content?: string; sort_order?: number }) =>
      patch<PersonNote>(`${BASE}/notes/${id}`, fields),
    delete: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/notes/${id}`, { method: 'DELETE' }),
    addCitation: (noteId: number, fields: { source_id: number; marker: number; detail?: string }) =>
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
    update: (id: number, fields: Partial<Pick<PersonEvent, 'event_type' | 'title' | 'date' | 'year' | 'place' | 'description'>>) =>
      patch<PersonEvent>(`${BASE}/events/${id}`, fields),
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
  },
  faceThumbnailUrl: (id: number, size = 160) =>
    `${BASE}/faces/${id}/thumbnail?size=${size}`,
  imageViewUrl: (id: number, maxSize = 1200) =>
    `${BASE}/images/${id}/view?max_size=${maxSize}`,
}

import type { ScanStatus, Stats, Cluster, FaceInfo, SimilarFaceInfo, Project, ConnectionsData, ClusterConnection, ImageItem, ImagesPage, FsListing, PersonFull, Relation, ImagePerson, LinkedCluster } from './types'

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
    rename: (id: number, name: string) =>
      patch<{ ok: boolean; person_id: number | null; person_name: string | null }>(
        `${BASE}/clusters/${id}`,
        { person_name: name },
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
      fetchJson<{ ok: boolean }>(`${BASE}/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    exportZip: async (clusterIds?: number[], name?: string, includeGenealogy = true, personIds?: number[]): Promise<Blob> => {
      const p = new URLSearchParams()
      if (clusterIds?.length) p.set('cluster_ids', clusterIds.join(','))
      if (personIds?.length) p.set('person_ids', personIds.join(','))
      if (name) p.set('name', name)
      if (!includeGenealogy) p.set('include_genealogy', 'false')
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
  },
  stats: () => fetchJson<Stats>(`${BASE}/stats`),
  fs: {
    list: (path: string) =>
      fetchJson<FsListing>(`${BASE}/fs/list?path=${encodeURIComponent(path)}`),
  },
  persons: {
    list: () => fetchJson<PersonFull[]>(`${BASE}/persons`),
    create: (name: string, birth_year?: number | null, death_year?: number | null, notes?: string | null) =>
      post<PersonFull>(`${BASE}/persons`, { name, birth_year, death_year, notes }),
    update: (id: number, patch: Partial<Pick<PersonFull, 'name' | 'birth_year' | 'death_year' | 'notes'>>) =>
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
    delete: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/relations/${id}`, { method: 'DELETE' }),
  },
  faceThumbnailUrl: (id: number, size = 160) =>
    `${BASE}/faces/${id}/thumbnail?size=${size}`,
  imageViewUrl: (id: number, maxSize = 1200) =>
    `${BASE}/images/${id}/view?max_size=${maxSize}`,
}

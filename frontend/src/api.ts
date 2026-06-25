import type { ScanStatus, Stats, Cluster, FaceInfo, SimilarFaceInfo, Project, ConnectionsData, ClusterConnection, ImageItem, ImagesPage, FsListing, PersonFull, Relation } from './types'

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
    create: (faceIds?: number[], personName?: string) =>
      post<{ ok: boolean; cluster_id: number; label: number; person_id: number | null; person_name: string | null }>(
        `${BASE}/clusters`,
        { face_ids: faceIds ?? null, person_name: personName ?? null },
      ),
    mergeInto: (sourceId: number, targetId: number) =>
      post<{ ok: boolean; target_cluster_id: number }>(
        `${BASE}/clusters/${sourceId}/merge-into/${targetId}`,
      ),
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
    delete: (id: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/images/${id}`, { method: 'DELETE' }),
    bulkDelete: (ids: number[]) =>
      post<{ ok: boolean; count: number }>(`${BASE}/images/bulk-delete`, { image_ids: ids }),
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

import type { ScanStatus, Stats, Cluster, FaceInfo, FsListing } from './types'

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
    faces: (id: number) => fetchJson<FaceInfo[]>(`${BASE}/clusters/${id}/faces`),
    rename: (id: number, name: string) =>
      fetchJson<{ ok: boolean; person_id: number | null; person_name: string | null }>(
        `${BASE}/clusters/${id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ person_name: name }),
        },
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
  },
  face: {
    assign: (faceId: number, clusterId: number) =>
      fetchJson<{ ok: boolean }>(`${BASE}/faces/${faceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cluster_id: clusterId }),
      }),
    batchAssign: (faceIds: number[], clusterId: number) =>
      post<{ ok: boolean; count: number }>(
        `${BASE}/faces/batch-assign`,
        { face_ids: faceIds, cluster_id: clusterId },
      ),
  },
  stats: () => fetchJson<Stats>(`${BASE}/stats`),
  fs: {
    list: (path: string) =>
      fetchJson<FsListing>(`${BASE}/fs/list?path=${encodeURIComponent(path)}`),
  },
  faceThumbnailUrl: (id: number, size = 160) =>
    `${BASE}/faces/${id}/thumbnail?size=${size}`,
  imageViewUrl: (id: number, maxSize = 1200) =>
    `${BASE}/images/${id}/view?max_size=${maxSize}`,
}

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { Cluster, FaceInfo } from '../types'

type ModalTab = 'faces' | 'photos' | 'merge'

// ── ClustersTab ───────────────────────────────────────────────────────────────

export default function ClustersTab() {
  const [selected, setSelected] = useState<Cluster | null>(null)
  const [search, setSearch] = useState('')

  const { data: clusters = [], isLoading, isError } = useQuery({
    queryKey: ['clusters'],
    queryFn: api.cluster.list,
  })

  const named = [...clusters]
    .filter(c => c.label !== -1)
    .sort((a, b) => b.face_count - a.face_count)
  const noiseCluster = clusters.find(c => c.label === -1)
  const allNamed = clusters.filter(c => c.label !== -1)

  const filteredNamed = search.trim()
    ? named.filter(c => c.person_name?.toLowerCase().includes(search.toLowerCase()))
    : named

  if (isLoading) {
    return <div className="text-zinc-600 text-sm py-20 text-center">Loading clusters…</div>
  }
  if (isError) {
    return <div className="text-red-400 text-sm py-20 text-center">Failed to load clusters</div>
  }
  if (!clusters.length) {
    return (
      <div className="py-24 text-center space-y-2">
        <p className="text-zinc-400 text-base">No clusters yet.</p>
        <p className="text-zinc-600 text-sm">
          Run a scan and then click "Run clustering" in the Scan tab.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Unclassified faces — prominent banner at the top */}
      {noiseCluster && noiseCluster.face_count > 0 && (
        <div className="bg-amber-950/40 border border-amber-800/50 rounded-xl px-5 py-3.5 flex items-center justify-between gap-4">
          <div>
            <p className="text-amber-300 text-sm font-medium">
              {noiseCluster.face_count} unclassified faces
            </p>
            <p className="text-amber-700 text-xs mt-0.5">
              Review and assign them to complete the organization
            </p>
          </div>
          <button
            onClick={() => setSelected(noiseCluster)}
            className="px-4 py-1.5 bg-amber-800/60 hover:bg-amber-700/70 text-amber-300 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            Review →
          </button>
        </div>
      )}

      {/* Summary + search */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-zinc-500 whitespace-nowrap">{named.length} clusters</span>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name…"
          className="flex-1 max-w-xs bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
        />
      </div>

      {/* Cluster grid */}
      {filteredNamed.length === 0 && search.trim() ? (
        <p className="text-sm text-zinc-600 py-4">No clusters match "{search}"</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {filteredNamed.map(c => (
            <ClusterCard key={c.id} cluster={c} onClick={() => setSelected(c)} />
          ))}
        </div>
      )}

      {/* Modal */}
      {selected && (
        <ClusterModal
          cluster={selected}
          allClusters={allNamed}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

// ── ClusterCard ───────────────────────────────────────────────────────────────

function ClusterCard({ cluster, onClick }: { cluster: Cluster; onClick: () => void }) {
  const previews = cluster.preview_face_ids.slice(0, 4)

  return (
    <button
      onClick={onClick}
      className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-600 hover:shadow-lg transition-all text-left group focus:outline-none focus:border-blue-500"
    >
      <div className="grid grid-cols-2 gap-px bg-zinc-800">
        {([0, 1, 2, 3] as const).map(i => (
          <div key={i} className="aspect-square bg-zinc-900 overflow-hidden">
            {previews[i] != null ? (
              <img
                src={api.faceThumbnailUrl(previews[i])}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
            ) : (
              <div className="w-full h-full" />
            )}
          </div>
        ))}
      </div>
      <div className="px-3 py-2.5">
        {cluster.person_name ? (
          <div className="text-sm font-semibold text-blue-400 truncate">{cluster.person_name}</div>
        ) : (
          <div className="text-sm font-medium text-zinc-400 truncate">
            Cluster {String(cluster.label).padStart(3, '0')}
          </div>
        )}
        <div className="text-xs text-zinc-500 mt-0.5 tabular-nums">{cluster.face_count} faces</div>
      </div>
    </button>
  )
}

// ── ClusterModal ──────────────────────────────────────────────────────────────

function ClusterModal({
  cluster,
  allClusters,
  onClose,
}: {
  cluster: Cluster
  allClusters: Cluster[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const isNoise = cluster.label === -1

  const [tab, setTab] = useState<ModalTab>('faces')
  const [personName, setPersonName] = useState(cluster.person_name ?? '')
  const [savedName, setSavedName] = useState(cluster.person_name ?? '')
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const { data: faces = [], isLoading: facesLoading } = useQuery({
    queryKey: ['cluster-faces', cluster.id],
    queryFn: () => api.cluster.faces(cluster.id),
    staleTime: 60_000,
  })

  const nameUnchanged = personName.trim() === savedName
  const isSaved = nameUnchanged && savedName !== ''

  async function saveName() {
    if (saving || nameUnchanged) return
    setSaving(true)
    try {
      await api.cluster.rename(cluster.id, personName.trim())
      setSavedName(personName.trim())
      queryClient.invalidateQueries({ queryKey: ['clusters'] })
    } finally {
      setSaving(false)
    }
  }

  async function doDelete() {
    setDeleting(true)
    try {
      await api.cluster.delete(cluster.id)
      queryClient.invalidateQueries({ queryKey: ['clusters'] })
      onClose()
    } finally {
      setDeleting(false)
    }
  }

  const headingLabel = isNoise
    ? 'Unclassified faces'
    : cluster.person_name ?? `Cluster ${String(cluster.label).padStart(3, '0')}`

  const otherClusters = allClusters.filter(c => c.id !== cluster.id)

  return (
    <div
      className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-5xl flex flex-col shadow-2xl"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 space-y-3">
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-zinc-500 mb-1.5 uppercase tracking-wider">
                {headingLabel} · {cluster.face_count} faces
              </p>

              {!isNoise && (
                deleteConfirm ? (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm text-zinc-400">
                      Move {cluster.face_count} faces to unclassified and delete this cluster?
                    </span>
                    <button
                      onClick={() => setDeleteConfirm(false)}
                      className="px-3 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 rounded-lg text-zinc-300 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={doDelete}
                      disabled={deleting}
                      className="px-3 py-1 text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded-lg text-white transition-colors"
                    >
                      {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={personName}
                      onChange={e => setPersonName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveName()}
                      placeholder="Add a name…"
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      onClick={saveName}
                      disabled={saving || nameUnchanged}
                      className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                        nameUnchanged
                          ? 'bg-zinc-800 text-zinc-500 cursor-default'
                          : 'bg-blue-600 hover:bg-blue-500 text-white'
                      }`}
                    >
                      {saving ? 'Saving…' : isSaved ? 'Saved ✓' : 'Save'}
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(true)}
                      className="px-3 py-1.5 text-xs text-zinc-600 hover:text-red-400 hover:bg-zinc-800 rounded-lg transition-colors whitespace-nowrap"
                    >
                      Delete
                    </button>
                  </div>
                )
              )}
            </div>
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-200 text-xl leading-none p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              ✕
            </button>
          </div>

          {!isNoise && (
            <div className="flex gap-1">
              {(['faces', 'photos', 'merge'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    tab === t
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {t === 'faces'
                    ? `Faces (${cluster.face_count})`
                    : t === 'photos'
                    ? 'Photos'
                    : 'Merge into…'}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 p-4">
          {facesLoading ? (
            <p className="text-center text-zinc-600 py-10 text-sm">Loading…</p>
          ) : isNoise ? (
            <NoiseFaceGrid
              faces={faces}
              allClusters={allClusters}
              noiseClusterId={cluster.id}
            />
          ) : tab === 'faces' ? (
            <FaceGrid faces={faces} />
          ) : tab === 'photos' ? (
            <PhotoGallery faces={faces} />
          ) : (
            <MergePanel cluster={cluster} otherClusters={otherClusters} onMerged={onClose} />
          )}
        </div>
      </div>
    </div>
  )
}

// ── FaceGrid ──────────────────────────────────────────────────────────────────

function FaceGrid({ faces }: { faces: FaceInfo[] }) {
  const [enlarged, setEnlarged] = useState<FaceInfo | null>(null)

  return (
    <>
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
        {faces.map(f => (
          <button
            key={f.id}
            onClick={() => setEnlarged(f)}
            className="aspect-square rounded-lg overflow-hidden bg-zinc-800 group focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <img
              src={api.faceThumbnailUrl(f.id)}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-200"
            />
          </button>
        ))}
      </div>

      {enlarged && (
        <div
          className="fixed inset-0 bg-black/85 flex items-center justify-center z-60 p-4"
          onClick={() => setEnlarged(null)}
        >
          <div className="max-w-xs w-full space-y-3" onClick={e => e.stopPropagation()}>
            <img
              src={api.faceThumbnailUrl(enlarged.id, 320)}
              alt=""
              className="w-full rounded-xl shadow-2xl"
            />
            <p className="text-xs text-zinc-500 font-mono break-all text-center">
              {enlarged.image_path}
            </p>
            <p className="text-xs text-zinc-600 text-center">
              confidence {enlarged.det_score.toFixed(3)}
            </p>
          </div>
        </div>
      )}
    </>
  )
}

// ── NoiseFaceGrid (multi-select) ──────────────────────────────────────────────

function NoiseFaceGrid({
  faces,
  allClusters,
  noiseClusterId,
}: {
  faces: FaceInfo[]
  allClusters: Cluster[]
  noiseClusterId: number
}) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [assigning, setAssigning] = useState(false)

  const allSelected = faces.length > 0 && selected.size === faces.length

  function toggle(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(faces.map(f => f.id)))
    }
  }

  function handleAssigned() {
    setAssigning(false)
    setSelected(new Set())
    queryClient.invalidateQueries({ queryKey: ['cluster-faces', noiseClusterId] })
    queryClient.invalidateQueries({ queryKey: ['clusters'] })
  }

  const selectedFaces = faces.filter(f => selected.has(f.id))

  if (!faces.length) {
    return <p className="text-center text-zinc-600 py-10 text-sm">No unclassified faces.</p>
  }

  return (
    <>
      {/* Toolbar — sticky within the modal scroll area */}
      <div className="sticky top-0 z-10 -mx-4 -mt-4 px-4 pt-3 pb-2 mb-3 bg-zinc-900 border-b border-zinc-800/60 flex items-center gap-3">
        <button
          onClick={toggleAll}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
        <span className="text-xs text-zinc-700">
          {selected.size > 0 ? `${selected.size} selected` : `${faces.length} faces`}
        </span>
        {selected.size > 0 && (
          <button
            onClick={() => setAssigning(true)}
            className="ml-auto px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Assign {selected.size} selected →
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
        {faces.map(f => {
          const isSelected = selected.has(f.id)
          return (
            <div
              key={f.id}
              onClick={() => toggle(f.id)}
              className={`relative aspect-square rounded-lg overflow-hidden bg-zinc-800 cursor-pointer select-none ${
                isSelected ? 'ring-2 ring-blue-500' : 'hover:ring-1 hover:ring-zinc-600'
              }`}
            >
              <img
                src={api.faceThumbnailUrl(f.id)}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover"
              />
              {/* Selection indicator */}
              <div
                className={`absolute top-1 right-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                  isSelected
                    ? 'bg-blue-500 border-blue-400'
                    : 'bg-black/40 border-white/50'
                }`}
              >
                {isSelected && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {assigning && selectedFaces.length > 0 && (
        <AssignFacesOverlay
          faces={selectedFaces}
          allClusters={allClusters}
          onClose={() => setAssigning(false)}
          onAssigned={handleAssigned}
        />
      )}
    </>
  )
}

// ── AssignFacesOverlay ────────────────────────────────────────────────────────

function AssignFacesOverlay({
  faces,
  allClusters,
  onClose,
  onAssigned,
}: {
  faces: FaceInfo[]
  allClusters: Cluster[]
  onClose: () => void
  onAssigned: () => void
}) {
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [clusterSearch, setClusterSearch] = useState('')

  const faceIds = faces.map(f => f.id)

  const visibleClusters = clusterSearch.trim()
    ? allClusters.filter(c =>
        c.person_name?.toLowerCase().includes(clusterSearch.toLowerCase()) ||
        `cluster ${c.label}`.includes(clusterSearch.toLowerCase())
      )
    : allClusters

  async function createAndAssign() {
    if (busy) return
    setBusy(true)
    try {
      await api.cluster.create(faceIds, newName.trim() || undefined)
      onAssigned()
    } finally {
      setBusy(false)
    }
  }

  async function assignToCluster(clusterId: number) {
    if (busy) return
    setBusy(true)
    try {
      await api.face.batchAssign(faceIds, clusterId)
      onAssigned()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/85 flex items-center justify-center z-60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: '80vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-200">
            Assign {faces.length} face{faces.length !== 1 ? 's' : ''} to cluster
          </h3>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 text-lg leading-none p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {/* Selected face thumbnails */}
          <div className="flex flex-wrap gap-1.5">
            {faces.slice(0, 20).map(f => (
              <img
                key={f.id}
                src={api.faceThumbnailUrl(f.id, 56)}
                alt=""
                className="w-10 h-10 rounded-md object-cover"
              />
            ))}
            {faces.length > 20 && (
              <div className="w-10 h-10 rounded-md bg-zinc-800 flex items-center justify-center text-xs text-zinc-500">
                +{faces.length - 20}
              </div>
            )}
          </div>

          {/* Create new cluster */}
          <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-4 space-y-2.5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Create new cluster
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createAndAssign()}
                placeholder="Name (optional)…"
                className="flex-1 bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={createAndAssign}
                disabled={busy}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {busy ? '…' : 'Create'}
              </button>
            </div>
          </div>

          {/* Assign to existing cluster */}
          {allClusters.length > 0 && (
            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Or assign to existing cluster
              </p>
              <input
                type="search"
                value={clusterSearch}
                onChange={e => setClusterSearch(e.target.value)}
                placeholder="Search by name…"
                className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              />
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {visibleClusters.map(c => (
                  <button
                    key={c.id}
                    onClick={() => assignToCluster(c.id)}
                    disabled={busy}
                    className="bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden hover:border-blue-500 transition-all text-left disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <div className="grid grid-cols-2 gap-px bg-zinc-700">
                      {Array.from({ length: 4 }).map((_, i) => {
                        const faceId = c.preview_face_ids[i]
                        return (
                          <div key={i} className="aspect-square bg-zinc-800 overflow-hidden">
                            {faceId != null && (
                              <img
                                src={api.faceThumbnailUrl(faceId)}
                                alt=""
                                loading="lazy"
                                className="w-full h-full object-cover"
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                    <div className="px-2 py-1.5">
                      {c.person_name ? (
                        <div className="text-xs font-semibold text-blue-400 truncate">
                          {c.person_name}
                        </div>
                      ) : (
                        <div className="text-xs text-zinc-400 truncate">
                          Cluster {String(c.label).padStart(3, '0')}
                        </div>
                      )}
                      <div className="text-xs text-zinc-600 tabular-nums">{c.face_count} faces</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── PhotoGallery ──────────────────────────────────────────────────────────────

function PhotoGallery({ faces }: { faces: FaceInfo[] }) {
  const [lightbox, setLightbox] = useState<number | null>(null)
  const uniqueImages = [...new Map(faces.map(f => [f.image_id, f])).values()]

  if (!uniqueImages.length) {
    return <p className="text-center text-zinc-600 py-10 text-sm">No photos found.</p>
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {uniqueImages.map(f => (
          <button
            key={f.image_id}
            onClick={() => setLightbox(f.image_id)}
            className="aspect-square rounded-lg overflow-hidden bg-zinc-800 group focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <img
              src={api.imageViewUrl(f.image_id, 400)}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          </button>
        ))}
      </div>

      {lightbox != null && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-60 p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={api.imageViewUrl(lightbox, 1600)}
            alt=""
            className="max-w-full max-h-full rounded-xl shadow-2xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}

// ── MergePanel ────────────────────────────────────────────────────────────────

function MergePanel({
  cluster,
  otherClusters,
  onMerged,
}: {
  cluster: Cluster
  otherClusters: Cluster[]
  onMerged: () => void
}) {
  const queryClient = useQueryClient()
  const [target, setTarget] = useState<Cluster | null>(null)
  const [merging, setMerging] = useState(false)

  async function doMerge() {
    if (!target || merging) return
    setMerging(true)
    try {
      await api.cluster.mergeInto(cluster.id, target.id)
      queryClient.invalidateQueries({ queryKey: ['clusters'] })
      onMerged()
    } finally {
      setMerging(false)
    }
  }

  if (target) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-6">
        <p className="text-zinc-300 text-center max-w-sm leading-relaxed">
          Merge{' '}
          <span className="font-semibold text-white">
            {cluster.person_name ?? `Cluster ${cluster.label}`}
          </span>{' '}
          into{' '}
          <span className="font-semibold text-white">
            {target.person_name ?? `Cluster ${target.label}`}
          </span>
          ?
        </p>
        <p className="text-zinc-500 text-sm text-center -mt-4">
          {cluster.face_count} faces will move to the target. This cannot be undone.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setTarget(null)}
            className="px-5 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={doMerge}
            disabled={merging}
            className="px-5 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {merging ? 'Merging…' : 'Confirm merge'}
          </button>
        </div>
      </div>
    )
  }

  if (!otherClusters.length) {
    return (
      <p className="text-center text-zinc-600 py-10 text-sm">No other clusters to merge into.</p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500">Select a cluster to merge this one into:</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
        {otherClusters.map(c => (
          <button
            key={c.id}
            onClick={() => setTarget(c)}
            className="bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden hover:border-blue-500 transition-all text-left group focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <div className="grid grid-cols-2 gap-px bg-zinc-700">
              {Array.from({ length: 4 }).map((_, i) => {
                const faceId = c.preview_face_ids[i]
                return (
                  <div key={i} className="aspect-square bg-zinc-800 overflow-hidden">
                    {faceId != null && (
                      <img
                        src={api.faceThumbnailUrl(faceId)}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                )
              })}
            </div>
            <div className="px-2.5 py-2">
              {c.person_name ? (
                <div className="text-xs font-semibold text-blue-400 truncate">{c.person_name}</div>
              ) : (
                <div className="text-xs font-medium text-zinc-400 truncate">
                  Cluster {String(c.label).padStart(3, '0')}
                </div>
              )}
              <div className="text-xs text-zinc-500 tabular-nums">{c.face_count} faces</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { Cluster, FaceInfo, SimilarFaceInfo } from '../types'

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
  const [jumpTo, setJumpTo] = useState<{ imageId: number } | null>(null)
  const [splitEps, setSplitEps] = useState(0.35)
  const [showSplit, setShowSplit] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [splitMsg, setSplitMsg] = useState<string | null>(null)

  function handleViewOriginal(imageId: number) {
    setJumpTo({ imageId })
    setTab('photos')
  }

  function handleFacesChanged() {
    queryClient.invalidateQueries({ queryKey: ['cluster-faces', cluster.id] })
    queryClient.invalidateQueries({ queryKey: ['clusters'] })
  }

  async function doSplit() {
    if (splitting) return
    setSplitting(true)
    setSplitMsg(null)
    try {
      const res = await api.cluster.split(cluster.id, splitEps)
      if (!res.ok) {
        setSplitMsg(res.message ?? 'Could not split')
      } else {
        setSplitMsg(
          `Split into ${res.sub_clusters} sub-cluster${res.sub_clusters !== 1 ? 's' : ''}.` +
          (res.noise_moved > 0 ? ` ${res.noise_moved} face${res.noise_moved !== 1 ? 's' : ''} moved to unclassified.` : ''),
        )
        queryClient.invalidateQueries({ queryKey: ['clusters'] })
        queryClient.invalidateQueries({ queryKey: ['cluster-faces', cluster.id] })
      }
    } finally {
      setSplitting(false)
    }
  }

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
            <div className="flex items-center gap-1 flex-wrap">
              {(['faces', 'photos', 'merge'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => { setTab(t); setShowSplit(false) }}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    tab === t && !showSplit
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
              {cluster.face_count >= 6 && (
                <button
                  onClick={() => { setShowSplit(s => !s); setSplitMsg(null) }}
                  className={`ml-auto px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                    showSplit
                      ? 'bg-violet-700/60 text-violet-200'
                      : 'text-zinc-500 hover:text-violet-300 hover:bg-zinc-800'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h8M8 12h4m-4 5h8M4 4h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z" />
                  </svg>
                  Auto-split
                </button>
              )}
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
          ) : showSplit ? (
            <div className="space-y-4 py-4 max-w-md mx-auto">
              <p className="text-sm text-zinc-400">
                Az algoritmus megpróbálja a clustert al-csoportokra bontani egy szűkebb
                eps értékkel. A legnagyobb al-csoport az eredeti clusterben marad, a többiek
                új, névtelen clusterekként jelennek meg.
              </p>
              <div className="flex items-center gap-3">
                <label className="text-xs text-zinc-500 w-8 shrink-0">eps</label>
                <input
                  type="range"
                  min={0.15}
                  max={0.55}
                  step={0.05}
                  value={splitEps}
                  onChange={e => setSplitEps(Number(e.target.value))}
                  className="flex-1 accent-violet-500"
                />
                <span className="text-sm text-zinc-300 tabular-nums w-10 text-right">{splitEps.toFixed(2)}</span>
              </div>
              <p className="text-xs text-zinc-600">
                Alacsonyabb eps → szigorúbb szétválasztás. Ha nem sikerül, próbálj alacsonyabb értékkel.
              </p>
              {splitMsg && (
                <p className={`text-sm px-3 py-2 rounded-lg ${
                  splitMsg.startsWith('Could not') || splitMsg.startsWith('Not enough')
                    ? 'bg-red-900/40 text-red-300'
                    : 'bg-green-900/40 text-green-300'
                }`}>
                  {splitMsg}
                </p>
              )}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={doSplit}
                  disabled={splitting}
                  className="px-5 py-2 bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {splitting ? 'Splitting…' : 'Split cluster'}
                </button>
                {splitMsg && splitMsg.startsWith('Split into') && (
                  <button
                    onClick={onClose}
                    className="px-5 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-medium rounded-lg transition-colors"
                  >
                    Done — close
                  </button>
                )}
              </div>
            </div>
          ) : tab === 'faces' ? (
            <FaceGrid
              faces={faces}
              allClusters={otherClusters}
              onViewOriginal={handleViewOriginal}
              onFacesChanged={handleFacesChanged}
            />
          ) : tab === 'photos' ? (
            <PhotoGallery faces={faces} jumpTo={jumpTo} />
          ) : (
            <MergePanel cluster={cluster} otherClusters={otherClusters} onMerged={onClose} />
          )}
        </div>
      </div>
    </div>
  )
}

// ── FaceGrid ──────────────────────────────────────────────────────────────────

function FaceGrid({
  faces,
  allClusters,
  onViewOriginal,
  onFacesChanged,
}: {
  faces: FaceInfo[]
  allClusters: Cluster[]
  onViewOriginal?: (imageId: number) => void
  onFacesChanged?: () => void
}) {
  const [enlarged, setEnlarged] = useState<FaceInfo | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [assigning, setAssigning] = useState(false)
  const [busy, setBusy] = useState(false)

  function toggleSelect(e: React.MouseEvent, id: number) {
    e.stopPropagation()
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function unclassifySelected() {
    if (busy || selected.size === 0) return
    setBusy(true)
    try {
      await api.face.batchUnclassify([...selected])
      setSelected(new Set())
      onFacesChanged?.()
    } finally {
      setBusy(false)
    }
  }

  function handleAssigned() {
    setAssigning(false)
    setSelected(new Set())
    onFacesChanged?.()
  }

  const selectedFaces = faces.filter(f => selected.has(f.id))

  return (
    <>
      {/* Sticky selection toolbar */}
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 -mx-4 -mt-4 px-4 pt-3 pb-2 mb-3 bg-zinc-900 border-b border-zinc-800/60 flex items-center gap-3">
          <span className="text-xs text-zinc-400 font-medium">{selected.size} selected</span>
          <button
            onClick={() => setAssigning(true)}
            disabled={busy}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
          >
            Assign to…
          </button>
          <button
            onClick={unclassifySelected}
            disabled={busy}
            className="px-3 py-1.5 bg-zinc-700 hover:bg-amber-800/70 disabled:opacity-50 text-zinc-300 hover:text-amber-200 text-xs font-medium rounded-lg transition-colors"
          >
            Unclassify
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Deselect all
          </button>
        </div>
      )}

      {/* Face grid */}
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
        {faces.map(f => {
          const isSel = selected.has(f.id)
          return (
            <div
              key={f.id}
              className={`relative aspect-square rounded-lg overflow-hidden bg-zinc-800 group cursor-pointer ${
                isSel ? 'ring-2 ring-blue-500' : ''
              }`}
              onClick={() => setEnlarged(f)}
            >
              <img
                src={api.faceThumbnailUrl(f.id)}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-200"
              />
              {/* Checkbox — visible on hover or when selected */}
              <div
                onClick={e => toggleSelect(e, f.id)}
                className={`absolute top-1 left-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all cursor-pointer ${
                  isSel
                    ? 'bg-blue-500 border-blue-400 opacity-100'
                    : 'bg-black/40 border-white/60 opacity-0 group-hover:opacity-100'
                }`}
              >
                {isSel && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Enlarged face view */}
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
            {onViewOriginal && (
              <button
                onClick={() => {
                  setEnlarged(null)
                  onViewOriginal(enlarged.image_id)
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-500 rounded-lg text-sm text-zinc-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                View original photo
              </button>
            )}
          </div>
        </div>
      )}

      {/* Assign overlay (reuses existing component) */}
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

type Suggestions = {
  clusterId: number
  clusterName: string | null
  faces: SimilarFaceInfo[]
}

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
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null)

  const faceIds = faces.map(f => f.id)

  const visibleClusters = clusterSearch.trim()
    ? allClusters.filter(c =>
        c.person_name?.toLowerCase().includes(clusterSearch.toLowerCase()) ||
        `cluster ${c.label}`.includes(clusterSearch.toLowerCase())
      )
    : allClusters

  async function finishWithSuggestions(clusterId: number, clusterName: string | null) {
    try {
      const similar = await api.cluster.similarNoise(clusterId)
      if (similar.length > 0) {
        setSuggestions({ clusterId, clusterName, faces: similar })
      } else {
        onAssigned()
      }
    } catch {
      onAssigned()
    }
  }

  async function createAndAssign() {
    if (busy) return
    setBusy(true)
    try {
      const result = await api.cluster.create(faceIds, newName.trim() || undefined)
      await finishWithSuggestions(result.cluster_id, result.person_name)
    } finally {
      setBusy(false)
    }
  }

  async function assignToCluster(clusterId: number, clusterName: string | null) {
    if (busy) return
    setBusy(true)
    try {
      await api.face.batchAssign(faceIds, clusterId)
      await finishWithSuggestions(clusterId, clusterName)
    } finally {
      setBusy(false)
    }
  }

  if (suggestions) {
    return (
      <SuggestionsPanel
        suggestions={suggestions}
        onAdd={async (moreIds) => {
          await api.face.batchAssign(moreIds, suggestions.clusterId)
          onAssigned()
        }}
        onSkip={onAssigned}
      />
    )
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
                    onClick={() => assignToCluster(c.id, c.person_name)}
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

// ── SuggestionsPanel ──────────────────────────────────────────────────────────

function SuggestionsPanel({
  suggestions,
  onAdd,
  onSkip,
}: {
  suggestions: Suggestions
  onAdd: (faceIds: number[]) => Promise<void>
  onSkip: () => void
}) {
  const [selected, setSelected] = useState<Set<number>>(
    new Set(suggestions.faces.map(f => f.id)),
  )
  const [busy, setBusy] = useState(false)

  function toggle(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleAdd() {
    if (selected.size === 0 || busy) return
    setBusy(true)
    try {
      await onAdd([...selected])
    } finally {
      setBusy(false)
    }
  }

  const clusterLabel = suggestions.clusterName ?? 'this cluster'

  return (
    <div
      className="fixed inset-0 bg-black/85 flex items-center justify-center z-60 p-4"
      onClick={onSkip}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0 animate-pulse" />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-zinc-100">
              {suggestions.faces.length} similar face{suggestions.faces.length !== 1 ? 's' : ''} found
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              These unclassified faces look like{' '}
              <span className="text-zinc-300">{clusterLabel}</span>. Add them too?
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-5 sm:grid-cols-7 md:grid-cols-9 gap-2">
            {suggestions.faces.map(f => {
              const isSel = selected.has(f.id)
              return (
                <div
                  key={f.id}
                  onClick={() => toggle(f.id)}
                  className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer select-none transition-all ${
                    isSel ? 'ring-2 ring-blue-500' : 'opacity-45 hover:opacity-70'
                  }`}
                >
                  <img
                    src={api.faceThumbnailUrl(f.id)}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-0 inset-x-0 text-center text-xs text-zinc-200 bg-black/55 py-px">
                    {Math.round(f.similarity * 100)}%
                  </div>
                  {isSel && (
                    <div className="absolute top-1 right-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleAdd}
              disabled={selected.size === 0 || busy}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {busy ? '…' : `Add ${selected.size} face${selected.size !== 1 ? 's' : ''}`}
            </button>
            <button
              onClick={onSkip}
              className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Skip
            </button>
            <span className="ml-auto text-xs text-zinc-600">
              Click faces to toggle selection
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── PhotoGallery ──────────────────────────────────────────────────────────────

function PhotoGallery({
  faces,
  jumpTo,
}: {
  faces: FaceInfo[]
  jumpTo?: { imageId: number } | null
}) {
  const uniqueImages = [...new Map(faces.map(f => [f.image_id, f])).values()]
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  // Jump to a specific image when requested from FaceGrid
  useEffect(() => {
    if (jumpTo != null) {
      const idx = uniqueImages.findIndex(f => f.image_id === jumpTo.imageId)
      if (idx >= 0) setLightboxIdx(idx)
    }
  }, [jumpTo])

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (lightboxIdx == null) return
      if (e.key === 'ArrowLeft')  setLightboxIdx(i => (i != null && i > 0 ? i - 1 : i))
      if (e.key === 'ArrowRight') setLightboxIdx(i => (i != null && i < uniqueImages.length - 1 ? i + 1 : i))
      if (e.key === 'Escape')     setLightboxIdx(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxIdx, uniqueImages.length])

  if (!uniqueImages.length) {
    return <p className="text-center text-zinc-600 py-10 text-sm">No photos found.</p>
  }

  const currentImage = lightboxIdx != null ? uniqueImages[lightboxIdx] : null

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {uniqueImages.map((f, idx) => (
          <button
            key={f.image_id}
            onClick={() => setLightboxIdx(idx)}
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

      {currentImage != null && lightboxIdx != null && (
        <div
          className="fixed inset-0 bg-black/92 flex items-center justify-center z-60"
          onClick={() => setLightboxIdx(null)}
        >
          {/* Prev arrow */}
          {lightboxIdx > 0 && (
            <button
              onClick={e => { e.stopPropagation(); setLightboxIdx(i => (i != null ? i - 1 : i)) }}
              className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/60 hover:bg-black/85 text-white transition-colors"
              aria-label="Previous"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          {/* Image */}
          <img
            src={api.imageViewUrl(currentImage.image_id, 1600)}
            alt=""
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            style={{ maxHeight: 'calc(100vh - 80px)', maxWidth: 'calc(100vw - 120px)' }}
            onClick={e => e.stopPropagation()}
          />

          {/* Next arrow */}
          {lightboxIdx < uniqueImages.length - 1 && (
            <button
              onClick={e => { e.stopPropagation(); setLightboxIdx(i => (i != null ? i + 1 : i)) }}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/60 hover:bg-black/85 text-white transition-colors"
              aria-label="Next"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}

          {/* Counter + close */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-4">
            <span className="text-sm text-zinc-400 tabular-nums">
              {lightboxIdx + 1} / {uniqueImages.length}
            </span>
          </div>
          <button
            onClick={() => setLightboxIdx(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-black/60 hover:bg-black/85 text-zinc-300 hover:text-white transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
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

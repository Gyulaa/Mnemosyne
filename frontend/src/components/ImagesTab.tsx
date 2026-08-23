import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import { api, downloadViaBrowser } from '../api'
import type { Cluster, ImageItem, ImagePerson, PersonEvent, PersonFull } from '../types'
import { EventEditor, EventIcon, EVENT_TYPE_OPTIONS, formatEventDate } from './EventTimeline'
import { useT, useDateLocale, useSettings, displayPersonName } from '../SettingsContext'
import { ImagePreviewModal } from './ImagePreviewModal'
import { useBackdropClose } from '../modalBackdrop'

type FilterType = 'all' | 'done' | 'no_face' | 'error' | 'pending' | 'private'
type SortOrder = 'id_desc' | 'exif_date_desc' | 'exif_date_asc' | 'filename_asc'
type ViewMode = 'list' | 'grid'

const STATUS_CLS: Record<string, string> = {
  done:    'bg-green-900/50 text-green-400 border-green-800',
  no_face: 'bg-zinc-800 text-zinc-500 border-zinc-700',
  error:   'bg-red-900/50 text-red-400 border-red-800',
  pending: 'bg-amber-900/40 text-amber-400 border-amber-800',
}
const STATUS_KEY: Record<string, string> = {
  done:    'images.statusDone',
  no_face: 'images.statusNoFace',
  error:   'images.statusError',
  pending: 'images.statusPending',
}

function fmtExifDate(iso: string, locale: string) {
  const d = new Date(iso)
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
}

function parseMeta(metaJson: string | null): { width?: number; height?: number; make?: string; model?: string } {
  if (!metaJson) return {}
  try { return JSON.parse(metaJson) } catch { return {} }
}

export default function ImagesTab({
  navFilter,
  openImageTarget,
  onImageTargetConsumed,
  onNavToCluster,
  onNavToEvent,
  onExportStart,
  onExportEnd,
}: {
  navFilter?: { personIds: number[]; key: number } | null
  openImageTarget?: { imageId: number; personIds: number[]; key: number } | null
  onImageTargetConsumed?: () => void
  onNavToCluster?: (clusterId: number) => void
  onNavToEvent?: (eventId: number) => void
  onExportStart?: (cancelFn: () => void) => void
  onExportEnd?: (error?: string) => void
}) {
  const qc = useQueryClient()
  const t = useT()
  const [filter, setFilter] = useState<FilterType>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkPrivacying, setBulkPrivacying] = useState(false)
  const [previewIdx, setPreviewIdx] = useState<number | null>(null)
  const [includePersonIds, setIncludePersonIds] = useState<Set<number>>(new Set())
  const [excludePersonIds, setExcludePersonIds] = useState<Set<number>>(new Set())
  const [includeMode, setIncludeMode] = useState<'or' | 'and'>('or')
  const [showPersonFilter, setShowPersonFilter] = useState(false)
  const [personFilterSearch, setPersonFilterSearch] = useState('')
  const [showAttachModal, setShowAttachModal] = useState(false)

  // Apply external navigation filter (e.g. from Connections edge click → AND mode)
  const prevNavKey = useRef<number | null>(null)
  useEffect(() => {
    if (!navFilter || navFilter.key === prevNavKey.current) return
    prevNavKey.current = navFilter.key
    setIncludePersonIds(new Set(navFilter.personIds))
    setExcludePersonIds(new Set())
    setIncludeMode('and')
    setShowPersonFilter(true)
    setFilter('all')
    setPage(1)
    setSelected(new Set())
  }, [navFilter])

  // Direct image open from external navigation (e.g. "Open in Images" from Clusters)
  const [pendingOpenImageId, setPendingOpenImageId] = useState<number | null>(null)
  const prevOpenKey  = useRef<number | null>(null)
  const isDragging   = useRef(false)
  const dragAction   = useRef<'add' | 'remove'>('add')
  const pressTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wasLongPress = useRef(false)
  useEffect(() => {
    if (!openImageTarget || openImageTarget.key === prevOpenKey.current) return
    prevOpenKey.current = openImageTarget.key
    // Apply person filter so the image shows in context with navigation
    if (openImageTarget.personIds.length > 0) {
      setIncludePersonIds(new Set(openImageTarget.personIds))
      setExcludePersonIds(new Set())
      setIncludeMode('or')
      setShowPersonFilter(true)
      setFilter('all')
      setSelected(new Set())
    }
    // Always start the search from the first page — the walk below only goes
    // forward, so beginning mid-way could step straight past the target.
    setPage(1)
    setPendingOpenImageId(openImageTarget.imageId)
    onImageTargetConsumed?.()
  }, [openImageTarget?.key]) // eslint-disable-line

  useEffect(() => {
    const stop = () => {
      isDragging.current = false
      if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
    }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  const [exportingZip, setExportingZip] = useState(false)
  const [exportingSelected, setExportingSelected] = useState(false)

  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    (localStorage.getItem('img_view_mode') as ViewMode) ?? 'list'
  )
  const [pageSize, setPageSize] = useState<number>(() =>
    Number(localStorage.getItem('img_page_size')) || 50
  )
  const [sort, setSort] = useState<SortOrder>(() =>
    (localStorage.getItem('img_sort') as SortOrder) ?? 'id_desc'
  )

  const { data: clusters = [] } = useQuery<Cluster[]>({
    queryKey: ['clusters'],
    queryFn: api.cluster.list,
    staleTime: 30_000,
  })
  const namedClusters = clusters.filter(c => c.label !== -1 && c.person_id != null && c.person_name != null)

  const incArr = [...includePersonIds].sort()
  const excArr = [...excludePersonIds].sort()

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['images', page, pageSize, filter, search, sort, includeMode, incArr, excArr],
    queryFn: () => api.images.list(page, pageSize, filter, search, sort, incArr, excArr, includeMode),
    staleTime: 10_000,
    placeholderData: prev => prev,
  })

  const { data: imagesWithEventsRaw = [] } = useQuery({
    queryKey: ['images-with-events'],
    queryFn: () => api.images.withEvents(),
    staleTime: 30_000,
  })
  const imagesWithEvents = new Set(imagesWithEventsRaw)

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['images'] })
    qc.invalidateQueries({ queryKey: ['clusters'] })
    qc.invalidateQueries({ queryKey: ['connections'] })
  }

  async function deleteSingle(id: number) {
    try {
      await api.images.delete(id)
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n })
      invalidate()
    } catch (e) {
      alert(t('images.deleteFailed', { e: String(e) }))
    }
  }

  async function deleteSelected() {
    if (!selected.size || bulkDeleting) return
    const n = selected.size
    if (!confirm(t('images.deleteConfirm', { n }))) return
    setBulkDeleting(true)
    try {
      await api.images.bulkDelete([...selected])
      setSelected(new Set())
      invalidate()
    } catch (e) {
      alert(t('images.deleteFailed', { e: String(e) }))
    } finally {
      setBulkDeleting(false)
    }
  }

  async function markSelectedPrivate(isPrivate: boolean) {
    if (!selected.size || bulkPrivacying) return
    setBulkPrivacying(true)
    try {
      await Promise.all([...selected].map(id => api.images.togglePrivacy(id, isPrivate)))
      invalidate()
    } finally {
      setBulkPrivacying(false)
    }
  }

  async function togglePrivacySingle(id: number, isPrivate: boolean) {
    await api.images.togglePrivacy(id, isPrivate)
    invalidate()
  }

  function toggleItem(id: number) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function togglePageAll() {
    const ids = (data?.items ?? []).map(i => i.id)
    const allSel = ids.length > 0 && ids.every(id => selected.has(id))
    setSelected(prev => {
      const n = new Set(prev)
      if (allSel) ids.forEach(id => n.delete(id))
      else ids.forEach(id => n.add(id))
      return n
    })
  }

  async function exportZip() {
    if (exportingZip || total === 0) return
    // Native download — the browser streams to disk and owns the progress UI.
    downloadViaBrowser(api.images.exportUrl(filter, search, sort, incArr, excArr, includeMode))
  }

  async function exportSelected() {
    if (exportingSelected || selected.size === 0) return
    setExportingSelected(true)
    const controller = new AbortController()
    onExportStart?.(() => controller.abort())
    try {
      const blob = await api.images.exportSelectedZip([...selected], controller.signal)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `images_selected_${selected.size}.zip`; a.click()
      URL.revokeObjectURL(url)
      onExportEnd?.()
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') onExportEnd?.()
      else onExportEnd?.(String(e))
    } finally {
      setExportingSelected(false)
    }
  }

  function changeFilter(f: FilterType) { setFilter(f); setPage(1); setSelected(new Set()) }
  function changeSearch(s: string)     { setSearch(s);  setPage(1); setSelected(new Set()) }

  function changeSort(s: SortOrder) {
    setSort(s); setPage(1)
    localStorage.setItem('img_sort', s)
  }
  function changeViewMode(m: ViewMode) {
    setViewMode(m)
    localStorage.setItem('img_view_mode', m)
  }
  function changePageSize(s: number) {
    setPageSize(s); setPage(1)
    localStorage.setItem('img_page_size', String(s))
  }

  function cyclePerson(personId: number) {
    const isInc = includePersonIds.has(personId)
    const isExc = excludePersonIds.has(personId)
    if (!isInc && !isExc) {
      setIncludePersonIds(prev => new Set([...prev, personId]))
    } else if (isInc) {
      setIncludePersonIds(prev => { const n = new Set(prev); n.delete(personId); return n })
      setExcludePersonIds(prev => new Set([...prev, personId]))
    } else {
      setExcludePersonIds(prev => { const n = new Set(prev); n.delete(personId); return n })
    }
    setPage(1)
    setSelected(new Set())
  }

  function clearPersonFilter() {
    setIncludePersonIds(new Set())
    setExcludePersonIds(new Set())
    setIncludeMode('or')
    setPage(1)
  }

  const activePersonFilters = includePersonIds.size + excludePersonIds.size
  const counts = data?.status_counts
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageItems = data?.items ?? []
  const allPageSelected = pageItems.length > 0 && pageItems.every(i => selected.has(i.id))

  // Once filtered images load, find the pending image and open it in the preview modal.
  // If it is not on this page, walk forward until it is: an unfiltered library
  // paginates, so a target arriving from elsewhere (e.g. an assistant link) is
  // usually several pages in, and stopping here would just show the gallery.
  useEffect(() => {
    if (pendingOpenImageId === null || isFetching || !pageItems.length) return
    const idx = pageItems.findIndex(img => img.id === pendingOpenImageId)
    if (idx >= 0) {
      setPreviewIdx(idx)
      setPendingOpenImageId(null)
      return
    }
    if (page < totalPages) setPage(p => p + 1)
    else setPendingOpenImageId(null)   // not in the current filter — give up quietly
  }, [pageItems, pendingOpenImageId, isFetching, page, totalPages])

  function handleDragMouseDown(id: number) {
    return (e: React.MouseEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      wasLongPress.current = false
      pressTimer.current = setTimeout(() => {
        pressTimer.current = null
        wasLongPress.current = true
        isDragging.current = true
        const adding = !selected.has(id)
        dragAction.current = adding ? 'add' : 'remove'
        setSelected(prev => {
          const next = new Set(prev)
          if (adding) next.add(id); else next.delete(id)
          return next
        })
      }, 280)
    }
  }

  function handleDragMouseEnter(id: number) {
    if (!isDragging.current) return
    setSelected(prev => {
      const next = new Set(prev)
      if (dragAction.current === 'add') next.add(id); else next.delete(id)
      return next
    })
  }

  function dragPreview(fn: () => void): () => void {
    return () => {
      if (wasLongPress.current) { wasLongPress.current = false; return }
      fn()
    }
  }

  const filterTabs: { key: FilterType; label: string; count: number | undefined; amber?: boolean }[] = [
    { key: 'all',     label: t('images.filterAll'),      count: counts ? counts.done + counts.no_face + counts.error + counts.pending : undefined },
    { key: 'done',    label: t('images.filterHasFaces'), count: counts?.done },
    { key: 'no_face', label: t('images.filterNoFace'),   count: counts?.no_face },
    { key: 'error',   label: t('images.filterError'),    count: counts?.error },
    { key: 'pending', label: t('images.filterPending'),  count: counts?.pending },
    { key: 'private', label: t('images.filterPrivate'),  count: data?.private_count, amber: true },
  ]

  return (
    <div className={`space-y-4 ${selected.size > 0 ? 'pb-20' : ''}`}>
      {/* Filter tabs + toolbar */}
      <div className="flex items-center gap-1 flex-wrap">
        {filterTabs.map(f => (
          <button
            key={f.key}
            onClick={() => changeFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              f.amber
                ? filter === f.key
                  ? 'bg-amber-900/50 text-amber-300'
                  : 'text-amber-600 hover:text-amber-400 hover:bg-amber-900/30'
                : filter === f.key
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            {f.amber && (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            )}
            {f.label}
            {f.count != null && (
              <span className={`text-xs tabular-nums ${
                f.amber
                  ? filter === f.key ? 'text-amber-500' : 'text-amber-700'
                  : filter === f.key ? 'text-zinc-400' : 'text-zinc-600'
              }`}>
                {f.count.toLocaleString()}
              </span>
            )}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
          {isFetching && !isLoading && (
            <span className="text-xs text-zinc-600">{t('images.refreshing')}</span>
          )}

          {/* Sort */}
          <select
            value={sort}
            onChange={e => changeSort(e.target.value as SortOrder)}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-400 focus:outline-none focus:border-zinc-600 cursor-pointer"
          >
            <option value="id_desc">{t('images.sortRecentScanned')}</option>
            <option value="exif_date_desc">{t('images.sortNewestFirst')}</option>
            <option value="exif_date_asc">{t('images.sortOldestFirst')}</option>
            <option value="filename_asc">{t('images.sortFilename')}</option>
          </select>

          {/* Page size */}
          <select
            value={pageSize}
            onChange={e => changePageSize(Number(e.target.value))}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-400 focus:outline-none focus:border-zinc-600 cursor-pointer"
          >
            <option value={50}>{t('images.perPage', { n: 50 })}</option>
            <option value={100}>{t('images.perPage', { n: 100 })}</option>
            <option value={200}>{t('images.perPage', { n: 200 })}</option>
          </select>

          {/* Export ZIP */}
          {total > 0 && (
            <div className="flex flex-col items-stretch gap-0.5">
              <button
                onClick={exportZip}
                disabled={exportingZip}
                title={t('images.exportTitle', { n: total.toLocaleString() })}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-600 hover:text-zinc-200 rounded-lg text-xs text-zinc-500 transition-colors disabled:opacity-50 disabled:cursor-wait"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {exportingZip ? t('images.buildingZip') : t('images.exportN', { n: total.toLocaleString() })}
              </button>
              {exportingZip && (
                <div className="h-0.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full"
                       style={{ width: '40%', animation: 'indeterminate 1.4s ease-in-out infinite' }} />
                </div>
              )}
            </div>
          )}

          {/* View mode toggle */}
          <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <button
              onClick={() => changeViewMode('list')}
              title={t('images.listView')}
              className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-600 hover:text-zinc-300'}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <button
              onClick={() => changeViewMode('grid')}
              title={t('images.gridView')}
              className={`p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-600 hover:text-zinc-300'}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
            </button>
          </div>

          {/* Person filter button */}
          {namedClusters.length > 0 && (
            <button
              onClick={() => setShowPersonFilter(s => !s)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                showPersonFilter || activePersonFilters > 0
                  ? 'bg-brand-400/20 border-brand-400/40 text-brand-300'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              {t('images.filterByPerson')}
              {activePersonFilters > 0 && (
                <span className="px-1.5 py-0.5 bg-brand-500 text-white rounded-full text-xs leading-none">
                  {activePersonFilters}
                </span>
              )}
            </button>
          )}

          <input
            type="search"
            value={search}
            onChange={e => changeSearch(e.target.value)}
            placeholder={t('images.searchPlaceholder')}
            className="w-64 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
          />
        </div>
      </div>

      {/* Person filter panel */}
      {showPersonFilter && namedClusters.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2.5">
          {/* Top row: instruction + AND/OR toggle + clear */}
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-xs text-zinc-500 flex-1 min-w-0">
              Click once to <span className="text-green-400">{t('images.personFilterHintInclude')}</span>, again to <span className="text-red-400">{t('images.personFilterHintExclude')}</span>{t('images.personFilterHintSuffix')}
            </p>
            {namedClusters.length > 6 && (
              <input
                value={personFilterSearch}
                onChange={e => setPersonFilterSearch(e.target.value)}
                placeholder={t('images.searchByName')}
                className="w-40 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-400 transition-colors"
              />
            )}

            {/* AND / OR toggle — only shown when persons are included */}
            {includePersonIds.size > 1 && (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-zinc-600">{t('images.includedMatch')}</span>
                <div className="flex items-center bg-zinc-800 border border-zinc-700 rounded-lg overflow-hidden text-xs font-medium">
                  <button
                    onClick={() => { setIncludeMode('or'); setPage(1) }}
                    className={`px-2.5 py-1 transition-colors ${includeMode === 'or' ? 'bg-brand-500 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                    title={t('images.matchAnyTitle')}
                  >
                    {t('images.matchAny')}
                  </button>
                  <button
                    onClick={() => { setIncludeMode('and'); setPage(1) }}
                    className={`px-2.5 py-1 transition-colors ${includeMode === 'and' ? 'bg-brand-500 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                    title={t('images.matchAllTitle')}
                  >
                    {t('images.matchAll')}
                  </button>
                </div>
              </div>
            )}

            {activePersonFilters > 0 && (
              <button onClick={clearPersonFilter} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors shrink-0">
                {t('images.clearAll')}
              </button>
            )}
          </div>

          {/* Person chips */}
          <div className="flex flex-wrap gap-1.5">
            {namedClusters.filter(c =>
              !personFilterSearch || (c.person_name ?? '').toLowerCase().includes(personFilterSearch.toLowerCase())
            ).map(c => {
              const pid = c.person_id!
              const isInc = includePersonIds.has(pid)
              const isExc = excludePersonIds.has(pid)
              return (
                <button
                  key={pid}
                  onClick={() => cyclePerson(pid)}
                  title={isInc ? t('images.clickToExclude') : isExc ? t('images.clickToRemoveFilter') : t('images.clickToInclude')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                    isInc ? 'bg-green-900/40 border-green-700/60 text-green-300' :
                    isExc ? 'bg-red-900/40 border-red-700/60 text-red-300' :
                    'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  {c.preview_face_ids[0] != null && (
                    <img src={api.faceThumbnailUrl(c.preview_face_ids[0], 32)} className="w-4 h-4 rounded-full object-cover" alt="" />
                  )}
                  {isInc && <span>✓</span>}
                  {isExc && <span>✗</span>}
                  {c.person_name}
                </button>
              )
            })}
          </div>

          {/* Active filter hint */}
          {includePersonIds.size > 0 && (
            <p className="text-xs text-zinc-700">
              {includeMode === 'and' && includePersonIds.size > 1
                ? t('images.showImagesAll', { n: includePersonIds.size })
                : t('images.showImagesAny')}
            </p>
          )}
        </div>
      )}

      {/* Content */}
      {viewMode === 'list' ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          {/* List header */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800 text-xs text-zinc-500 font-medium uppercase tracking-wide">
            <input
              type="checkbox"
              checked={allPageSelected}
              onChange={togglePageAll}
              className="w-4 h-4 rounded accent-brand-400 shrink-0"
            />
            <span className="w-24 shrink-0" />
            <span className="flex-1">{t('images.headerFile')}</span>
            <span className="w-24 text-center shrink-0">{t('images.headerStatus')}</span>
            <span className="w-14 text-right shrink-0">{t('images.headerFaces')}</span>
            <span className="w-8 shrink-0" />
          </div>

          {isLoading ? (
            <div className="py-16 text-center text-zinc-600 text-sm">{t('images.loading')}</div>
          ) : pageItems.length === 0 ? (
            <div className="py-16 text-center text-zinc-600 text-sm">
              {search.trim() ? t('images.noMatchSearch', { q: search }) : t('images.noMatchFilter')}
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/70">
              {pageItems.map((img, i) => (
                <ImageRow
                  key={img.id}
                  img={img}
                  selected={selected.has(img.id)}
                  hasEvent={imagesWithEvents.has(img.id)}
                  onToggle={() => toggleItem(img.id)}
                  onDelete={() => deleteSingle(img.id)}
                  onPreview={dragPreview(() => setPreviewIdx(i))}
                  onDragMouseDown={handleDragMouseDown(img.id)}
                  onDragMouseEnter={() => handleDragMouseEnter(img.id)}
                  onTogglePrivacy={togglePrivacySingle}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Grid view */
        isLoading ? (
          <div className="py-16 text-center text-zinc-600 text-sm">{t('images.loading')}</div>
        ) : pageItems.length === 0 ? (
          <div className="py-16 text-center text-zinc-600 text-sm">
            {search.trim() ? t('images.noMatchSearch', { q: search }) : t('images.noMatchFilter')}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
            {pageItems.map((img, i) => (
              <ImageCard
                key={img.id}
                img={img}
                selected={selected.has(img.id)}
                hasEvent={imagesWithEvents.has(img.id)}
                onToggle={() => toggleItem(img.id)}
                onDelete={() => deleteSingle(img.id)}
                onPreview={dragPreview(() => setPreviewIdx(i))}
                onDragMouseDown={handleDragMouseDown(img.id)}
                onDragMouseEnter={() => handleDragMouseEnter(img.id)}
                onTogglePrivacy={togglePrivacySingle}
              />
            ))}
          </div>
        )
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-600 tabular-nums">
            {t('images.pageRange', {
              from: ((page - 1) * pageSize + 1).toLocaleString(),
              to: Math.min(page * pageSize, total).toLocaleString(),
              total: total.toLocaleString(),
            })}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(1)} disabled={page === 1}
              className="px-2 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-default transition-colors">«</button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-default transition-colors">← Prev</button>
            <span className="px-3 text-sm text-zinc-500 tabular-nums">{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-default transition-colors">Next →</button>
            <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
              className="px-2 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-default transition-colors">»</button>
          </div>
        </div>
      )}

      {/* Floating bulk toolbar */}
      {selected.size > 0 && (() => {
        const selItems = pageItems.filter(i => selected.has(i.id))
        const allPrivate = selItems.length > 0 && selItems.every(i => i.is_private)
        return (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-6 py-3.5 bg-zinc-900/90 backdrop-blur-xl border border-zinc-700/60 rounded-2xl shadow-2xl">
          <span className="text-sm text-zinc-200 font-semibold tabular-nums">{t('images.selected', { n: selected.size })}</span>
          <div className="w-px h-5 bg-zinc-700 shrink-0" />
          <button
            onClick={() => setShowAttachModal(true)}
            disabled={bulkDeleting || exportingSelected}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {t('images.addToEvent')}
          </button>
          <button
            onClick={exportSelected}
            disabled={exportingSelected || bulkDeleting}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-brand-500 hover:bg-brand-400 disabled:opacity-50 disabled:cursor-wait text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {exportingSelected ? t('images.buildingZip') : t('images.exportN', { n: selected.size })}
          </button>
          <button
            onClick={() => markSelectedPrivate(!allPrivate)}
            disabled={bulkPrivacying || bulkDeleting || exportingSelected}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-800/70 hover:bg-amber-700/80 disabled:opacity-50 text-amber-200 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            {allPrivate ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="11" width="18" height="11" rx="2" /><path strokeLinecap="round" d="M7 11V7a5 5 0 019.9-1" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="11" width="18" height="11" rx="2" /><path strokeLinecap="round" d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
            )}
            {bulkPrivacying ? t('images.saving') : allPrivate ? t('images.makePublic') : t('images.makePrivate')}
          </button>
          <button
            onClick={deleteSelected}
            disabled={bulkDeleting || exportingSelected || bulkPrivacying}
            className="px-4 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            {bulkDeleting ? t('images.deleting') : t('images.deleteN', { n: selected.size })}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="px-3 py-1.5 text-zinc-500 hover:text-zinc-300 text-sm transition-colors whitespace-nowrap"
          >
            {t('images.clearSelection')}
          </button>
        </div>
        )
      })()}

      {showAttachModal && (
        <AttachToEventModal
          imageIds={[...selected]}
          onClose={() => setShowAttachModal(false)}
          onDone={() => { setShowAttachModal(false); setSelected(new Set()) }}
        />
      )}

      {previewIdx !== null && (
        <ImagePreviewModal
          imageIds={pageItems.map(img => img.id)}
          startIdx={previewIdx}
          onClose={() => setPreviewIdx(null)}
          onNavToCluster={onNavToCluster}
          onNavToEvent={onNavToEvent}
          onTogglePrivacy={togglePrivacySingle}
        />
      )}

    </div>
  )
}

// ── ImageCard (grid view) ─────────────────────────────────────────────────────

function ImageCard({
  img,
  selected,
  hasEvent,
  onToggle,
  onDelete,
  onPreview,
  onDragMouseDown,
  onDragMouseEnter,
  onTogglePrivacy,
}: {
  img: ImageItem
  selected: boolean
  hasEvent: boolean
  onToggle: () => void
  onDelete: () => void
  onPreview: () => void
  onDragMouseDown: (e: React.MouseEvent) => void
  onDragMouseEnter: () => void
  onTogglePrivacy: (id: number, isPrivate: boolean) => void
}) {
  const t = useT()
  const dateLocale = useDateLocale()
  const statusCls = STATUS_CLS[img.scan_status] ?? 'bg-zinc-800 text-zinc-400 border-zinc-700'

  return (
    <div
      className={`relative rounded-xl overflow-hidden group bg-zinc-900 border transition-all ${
        selected ? 'border-brand-400 ring-1 ring-brand-400/50' : 'border-zinc-800 hover:border-zinc-600'
      }`}
      onMouseDown={onDragMouseDown}
      onMouseEnter={onDragMouseEnter}
    >
      {/* Image */}
      <button
        onClick={onPreview}
        className="block w-full aspect-[4/3] bg-zinc-800 overflow-hidden focus:outline-none"
      >
        <img
          src={api.imageViewUrl(img.id, 400)}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
      </button>

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all pointer-events-none" />

      {/* Checkbox */}
      <div className="absolute top-2 left-2" onMouseDown={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={e => e.stopPropagation()}
          className="w-4 h-4 rounded accent-brand-400 cursor-pointer"
        />
      </div>

      {/* Event badge */}
      {hasEvent && (
        <div className="absolute top-2 right-5 w-4 h-4 rounded-full bg-brand-500/90 flex items-center justify-center" title={t('images.linkedToEvent')}>
          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
      )}

      {/* Status dot */}
      <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${
        img.scan_status === 'done' ? 'bg-green-500' :
        img.scan_status === 'error' ? 'bg-red-500' :
        img.scan_status === 'pending' ? 'bg-amber-500' : 'bg-zinc-600'
      }`} />

      {/* Private badge */}
      {img.is_private && (
        <button
          onClick={e => { e.stopPropagation(); onTogglePrivacy(img.id, false) }}
          onMouseDown={e => e.stopPropagation()}
          title={t('images.privacyOn')}
          className="absolute bottom-8 right-2 flex items-center gap-1 px-1.5 py-0.5 bg-amber-900/80 hover:bg-amber-800/90 text-amber-300 rounded-md text-xs font-medium transition-colors"
        >
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <rect x="3" y="11" width="18" height="11" rx="2" /><path strokeLinecap="round" d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          {t('images.private')}
        </button>
      )}

      {/* Delete button */}
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        onMouseDown={e => e.stopPropagation()}
        className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 p-1 bg-black/60 hover:bg-red-900/80 text-zinc-400 hover:text-red-300 rounded-lg transition-all"
        title={t('images.removeFromDb')}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0a2 2 0 012-2h4a2 2 0 012 2M4 7h16" />
        </svg>
      </button>

      {/* Bottom info bar */}
      <div className="px-2 py-1.5 border-t border-zinc-800/60">
        <p className="text-xs text-zinc-400 truncate leading-tight" title={img.filename}>{img.filename}</p>
        {img.exif_date ? (
          <p className="text-xs text-zinc-600 leading-tight tabular-nums">{fmtExifDate(img.exif_date, dateLocale)}</p>
        ) : img.face_count > 0 ? (
          <p className="text-xs text-zinc-600 leading-tight">{img.face_count} {img.face_count === 1 ? t('images.face') : t('images.faces')}</p>
        ) : (
          <p className="text-xs leading-tight">
            <span className={`inline-flex px-1.5 py-0.5 rounded text-xs border ${statusCls}`}>{t(STATUS_KEY[img.scan_status] ?? img.scan_status)}</span>
          </p>
        )}
      </div>
    </div>
  )
}


// ── ImageRow (list view) ──────────────────────────────────────────────────────

function ImageRow({
  img,
  selected,
  hasEvent,
  onToggle,
  onDelete,
  onPreview,
  onDragMouseDown,
  onDragMouseEnter,
  onTogglePrivacy,
}: {
  img: ImageItem
  selected: boolean
  hasEvent: boolean
  onToggle: () => void
  onDelete: () => void
  onPreview: () => void
  onDragMouseDown: (e: React.MouseEvent) => void
  onDragMouseEnter: () => void
  onTogglePrivacy: (id: number, isPrivate: boolean) => void
}) {
  const t = useT()
  const dateLocale = useDateLocale()
  const statusCls = STATUS_CLS[img.scan_status] ?? 'bg-zinc-800 text-zinc-400 border-zinc-700'

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2 group transition-colors ${
        selected ? 'bg-brand-900/30' : 'hover:bg-zinc-800/40'
      }`}
      onMouseDown={onDragMouseDown}
      onMouseEnter={onDragMouseEnter}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        className="w-4 h-4 rounded accent-brand-400 shrink-0"
      />

      {/* Thumbnail */}
      <button
        onClick={onPreview}
        className="w-24 h-16 rounded-lg overflow-hidden bg-zinc-800 shrink-0 hover:ring-2 hover:ring-brand-400 transition-all focus:outline-none focus:ring-2 focus:ring-brand-400"
        title={t('images.clickToPreview')}
      >
        <img
          src={api.imageViewUrl(img.id, 160)}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover"
        />
      </button>

      {/* Filename + folder + date */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-zinc-200 truncate" title={img.path}>
            {img.filename}
          </p>
          {hasEvent && (
            <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-medium bg-brand-900/60 text-brand-400 border border-brand-700/50" title={t('images.linkedToEvent')}>
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {t('images.event')}
            </span>
          )}
          {img.is_private && (
            <button
              onClick={e => { e.stopPropagation(); onTogglePrivacy(img.id, false) }}
              onMouseDown={e => e.stopPropagation()}
              title={t('images.privacyOn')}
              className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-900/60 text-amber-300 border border-amber-700/50 hover:bg-amber-800/80 transition-colors"
            >
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <rect x="3" y="11" width="18" height="11" rx="2" /><path strokeLinecap="round" d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              {t('images.private')}
            </button>
          )}
        </div>
        <p className="text-xs text-zinc-600 truncate" title={img.folder}>
          {img.folder}
        </p>
        {img.exif_date && (
          <p className="text-xs text-zinc-500 tabular-nums">
            {new Date(img.exif_date).toLocaleString(dateLocale)}
          </p>
        )}
        {img.error_msg && (
          <p className="text-xs text-red-400/80 truncate mt-0.5" title={img.error_msg}>
            {img.error_msg}
          </p>
        )}
      </div>

      {/* Status badge */}
      <div className="w-24 flex justify-center shrink-0">
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${statusCls}`}>
          {t(STATUS_KEY[img.scan_status] ?? img.scan_status)}
        </span>
      </div>

      {/* Face count */}
      <div className="w-14 text-right shrink-0">
        {img.face_count > 0 && (
          <span className="text-sm tabular-nums text-zinc-400">{img.face_count}</span>
        )}
      </div>

      {/* Delete */}
      <div className="w-8 flex justify-center shrink-0">
        <button
          onClick={onDelete}
          onMouseDown={e => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-100 p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-900/30 rounded-lg transition-all"
          title={t('images.removeFromDb')}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0a2 2 0 012-2h4a2 2 0 012 2M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ── AttachToEventModal ────────────────────────────────────────────────────────

interface ParticipantCandidate {
  person_id: number
  person_name: string | null
  face_id: number | null
  manual: boolean
}

function AttachToEventModal({ imageIds, onClose, onDone }: {
  imageIds: number[]
  onClose: () => void
  onDone: () => void
}) {
  const qc = useQueryClient()
  const t = useT()
  const dateLocale = useDateLocale()
  const { nameOrder } = useSettings()
  const [search, setSearch] = useState('')
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [step, setStep] = useState<'select' | 'persons' | 'success'>('select')
  const [attachedCount, setAttachedCount] = useState(0)
  const [participants, setParticipants] = useState<ParticipantCandidate[]>([])
  const [includedPersonIds, setIncludedPersonIds] = useState<Set<number>>(new Set())
  const [primaryPersonIds, setPrimaryPersonIds] = useState<Set<number>>(new Set())
  const [showCreate, setShowCreate] = useState(false)
  const [showPersonSearch, setShowPersonSearch] = useState(false)
  const [personSearchQ, setPersonSearchQ] = useState('')

  const { data: events = [], refetch: refetchEvents } = useQuery<PersonEvent[]>({
    queryKey: ['events-all'],
    queryFn: () => api.events.list(false),
    staleTime: 10_000,
  })

  const { data: allPersons = [] } = useQuery<PersonFull[]>({
    queryKey: ['persons'],
    queryFn: api.persons.list,
    staleTime: 60_000,
  })

  const filtered = events.filter(ev => {
    const q = search.toLowerCase()
    if (!q) return true
    const typeLabel = EVENT_TYPE_OPTIONS.find(o => o.value === ev.event_type)?.label ?? ''
    return (ev.title ?? '').toLowerCase().includes(q)
      || typeLabel.toLowerCase().includes(q)
      || (ev.place ?? '').toLowerCase().includes(q)
  })

  const selectedEvent = events.find(e => e.id === selectedEventId)

  async function handleAttach() {
    if (!selectedEventId || attaching) return
    setAttaching(true)

    // 1. Attach images
    let count = 0
    for (const imgId of imageIds) {
      try { await api.events.addImage(selectedEventId, imgId); count++ } catch { /* skip dupes */ }
    }
    setAttachedCount(count)
    qc.invalidateQueries({ queryKey: ['events'] })
    qc.invalidateQueries({ queryKey: ['images-with-events'] })

    // 2. Discover persons in these images not already in the event
    const existingPersonIds = new Set(selectedEvent?.persons.map(ep => ep.person_id) ?? [])
    const personMap = new Map<number, ImagePerson>()
    await Promise.all(imageIds.map(async imgId => {
      try {
        const persons = await api.images.persons(imgId)
        for (const p of persons) {
          if (!existingPersonIds.has(p.person_id) && !personMap.has(p.person_id)) {
            personMap.set(p.person_id, p)
          }
        }
      } catch { /* ignore */ }
    }))

    setAttaching(false)
    const candidates: ParticipantCandidate[] = [...personMap.values()].map(p => ({
      person_id: p.person_id, person_name: p.person_name, face_id: p.face_id, manual: false,
    }))
    if (candidates.length > 0) {
      setParticipants(candidates)
      setIncludedPersonIds(new Set(candidates.map(p => p.person_id)))
      setPrimaryPersonIds(new Set())
      setStep('persons')
    } else {
      setStep('success')
      setTimeout(onDone, 1400)
    }
  }

  async function handleConfirmPersons() {
    if (!selectedEventId) return
    setAttaching(true)
    for (const pid of includedPersonIds) {
      const role = primaryPersonIds.has(pid) ? 'primary' : 'participant'
      try { await api.events.addPerson(selectedEventId, pid, role) } catch { /* ignore dupes */ }
    }
    qc.invalidateQueries({ queryKey: ['events'] })
    setAttaching(false)
    setStep('success')
    setTimeout(onDone, 1400)
  }

  function toggleIncluded(pid: number) {
    const wasIncluded = includedPersonIds.has(pid)
    setIncludedPersonIds(prev => {
      const next = new Set(prev)
      wasIncluded ? next.delete(pid) : next.add(pid)
      return next
    })
    if (wasIncluded) {
      setPrimaryPersonIds(prev => {
        if (!prev.has(pid)) return prev
        const next = new Set(prev)
        next.delete(pid)
        return next
      })
    }
  }

  function togglePrimary(pid: number) {
    setPrimaryPersonIds(prev => {
      const next = new Set(prev)
      next.has(pid) ? next.delete(pid) : next.add(pid)
      return next
    })
  }

  const existingParticipantIds = new Set(participants.map(p => p.person_id))
  const extraSearchResults = personSearchQ.trim()
    ? allPersons.filter(p => !existingParticipantIds.has(p.id) && displayPersonName(p, nameOrder).toLowerCase().includes(personSearchQ.trim().toLowerCase())).slice(0, 8)
    : []

  function addExtraPerson(p: PersonFull) {
    setParticipants(prev => [...prev, { person_id: p.id, person_name: displayPersonName(p, nameOrder), face_id: p.thumbnail_face_id, manual: true }])
    setIncludedPersonIds(prev => new Set(prev).add(p.id))
    setPersonSearchQ('')
    setShowPersonSearch(false)
  }

  function removeParticipant(pid: number) {
    setParticipants(prev => prev.filter(p => p.person_id !== pid))
    setIncludedPersonIds(prev => { const next = new Set(prev); next.delete(pid); return next })
    setPrimaryPersonIds(prev => { const next = new Set(prev); next.delete(pid); return next })
  }

  function handleCreated(ev: PersonEvent) {
    setShowCreate(false)
    setSearch('')
    setSelectedEventId(ev.id)
    refetchEvents()
  }

  const backdrop = useBackdropClose(onClose)

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70" {...backdrop}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl flex flex-col"
        style={{ width: 520, maxHeight: '80vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 shrink-0">
          <div>
            <p className="text-sm font-semibold text-zinc-100">
              {step === 'persons' ? 'Who else was there?' : 'Add to event'}
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {step === 'persons'
                ? `${attachedCount} photo${attachedCount !== 1 ? 's' : ''} attached — add participants?`
                : `${imageIds.length} photo${imageIds.length !== 1 ? 's' : ''} selected`}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Success ── */}
        {step === 'success' && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-14 h-14 rounded-full bg-green-900/40 border border-green-700/50 flex items-center justify-center">
              <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-zinc-200">
              {attachedCount} photo{attachedCount !== 1 ? 's' : ''} added
            </p>
            {selectedEvent && (
              <p className="text-xs text-zinc-500">
                {selectedEvent.title ?? (EVENT_TYPE_OPTIONS.find(o => o.value === selectedEvent.event_type)?.label ?? selectedEvent.event_type)}
              </p>
            )}
          </div>
        )}

        {/* ── Who else was there? ── */}
        {step === 'persons' && (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0">
              <p className="text-xs text-zinc-400 leading-relaxed">
                {t('images.whoElseHint')}
              </p>
              <div className="space-y-1">
                {participants.map(p => {
                  const included = includedPersonIds.has(p.person_id)
                  const isPrimary = primaryPersonIds.has(p.person_id)
                  return (
                    <div key={p.person_id} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-zinc-800 transition-colors">
                      <input type="checkbox" checked={included} onChange={() => toggleIncluded(p.person_id)}
                        className="w-4 h-4 accent-brand-500 shrink-0 cursor-pointer" />
                      {p.face_id != null ? (
                        <img src={api.faceThumbnailUrl(p.face_id, 48)} alt=""
                          className="w-8 h-8 rounded-full object-cover shrink-0 border border-zinc-700" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-zinc-700 shrink-0 flex items-center justify-center text-xs text-zinc-400 border border-zinc-700">
                          {(p.person_name ?? '?')[0]}
                        </div>
                      )}
                      <span className="text-sm text-zinc-200 flex-1 min-w-0 truncate">{p.person_name ?? t('images.unnamed')}</span>
                      <button
                        onClick={() => togglePrimary(p.person_id)}
                        disabled={!included}
                        className={`shrink-0 px-2 py-1 rounded-full text-xs font-medium border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                          isPrimary
                            ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                            : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
                        }`}
                      >
                        {isPrimary ? `★ ${t('timeline.primary')}` : t('images.setPrimary')}
                      </button>
                      {p.manual && (
                        <button onClick={() => removeParticipant(p.person_id)}
                          className="shrink-0 text-zinc-600 hover:text-red-400 transition-colors text-xs">✕</button>
                      )}
                    </div>
                  )
                })}
              </div>

              {showPersonSearch ? (
                <div className="relative">
                  <input
                    autoFocus
                    value={personSearchQ}
                    onChange={e => setPersonSearchQ(e.target.value)}
                    placeholder={t('docs.searchPersons')}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400"
                  />
                  {extraSearchResults.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-zinc-800 border border-zinc-700 rounded-xl shadow-xl z-20 overflow-hidden">
                      {extraSearchResults.map(p => (
                        <button key={p.id} onClick={() => addExtraPerson(p)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-700 text-left transition-colors">
                          {p.thumbnail_face_id
                            ? <img src={api.faceThumbnailUrl(p.thumbnail_face_id, 32)} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
                            : <div className="w-5 h-5 rounded-full bg-zinc-600 shrink-0 flex items-center justify-center text-xs text-zinc-400">{(p.name ?? '?')[0]}</div>}
                          <span className="text-xs text-zinc-200 truncate">{displayPersonName(p, nameOrder)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={() => { setShowPersonSearch(false); setPersonSearchQ('') }}
                    className="mt-1 text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
                    {t('timeline.cancelSearch')}
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowPersonSearch(true)}
                  className="text-xs text-zinc-600 hover:text-brand-400 transition-colors">
                  {t('images.addPerson')}
                </button>
              )}
            </div>
            <div className="shrink-0 flex gap-2 px-5 py-3.5 border-t border-zinc-800">
              <button
                onClick={() => { setStep('success'); setTimeout(onDone, 1400) }}
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
              >
                Skip
              </button>
              <button
                onClick={handleConfirmPersons}
                disabled={attaching}
                className="flex-1 px-3 py-1.5 text-xs font-medium bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {attaching
                  ? 'Adding…'
                  : includedPersonIds.size > 0
                    ? `Add ${includedPersonIds.size} participant${includedPersonIds.size !== 1 ? 's' : ''}`
                    : 'Confirm (none selected)'}
              </button>
            </div>
          </>
        )}

        {/* ── Select event ── */}
        {step === 'select' && (
          showCreate ? (
            <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
              <p className="text-xs text-zinc-500 mb-2">{t('images.createSelectEvent')}</p>
              <EventEditor
                event={null}
                prefill={search.trim() ? { title: search.trim() } : undefined}
                persons={[]}
                onSaved={handleCreated}
                onCancel={() => setShowCreate(false)}
              />
            </div>
          ) : (
            <>
              <div className="px-5 pt-4 pb-3 space-y-3 shrink-0">
                <div className="flex gap-2">
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={t('images.searchEvents')}
                    autoFocus
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400"
                  />
                  <button
                    onClick={() => setShowCreate(true)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
                  >
                    {t('images.newEvent')}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 pb-3 space-y-1 min-h-0">
                {filtered.length === 0 ? (
                  <p className="text-sm text-zinc-600 italic text-center py-8">
                    {search ? `No events match "${search}"` : 'No events yet. Create one above.'}
                  </p>
                ) : filtered.map(ev => {
                  const typeLabel = EVENT_TYPE_OPTIONS.find(o => o.value === ev.event_type)?.label ?? ev.event_type
                  const dateStr = formatEventDate(ev.date, ev.year, dateLocale)
                  const isSelected = ev.id === selectedEventId
                  return (
                    <button
                      key={ev.id}
                      onClick={() => setSelectedEventId(isSelected ? null : ev.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                        isSelected
                          ? 'bg-brand-500/20 border border-brand-500/40'
                          : 'border border-transparent hover:border-zinc-700 hover:bg-zinc-800/50'
                      }`}
                    >
                      <div className="shrink-0"><EventIcon type={ev.event_type} /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-zinc-100 truncate">{ev.title || typeLabel}</p>
                        {ev.title && <p className="text-xs text-zinc-500">{typeLabel}</p>}
                        {(dateStr || ev.place) && (
                          <p className="text-xs text-zinc-500 truncate">{[dateStr, ev.place].filter(Boolean).join(' · ')}</p>
                        )}
                      </div>
                      {ev.images.length > 0 && (
                        <span className="text-xs text-zinc-600 shrink-0 tabular-nums">
                          {ev.images.length} photo{ev.images.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-brand-500 flex items-center justify-center shrink-0">
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>

              <div className="shrink-0 flex gap-2 px-5 py-3.5 border-t border-zinc-800">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAttach}
                  disabled={!selectedEventId || attaching}
                  className="flex-1 px-3 py-1.5 text-xs font-medium bg-brand-500 hover:bg-brand-400 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                >
                  {attaching
                    ? 'Attaching…'
                    : selectedEventId
                      ? `Attach ${imageIds.length} photo${imageIds.length !== 1 ? 's' : ''}`
                      : 'Select an event above'}
                </button>
              </div>
            </>
          )
        )}
      </div>
    </div>,
    document.body,
  )
}

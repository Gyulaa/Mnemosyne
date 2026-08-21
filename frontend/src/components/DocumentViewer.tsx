import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { PersonDocument, PersonFull, DocumentNote, NoteCitation, Source } from '../types'
import { useSettings, useDateLocale, formatPartialDate, displayPersonName, displayInitials, useT } from '../SettingsContext'
import { NoteCard } from './NoteEditor'
import NoteEditorComponent from './NoteEditor'
import { renderMarkdown, renderTitleMentions, plainMentions } from '../markdown'
import { docTypeLabel } from '../docTypes'
import { DescriptionField, persistDescriptionCitations, linkMentionedPersons } from './DescriptionField'

function isImage(mime: string | null) { return mime?.startsWith('image/') ?? false }
function isPdf(mime: string | null)   { return mime === 'application/pdf' }
function isAudio(mime: string | null) { return mime?.startsWith('audio/') ?? false }
function isVideo(mime: string | null) { return mime?.startsWith('video/') ?? false }

// ── MediaCarousel ─────────────────────────────────────────────────────────────

interface CarouselItem {
  key: string
  url: string
  mimeType: string | null
  filename?: string | null
  caption?: string | null
}

function genericFileIcon(mime: string | null) {
  if (isPdf(mime)) return (
    <svg className="w-12 h-12 text-red-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  )
  if (isAudio(mime)) return (
    <svg className="w-12 h-12 text-violet-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z"/>
    </svg>
  )
  if (isVideo(mime)) return (
    <svg className="w-12 h-12 text-sky-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-2.36a.75.75 0 011.03.671v10.378a.75.75 0 01-1.03.671L15.75 17.5M4.5 6.75h9a1.5 1.5 0 011.5 1.5v9a1.5 1.5 0 01-1.5 1.5h-9a1.5 1.5 0 01-1.5-1.5v-9a1.5 1.5 0 011.5-1.5z"/>
    </svg>
  )
  return (
    <svg className="w-12 h-12 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
    </svg>
  )
}

// ── DescriptionEditor ────────────────────────────────────────────────────────

/**
 * The carousel panel's wrapper around the shared `DescriptionField`: it owns the
 * draft, the Save/Cancel pair and the persisting. The editing surface itself —
 * toolbar, mentions, citations — is in `DescriptionField.tsx`, shared with the
 * document edit modal.
 */
function DescriptionEditor({ docId, initialValue, initialCitations, initialLinkedIds, onSaved, onCancel }: {
  docId: number
  initialValue: string
  initialCitations: NoteCitation[]
  initialLinkedIds: Set<number>
  onSaved: (next: { description: string; citations: NoteCitation[]; linkedIds: Set<number> }) => void
  onCancel: () => void
}) {
  const t = useT()
  const [content, setContent] = useState(initialValue)
  const [citations, setCitations] = useState<NoteCitation[]>(initialCitations)
  const [linkedIds, setLinkedIds] = useState(initialLinkedIds)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setSaving(true); setErr(null)
    try {
      await api.documents.update(docId, { description: content.trim() || null })
      await linkMentionedPersons(docId, initialLinkedIds, linkedIds)
      await persistDescriptionCitations(docId, initialCitations, citations)
      onSaved({ description: content.trim(), citations, linkedIds })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 px-5 pb-4 gap-2">
      <DescriptionField
        docId={docId}
        value={content} onChange={setContent}
        citations={citations} onCitationsChange={setCitations}
        onMentionPerson={p => setLinkedIds(prev => prev.has(p.id) ? prev : new Set(prev).add(p.id))}
        autoFocus
      />

      {err && <p className="text-xs text-red-400 shrink-0">{err}</p>}

      <div className="flex gap-2 shrink-0">
        <button onClick={save} disabled={saving}
          className="flex-1 h-8 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-medium transition-colors">
          {saving ? t('docs.saving') : t('docs.save')}
        </button>
        <button onClick={onCancel} disabled={saving}
          className="px-3 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors">
          {t('docs.cancel')}
        </button>
      </div>
    </div>
  )
}


const ZOOM_MIN = 1
const ZOOM_MAX = 4
const ZOOM_STEP = 0.25
// Zoom grows the display box itself first (1x → BOX_GROW_MAX_ZOOM), so the
// image visibly gets bigger instead of cropping inside its resting frame;
// only past that point does further zoom crop into detail.
const BOX_GROW_MAX_ZOOM = 2
const FIT_MAX_W_VW = 90
const FIT_MAX_H_VH = 78
const GROWN_MAX_W_VW = 96
const GROWN_MAX_H_VH = 92
const SIDEBAR_MIN_W = 240
const SIDEBAR_MAX_W = 560
const SIDEBAR_DEFAULT_W = 320
const EDGE_GAP = 16
const TAB_W = 36
const TAB_GAP = 16

/**
 * Full-screen browser for a document's photos or attached files — opened from
 * a grid or the preview. `description` — the document's own description — is
 * shown in a collapsible, resizable side panel so a scanned letter can be
 * compared directly against its typed transcript.
 */
function MediaCarousel({ items, startIndex, description, descriptionCitations, linkedPersonIds, docId, onNavToPerson, onDescriptionSaved, onClose }: {
  items: CarouselItem[]
  startIndex: number
  description?: string | null
  descriptionCitations: NoteCitation[]
  linkedPersonIds: Set<number>
  docId: number
  onNavToPerson: (personId: number) => void
  onDescriptionSaved?: (next: { description: string | null; citations: NoteCitation[]; linkedIds: Set<number> }) => void
  onClose: () => void
}) {
  const t = useT()
  const [index, setIndex] = useState(startIndex)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(!!description)
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const [desc, setDesc] = useState(description ?? '')
  const [descCitations, setDescCitations] = useState(descriptionCitations)
  const [descLinkedIds, setDescLinkedIds] = useState(linkedPersonIds)
  const [editingDesc, setEditingDesc] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('mnemosyne_docDescWidth') ?? '')
    return Number.isFinite(saved) && saved >= SIDEBAR_MIN_W && saved <= SIDEBAR_MAX_W ? saved : SIDEBAR_DEFAULT_W
  })
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const imgWrapRef = useRef<HTMLDivElement>(null)
  const current = items[index]

  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [index])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') setIndex(i => (i - 1 + items.length) % items.length)
      if (e.key === 'ArrowRight') setIndex(i => (i + 1) % items.length)
      if (e.key === '+' || e.key === '=') zoomBy(ZOOM_STEP)
      if (e.key === '-') zoomBy(-ZOOM_STEP)
      if (e.key === '0') resetZoom()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [items.length, onClose]) // eslint-disable-line react-hooks/exhaustive-deps

  // React attaches `wheel` as a passive listener, which silently ignores
  // preventDefault() — a native listener is the only way to stop the page
  // from scrolling under the zoomed image. No dependency array: the wrapper
  // div only exists for image items, so this has to re-bind on every render
  // to follow the ref as items switch between image and non-image.
  useEffect(() => {
    const el = imgWrapRef.current
    if (!el) return
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      zoomBy(e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP)
    }
    el.addEventListener('wheel', onWheelNative, { passive: false })
    return () => el.removeEventListener('wheel', onWheelNative)
  })

  if (!current) return null

  function zoomBy(delta: number) {
    setZoom(z => {
      const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 100) / 100))
      if (nz === ZOOM_MIN) setPan({ x: 0, y: 0 })
      return nz
    })
  }
  function resetZoom() { setZoom(1); setPan({ x: 0, y: 0 }) }

  // How much of the growth-vs-crop budget has been used (0 at rest, 1 once
  // the box has reached its cap), and the box size and crop scale that follow
  // from it.
  const growT = Math.min(zoom, BOX_GROW_MAX_ZOOM) - 1
  const boxMaxWidthVw = FIT_MAX_W_VW + growT * (GROWN_MAX_W_VW - FIT_MAX_W_VW)
  const boxMaxHeightVh = FIT_MAX_H_VH + growT * (GROWN_MAX_H_VH - FIT_MAX_H_VH)
  const detailZoom = Math.max(1, zoom / BOX_GROW_MAX_ZOOM)

  function handleMouseDown(e: React.MouseEvent) {
    if (detailZoom <= 1) return
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }
  function handleMouseMove(e: React.MouseEvent) {
    if (!dragging) return
    setPan({ x: dragStart.current.panX + (e.clientX - dragStart.current.x), y: dragStart.current.panY + (e.clientY - dragStart.current.y) })
  }
  function stopDragging() { setDragging(false) }

  // Drag the panel's left edge to resize; persisted so it survives a reload —
  // the same mechanic as the AI assistant panel's resize grip.
  function startSidebarResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = sidebarWidth
    // The media re-centres against the panel's width, and an eased transition
    // on that would visibly trail the pointer — so it is off while dragging and
    // back on for the toggle, where the animation is the point.
    setSidebarResizing(true)
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, startWidth + (startX - ev.clientX)))
      setSidebarWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
      setSidebarResizing(false)
      setSidebarWidth(w => { localStorage.setItem('mnemosyne_docDescWidth', String(w)); return w })
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const showImage = isImage(current.mimeType)

  // The description panel docks to the screen's right edge, independent of
  // the image, with its own tab attached to its left side — so the close
  // button and the next-page arrow (both vertically centered like the tab)
  // have to clear whichever is currently showing, not just the sidebar
  // itself, or they collide with it.
  const railReserved = !desc
    ? 0
    : sidebarOpen
      ? EDGE_GAP + sidebarWidth + TAB_W + TAB_GAP
      : EDGE_GAP + 36 + TAB_GAP

  return createPortal(
    <div className="fixed inset-0 z-[800] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4" onClick={onClose}>
      <button onClick={onClose}
        style={{ right: 16 + railReserved }}
        className="absolute top-4 z-20 w-9 h-9 rounded-full bg-zinc-800/80 hover:bg-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white transition-colors">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M6 6l12 12M6 18L18 6"/></svg>
      </button>

      {items.length > 1 && (
        <button onClick={e => { e.stopPropagation(); setIndex(i => (i - 1 + items.length) % items.length) }}
          title={t('docViewer.carouselPrev')}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-zinc-800/80 hover:bg-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
        </button>
      )}
      {items.length > 1 && (
        <button onClick={e => { e.stopPropagation(); setIndex(i => (i + 1) % items.length) }}
          title={t('docViewer.carouselNext')}
          style={{ right: 12 + railReserved }}
          className="absolute top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-zinc-800/80 hover:bg-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
        </button>
      )}

      {/* Centred in the space *left of the panel*, not on the screen. The
          overlay is `justify-center` across the full width, so a right margin
          equal to the reserved rail moves the centre to (W - rail) / 2 —
          exactly the middle of what the reader can actually see. Widening the
          panel therefore slides the media left instead of hiding it. */}
      <div className="flex flex-col items-center gap-3"
        style={{
          maxWidth: `calc(${boxMaxWidthVw}vw - ${railReserved}px)`,
          maxHeight: `calc(${boxMaxHeightVh}vh + 56px)`,
          marginRight: railReserved,
          transition: sidebarResizing ? 'none' : 'margin-right 0.15s ease-out',
        }}
        onClick={e => e.stopPropagation()}>
        {showImage ? (
          <div ref={imgWrapRef}
            className="overflow-hidden rounded-lg flex items-center justify-center"
            style={{
              maxWidth: `${boxMaxWidthVw}vw`, maxHeight: `${boxMaxHeightVh}vh`,
              transition: dragging ? 'none' : 'max-width 0.15s ease-out, max-height 0.15s ease-out',
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={stopDragging}
            onMouseLeave={stopDragging}
            onDoubleClick={() => (zoom > 1 ? resetZoom() : zoomBy(2))}
          >
            <img src={current.url} alt={current.filename ?? current.caption ?? ''} draggable={false}
              className="object-contain select-none"
              style={{
                maxWidth: `${boxMaxWidthVw}vw`, maxHeight: `${boxMaxHeightVh}vh`,
                transform: `scale(${detailZoom}) translate(${pan.x / detailZoom}px, ${pan.y / detailZoom}px)`,
                transition: dragging ? 'none' : 'transform 0.15s ease-out, max-width 0.15s ease-out, max-height 0.15s ease-out',
                cursor: detailZoom > 1 ? (dragging ? 'grabbing' : 'grab') : zoom < ZOOM_MAX ? 'zoom-in' : 'default',
              }} />
          </div>
        ) : (
          <div className="w-[320px] max-w-[80vw] flex flex-col items-center gap-4 bg-zinc-900 border border-zinc-700 rounded-2xl px-8 py-12">
            {genericFileIcon(current.mimeType)}
            {current.filename && <p className="text-sm text-zinc-200 text-center break-all">{current.filename}</p>}
            <a href={current.url} target="_blank" rel="noreferrer"
              className="text-xs text-brand-400 hover:text-brand-300 underline underline-offset-2 transition-colors">
              {t('docViewer.open')}
            </a>
          </div>
        )}

        <div className="flex items-center gap-3 text-xs text-zinc-400">
          {items.length > 1 && <span className="tabular-nums">{index + 1} / {items.length}</span>}
          {current.caption && <span className="text-zinc-300">{current.caption}</span>}
          {showImage && (
            <div className="flex items-center gap-1">
              <button onClick={() => zoomBy(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} title={t('docViewer.zoomOut')}
                className="w-6 h-6 rounded flex items-center justify-center bg-zinc-800/80 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 transition-colors">−</button>
              <button onClick={resetZoom} title={t('docViewer.zoomReset')}
                className="w-11 text-center tabular-nums hover:text-zinc-200 transition-colors">{Math.round(zoom * 100)}%</button>
              <button onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} title={t('docViewer.zoomIn')}
                className="w-6 h-6 rounded flex items-center justify-center bg-zinc-800/80 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 transition-colors">+</button>
            </div>
          )}
        </div>
      </div>

      {/* Description panel — docked to the right edge, independent of the image, so
          comparing a scanned letter against its typed transcript never fights it for space. */}
      {desc && !sidebarOpen && (
        <button onClick={e => { e.stopPropagation(); setSidebarOpen(true) }}
          title={t('docViewer.expandDescription')}
          className="absolute top-1/2 -translate-y-1/2 right-4 z-20 w-9 h-9 rounded-full bg-zinc-800/80 hover:bg-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
          </svg>
        </button>
      )}
      {desc && sidebarOpen && (
        <div onClick={e => e.stopPropagation()}
          style={{ width: sidebarWidth }}
          className="absolute top-4 bottom-4 right-4 max-w-[85vw] bg-zinc-900 border border-zinc-700 rounded-2xl flex flex-col">
          {/* A tab attached to the panel's own edge — visually part of it, not
              another circle sitting next to the prev/next arrows. */}
          <button onClick={() => setSidebarOpen(false)}
            title={t('docViewer.collapseDescription')}
            style={{ left: -TAB_W, width: TAB_W, height: 56 }}
            className="absolute top-1/2 -translate-y-1/2 z-10 rounded-l-full bg-zinc-800/90 hover:bg-zinc-700 border border-r-0 border-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white shadow-lg transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
            </svg>
          </button>
          {/* Resize grip — same mechanic as the AI assistant panel's. */}
          <div
            onPointerDown={startSidebarResize}
            onDoubleClick={() => { setSidebarWidth(SIDEBAR_DEFAULT_W); localStorage.setItem('mnemosyne_docDescWidth', String(SIDEBAR_DEFAULT_W)) }}
            title={t('docViewer.resizeDescription')}
            className="absolute inset-y-0 -left-1 w-2 cursor-col-resize z-20 group">
            <div className="absolute inset-y-0 left-1 w-px bg-transparent group-hover:bg-brand-500/60 transition-colors" />
          </div>

          <div className="shrink-0 flex items-center justify-between px-5 pt-4 pb-2">
            <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">{t('docViewer.description')}</p>
            {!editingDesc && (
              <button onClick={() => setEditingDesc(true)}
                title={t('docViewer.editDescription')}
                className="w-6 h-6 rounded flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2.25 2.25 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2.414a2 2 0 01.586-1.414z"/>
                </svg>
              </button>
            )}
          </div>

          {editingDesc ? (
            <DescriptionEditor
              docId={docId}
              initialValue={desc}
              initialCitations={descCitations}
              initialLinkedIds={descLinkedIds}
              onCancel={() => setEditingDesc(false)}
              onSaved={next => {
                setDesc(next.description ?? '')
                setDescCitations(next.citations)
                setDescLinkedIds(next.linkedIds)
                setEditingDesc(false)
                onDescriptionSaved?.(next)
              }}
            />
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4">
              <div className="note-content text-sm text-zinc-300 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(desc, descCitations) }}
                onClick={e => {
                  const anchor = (e.target as Element).closest('a.note-person-ref')
                  if (!anchor) return
                  e.preventDefault()
                  const match = (anchor as HTMLAnchorElement).getAttribute('href')?.match(/person-ref-(\d+)$/)
                  if (match) onNavToPerson(parseInt(match[1]))
                }} />
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  )
}

function PersonAvatar({ person }: { person: PersonFull }) {
  const [err, setErr] = useState(false)
  const init = displayInitials(person)
  if (person.thumbnail_face_id && !err) {
    return (
      <img
        src={api.faceThumbnailUrl(person.thumbnail_face_id, 80)}
        className="w-full h-full object-cover"
        onError={() => setErr(true)}
      />
    )
  }
  return <span className="text-sm font-bold text-zinc-300">{init}</span>
}


interface Props {
  doc: PersonDocument
  onClose: () => void
  onNavToPerson: (personId: number) => void
  onNavToDocument?: (docId: number, editMode?: boolean) => void
}

export default function DocumentViewer({ doc, onClose, onNavToPerson, onNavToDocument }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const { nameOrder } = useSettings()
  const dateLocale = useDateLocale()
  const [imageCarouselIndex, setImageCarouselIndex] = useState<number | null>(null)
  const [fileCarouselIndex, setFileCarouselIndex] = useState<number | null>(null)
  const { data: persons = [] }   = useQuery<PersonFull[]>({ queryKey: ['persons'], queryFn: api.persons.list })
  const { data: types = [] }     = useQuery({ queryKey: ['doc-types'], queryFn: api.documentTypes.list })
  const { data: sources = [] }   = useQuery<Source[]>({ queryKey: ['sources'], queryFn: api.sources.list })
  const {
    data: docNotes = [],
    refetch: refetchNotes,
  } = useQuery<DocumentNote[]>({
    queryKey: ['document-notes', doc.id],
    queryFn: () => api.documentNotes.list(doc.id),
  })

  const [creatingNote, setCreatingNote] = useState(false)
  const [newNoteShell, setNewNoteShell] = useState<DocumentNote | null>(null)

  // Text documents keep their Markdown body in a .md file — fetch and render it.
  const { data: textBody } = useQuery({
    queryKey: ['document-text', doc.id],
    queryFn: () => api.documents.getText(doc.id),
    enabled: doc.is_text,
  })
  const bodyHtml = useMemo(
    () => (textBody ? renderMarkdown(textBody.content, doc.citations ?? []) : ''),
    [textBody, doc.citations],
  )

  const typeMap = new Map(types.map(dt => [dt.key, dt.label]))
  const fileUrl = api.documents.fileUrl(doc.id)
  const displayName = plainMentions(doc.title || doc.filename)
  const typeLabel = docTypeLabel(t, doc.doc_type, typeMap.get(doc.doc_type ?? ''))
  const linkedPersons = (doc.persons ?? []).map(lp => persons.find(p => p.id === lp.id)).filter(Boolean) as PersonFull[]
  const linkedPersonIdSet = useMemo(() => new Set((doc.persons ?? []).map(p => p.id)), [doc.persons])

  // Photos attached to a text document's body.
  const imageItems: CarouselItem[] = useMemo(() => (doc.images ?? []).map(img => ({
    key: `img-${img.id}`, url: api.imageViewUrl(img.image_id, 1600), mimeType: 'image/jpeg', caption: img.caption,
  })), [doc.images])

  // A regular document's primary file plus any extra ones from a multi-file
  // upload — every page of a scanned letter, for instance.
  const allFiles: CarouselItem[] = useMemo(() => {
    if (doc.is_text) return []
    const items: CarouselItem[] = [{ key: 'primary', url: fileUrl, mimeType: doc.mime_type, filename: doc.filename }]
    for (const f of doc.files ?? []) {
      items.push({ key: `file-${f.id}`, url: api.documents.extraFileUrl(doc.id, f.id), mimeType: f.mime_type, filename: f.filename })
    }
    return items
  }, [doc, fileUrl])

  function handleBodyClick(e: React.MouseEvent<HTMLDivElement>) {
    const anchor = (e.target as Element).closest('a.note-person-ref')
    if (!anchor) return
    e.preventDefault()
    const match = (anchor as HTMLAnchorElement).getAttribute('href')?.match(/person-ref-(\d+)$/)
    if (match) { onClose(); onNavToPerson(parseInt(match[1])) }
  }

  async function startNewNote() {
    const created = await api.documentNotes.create(doc.id, { content: '' })
    setNewNoteShell(created)
    setCreatingNote(true)
  }

  const docNoteOps = api.documentNotes

  function handleDescriptionSaved(next: { linkedIds: Set<number> }) {
    qc.invalidateQueries({ queryKey: ['docs-all'] })
    // Newly-mentioned persons may not be in doc.persons yet — invalidate the
    // union so a person linked for the first time also sees their list update.
    const ids = new Set([...doc.persons.map(p => p.id), ...next.linkedIds])
    for (const id of ids) qc.invalidateQueries({ queryKey: ['person-docs', id] })
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ width: doc.is_text ? 680 : 520, maxWidth: '92vw', maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-zinc-800 shrink-0">
          <div className="min-w-0 flex-1 pr-3">
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold mb-1">{typeLabel}</p>
            {/* Mentions in the title render as person links, same as in a body —
                `handleBodyClick` on the wrapper already navigates them. */}
            <h2 className="text-sm font-semibold text-zinc-100 leading-snug"
              onClick={handleBodyClick}
              dangerouslySetInnerHTML={{ __html: renderTitleMentions(doc.title || doc.filename) }} />
            {(doc.date || doc.year) && (
              <p className="text-xs text-zinc-500 mt-0.5">{doc.date ? formatPartialDate(doc.date, dateLocale) : doc.year}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* Text-document body */}
          {doc.is_text && (
            <div className="px-5 pt-4">
              {textBody === undefined ? (
                <p className="text-xs text-zinc-600 italic">{t('textDoc.loading')}</p>
              ) : textBody.content.trim() ? (
                <div className="note-content text-sm text-zinc-300 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: bodyHtml }}
                  onClick={handleBodyClick} />
              ) : (
                <p className="text-sm text-zinc-600 italic">{t('textDoc.emptyBody')}</p>
              )}

              {(doc.citations?.length ?? 0) > 0 && (
                <div className="mt-4 border-t border-zinc-800 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-600 mb-1.5">
                    {t('textDoc.references')}
                  </p>
                  {[...doc.citations].sort((a, b) => a.marker - b.marker).map(c => (
                    <div key={c.id} className="flex items-start gap-2 py-0.5">
                      <span className="text-xs text-zinc-600 font-mono shrink-0 w-5 text-right">[{c.marker}]</span>
                      {c.source_document_id != null ? (
                        <button
                          onClick={() => onNavToDocument?.(c.source_document_id!)}
                          className="text-xs text-amber-400 hover:text-amber-200 truncate text-left transition-colors">
                          {c.custom_label ?? c.source_title ?? '—'}
                        </button>
                      ) : (
                        <span className="text-xs text-amber-300/90 truncate">{c.custom_label ?? c.source_title ?? '—'}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {(doc.images?.length ?? 0) > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-600 mb-2">
                    {t('textDoc.photos')} ({doc.images.length})
                  </p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {doc.images.map((img, i) => (
                      <button key={img.image_id} onClick={() => setImageCarouselIndex(i)}
                        className="aspect-square rounded-lg overflow-hidden bg-zinc-800 hover:ring-2 hover:ring-brand-400 transition-all">
                        <img src={api.imageViewUrl(img.image_id, 240)} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Preview — always opens the zoomable carousel; a single image still
              benefits from zoom and the side-by-side description panel. */}
          {isImage(doc.mime_type) && !doc.is_text && (
            <div
              onClick={() => setFileCarouselIndex(0)}
              className="bg-zinc-950 flex items-center justify-center cursor-pointer"
              style={{ maxHeight: 280, minHeight: 120 }}
            >
              <img src={fileUrl} alt={displayName} className="max-w-full max-h-[280px] object-contain" />
            </div>
          )}

          {isPdf(doc.mime_type) && (
            <div className="bg-zinc-950 flex items-center justify-center py-8">
              <div className="flex flex-col items-center gap-3 text-zinc-500">
                <svg className="w-12 h-12 text-red-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <a href={fileUrl} target="_blank" rel="noreferrer"
                  onClick={e => { if (allFiles.length > 1) { e.preventDefault(); setFileCarouselIndex(0) } }}
                  className="text-xs text-brand-400 hover:text-brand-300 underline underline-offset-2 transition-colors">
                  {t('docViewer.openPdf')}
                </a>
              </div>
            </div>
          )}

          {isAudio(doc.mime_type) && (
            <div className="bg-zinc-950 px-5 py-6">
              <audio controls src={fileUrl} className="w-full" />
            </div>
          )}

          {isVideo(doc.mime_type) && (
            <div className="bg-zinc-950 flex items-center justify-center" style={{ maxHeight: 320 }}>
              <video controls src={fileUrl} className="max-w-full max-h-[320px]" />
            </div>
          )}

          {/* Metadata + notes */}
          <div className="px-5 py-4 space-y-5">

            {/* Description */}
            {doc.description && (
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-1">{t('docViewer.description')}</p>
                <div className="note-content text-xs text-zinc-300 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.description, doc.description_citations ?? []) }}
                  onClick={handleBodyClick} />
              </div>
            )}

            {/* Linked persons */}
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-2">
                {t('docViewer.linkedPersons')} {linkedPersons.length > 1 ? `(${linkedPersons.length})` : ''}
              </p>
              {linkedPersons.length > 0 ? (
                <div className="space-y-1.5">
                  {linkedPersons.map(person => {
                    const by = person.birth_date ? person.birth_date.slice(0, 4) : person.birth_year != null ? String(person.birth_year) : null
                    const dy = person.death_date ? person.death_date.slice(0, 4) : person.death_year != null ? String(person.death_year) : null
                    const years = [by, dy].filter(Boolean).join('–')
                    return (
                      <button
                        key={person.id}
                        onClick={() => { onClose(); onNavToPerson(person.id) }}
                        className="w-full flex items-center gap-3 px-3 py-2 bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/60 hover:border-zinc-600 rounded-xl transition-colors text-left group"
                      >
                        <div className="w-9 h-9 rounded-full bg-zinc-700 border border-zinc-600 shrink-0 overflow-hidden flex items-center justify-center">
                          <PersonAvatar person={person} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-zinc-100 truncate">{displayPersonName(person, nameOrder)}</p>
                          {years && <p className="text-xs text-zinc-500 tabular-nums">{years}</p>}
                        </div>
                        <svg className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-zinc-500 italic">{t('docViewer.noPersons')}</p>
              )}
            </div>

            {/* Notes */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">
                  {t('docViewer.notes')} {docNotes.length > 0 ? `(${docNotes.length})` : ''}
                </p>
                <button onClick={startNewNote} className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors">
                  {t('docViewer.addNote')}
                </button>
              </div>

              <div className="space-y-3">
                {docNotes.map(note => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    sources={sources}
                    persons={persons}
                    ops={docNoteOps}
                    onUpdated={() => refetchNotes()}
                    onDeleted={() => refetchNotes()}
                    onNavToPerson={id => { onClose(); onNavToPerson(id) }}
                  />
                ))}

                {creatingNote && newNoteShell && (
                  <NoteEditorComponent
                    note={newNoteShell}
                    sources={sources}
                    persons={persons}
                    ops={docNoteOps}
                    onNavToPerson={id => { onClose(); onNavToPerson(id) }}
                    onSaved={() => { refetchNotes(); setCreatingNote(false); setNewNoteShell(null) }}
                    onDeleted={() => { refetchNotes(); setCreatingNote(false); setNewNoteShell(null) }}
                    onCancel={async () => {
                      await api.documentNotes.delete(newNoteShell.id)
                      setCreatingNote(false)
                      setNewNoteShell(null)
                    }}
                    autoFocusContent
                  />
                )}

                {docNotes.length === 0 && !creatingNote && (
                  <p className="text-xs text-zinc-600 italic">{t('docViewer.noNotes')}</p>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-3 border-t border-zinc-800 flex items-center gap-3">
          {onNavToDocument && (
            <button
              onClick={() => { onClose(); onNavToDocument(doc.id, true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-lg text-xs text-zinc-300 hover:text-white transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2.25 2.25 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2.414a2 2 0 01.586-1.414z" />
              </svg>
              {t('docViewer.edit')}
            </button>
          )}
          <a
            href={api.documents.fileUrl(doc.id, true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-lg text-xs text-zinc-300 hover:text-white transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {t('docViewer.download')}
          </a>
          {/* Redundant for images — clicking the preview above already opens the same carousel. */}
          {!isImage(doc.mime_type) && (isPdf(doc.mime_type) || isAudio(doc.mime_type) || isVideo(doc.mime_type) || allFiles.length > 1) && (
            <a href={fileUrl} target="_blank" rel="noreferrer"
              onClick={e => { if (allFiles.length > 1) { e.preventDefault(); setFileCarouselIndex(0) } }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-lg text-xs text-zinc-300 hover:text-white transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              {t('docViewer.open')}
            </a>
          )}
          <span className="ml-auto text-xs text-zinc-600 truncate">{doc.filename}</span>
        </div>
      </div>

      {imageCarouselIndex !== null && (
        <MediaCarousel items={imageItems} startIndex={imageCarouselIndex} description={doc.description}
          descriptionCitations={doc.description_citations} linkedPersonIds={linkedPersonIdSet}
          docId={doc.id} onNavToPerson={id => { onClose(); onNavToPerson(id) }} onDescriptionSaved={handleDescriptionSaved}
          onClose={() => setImageCarouselIndex(null)} />
      )}
      {fileCarouselIndex !== null && (
        <MediaCarousel items={allFiles} startIndex={fileCarouselIndex} description={doc.description}
          descriptionCitations={doc.description_citations} linkedPersonIds={linkedPersonIdSet}
          docId={doc.id} onNavToPerson={id => { onClose(); onNavToPerson(id) }} onDescriptionSaved={handleDescriptionSaved}
          onClose={() => setFileCarouselIndex(null)} />
      )}
    </div>,
    document.body,
  )
}

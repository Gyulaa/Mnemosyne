import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import type { PersonEvent, PersonFull, EventImage } from '../types'
import { api } from '../api'
import { EventEditor, EventIcon, EVENT_TYPE_OPTIONS, formatEventDate } from './EventTimeline'

// ── EventLightbox ─────────────────────────────────────────────────────────────

function EventLightbox({ images, idx, onChange, onClose }: {
  images: EventImage[]
  idx: number
  onChange: (i: number) => void
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowLeft')  onChange(Math.max(0, idx - 1))
      if (e.key === 'ArrowRight') onChange(Math.min(images.length - 1, idx + 1))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [idx, images.length, onClose, onChange])

  return createPortal(
    <div className="fixed inset-0 z-[300] bg-black/95 flex items-center justify-center" onClick={onClose}>
      {/* Prev */}
      <button
        onClick={e => { e.stopPropagation(); onChange(Math.max(0, idx - 1)) }}
        disabled={idx === 0}
        className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20 flex items-center justify-center text-white text-2xl transition-colors z-10">
        ‹
      </button>
      {/* Next */}
      <button
        onClick={e => { e.stopPropagation(); onChange(Math.min(images.length - 1, idx + 1)) }}
        disabled={idx === images.length - 1}
        className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20 flex items-center justify-center text-white text-2xl transition-colors z-10">
        ›
      </button>
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white text-lg transition-colors z-10">
        ✕
      </button>
      {/* Counter */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 rounded-full px-3 py-1 text-xs text-zinc-400 tabular-nums z-10">
        {idx + 1} / {images.length}
      </div>
      {/* Image */}
      <img
        key={images[idx].image_id}
        src={api.imageViewUrl(images[idx].image_id, 1600)}
        alt=""
        className="max-w-full max-h-full object-contain select-none"
        style={{ maxHeight: '92vh', maxWidth: 'calc(100vw - 120px)' }}
        onClick={e => e.stopPropagation()}
      />
      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 mt-8" style={{ marginTop: 0, top: 'auto', bottom: 56 }}>
          {images.map((ei, i) => (
            <button
              key={ei.id}
              onClick={e => { e.stopPropagation(); onChange(i) }}
              className={`w-10 h-10 rounded-md overflow-hidden border-2 transition-all ${i === idx ? 'border-brand-400' : 'border-transparent opacity-60 hover:opacity-100'}`}>
              <img src={api.imageViewUrl(ei.image_id, 120)} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}

// ── EventDetailPanel ──────────────────────────────────────────────────────────

function EventDetailPanel({ ev, persons, onEdit, onClose }: {
  ev: PersonEvent
  persons: PersonFull[]
  onEdit: () => void
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const [creatingSource, setCreatingSource] = useState(false)
  const [sourceCreated, setSourceCreated] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (lightboxIdx !== null) return  // lightbox handles its own keys
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lightboxIdx, onClose])

  const typeLabel = EVENT_TYPE_OPTIONS.find(o => o.value === ev.event_type)?.label ?? ev.event_type
  const dateStr = formatEventDate(ev.date, ev.year)

  async function handleCreateSource() {
    if (creatingSource || sourceCreated) return
    setCreatingSource(true)
    try {
      await api.sources.create({
        title: ev.title ?? typeLabel,
        source_type: 'event',
        year: ev.year ?? undefined,
        description: [dateStr, ev.place, ev.description].filter(Boolean).join(' · ') || undefined,
        event_id: ev.id,
      })
      qc.invalidateQueries({ queryKey: ['sources'] })
      setSourceCreated(true)
    } finally {
      setCreatingSource(false)
    }
  }

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />

      {/* Side panel */}
      <div className="fixed right-0 top-0 bottom-0 z-50 flex flex-col bg-zinc-900 border-l border-zinc-800 shadow-2xl"
        style={{ width: 480 }}>

        {/* Header */}
        <div className="shrink-0 px-5 py-4 border-b border-zinc-800">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <EventIcon type={ev.event_type} />
                <h2 className="text-base font-semibold text-zinc-100 truncate">
                  {ev.title || typeLabel}
                </h2>
              </div>
              {ev.title && <p className="text-xs text-zinc-500 ml-6">{typeLabel}</p>}
              {(dateStr || ev.place) && (
                <p className="text-sm text-zinc-400 mt-1">
                  {[dateStr, ev.place].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleCreateSource}
                disabled={creatingSource || sourceCreated}
                title="Create a citeable source from this event"
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  sourceCreated
                    ? 'text-green-400 bg-green-900/30 cursor-default'
                    : 'text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50'
                }`}
              >
                {sourceCreated ? '✓ Source created' : creatingSource ? '…' : 'Use as source'}
              </button>
              <button onClick={onEdit}
                className="px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors">
                Edit
              </button>
              <button onClick={onClose}
                className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* Description */}
          {ev.description && (
            <div className="px-5 py-4 border-b border-zinc-800/60">
              <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-line">{ev.description}</p>
            </div>
          )}

          {/* Photo gallery */}
          {ev.images.length > 0 && (
            <div className="px-5 py-4 border-b border-zinc-800/60">
              <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">
                Photos ({ev.images.length})
              </h3>
              <div className={`grid gap-1.5 ${ev.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {ev.images.map((ei, i) => (
                  <button
                    key={ei.id}
                    onClick={() => setLightboxIdx(i)}
                    className="relative overflow-hidden rounded-xl bg-zinc-800 hover:ring-2 hover:ring-brand-400 transition-all group"
                    style={{ aspectRatio: ev.images.length === 1 ? '16/9' : '4/3' }}>
                    <img
                      src={api.imageViewUrl(ei.image_id, 600)}
                      alt=""
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    {/* Zoom hint */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                        </svg>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {ev.images.length === 0 && (
            <div className="px-5 py-6 border-b border-zinc-800/60">
              <p className="text-sm text-zinc-600 italic">No photos attached to this event.</p>
              <button onClick={onEdit}
                className="mt-2 text-xs text-brand-500 hover:text-brand-400 transition-colors">
                + Attach photos
              </button>
            </div>
          )}

          {/* Participants */}
          {ev.persons.length > 0 && (
            <div className="px-5 py-4">
              <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">People</h3>
              <div className="space-y-2.5">
                {ev.persons.map(ep => (
                  <div key={ep.id} className="flex items-center gap-3">
                    {ep.thumbnail_face_id ? (
                      <img src={api.faceThumbnailUrl(ep.thumbnail_face_id, 64)} alt=""
                        className="w-9 h-9 rounded-full object-cover shrink-0 border border-zinc-700" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-zinc-700 flex items-center justify-center text-sm text-zinc-400 font-medium shrink-0">
                        {(ep.person_name ?? '?')[0]}
                      </div>
                    )}
                    <div>
                      <p className="text-sm text-zinc-200">{ep.person_name ?? '(unnamed)'}</p>
                      <p className="text-[10px] text-zinc-600 capitalize">{ep.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Lightbox (z-index above panel) */}
      {lightboxIdx !== null && (
        <EventLightbox
          images={ev.images}
          idx={lightboxIdx}
          onChange={setLightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </>,
    document.body,
  )
}

// ── EventCard ─────────────────────────────────────────────────────────────────

function EventCard({ ev, onClick, onEdit }: {
  ev: PersonEvent
  onClick: () => void
  onEdit: () => void
}) {
  const typeLabel = EVENT_TYPE_OPTIONS.find(o => o.value === ev.event_type)?.label ?? ev.event_type
  const dateStr = formatEventDate(ev.date, ev.year)

  // Build photo strip layout
  const imgs = ev.images.slice(0, 4)
  const extra = ev.images.length - 4

  return (
    <div
      onClick={onClick}
      className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-600 transition-all cursor-pointer group"
    >
      {/* Photo area */}
      {ev.images.length > 0 ? (
        <div className="relative overflow-hidden" style={{ height: ev.images.length === 1 ? 160 : 120 }}>
          {imgs.length === 1 ? (
            <img src={api.imageViewUrl(imgs[0].image_id, 400)} alt=""
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
          ) : (
            <div className={`grid h-full gap-px ${imgs.length === 2 ? 'grid-cols-2' : imgs.length === 3 ? 'grid-cols-3' : 'grid-cols-2 grid-rows-2'}`}>
              {imgs.map((ei, i) => (
                <div key={ei.id} className="relative overflow-hidden bg-zinc-800">
                  <img src={api.imageViewUrl(ei.image_id, 280)} alt=""
                    className="w-full h-full object-cover" />
                  {i === 3 && extra > 0 && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <span className="text-white font-semibold text-sm">+{extra}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="h-16 bg-zinc-800/50 flex items-center justify-center">
          <EventIcon type={ev.event_type} />
        </div>
      )}

      {/* Card body */}
      <div className="px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <EventIcon type={ev.event_type} />
              <p className="text-xs font-semibold text-zinc-100 truncate">
                {ev.title || typeLabel}
              </p>
            </div>
            {ev.title && <p className="text-[10px] text-zinc-500 mt-0.5 ml-5">{typeLabel}</p>}
            {dateStr && <p className="text-[10px] text-zinc-500 mt-0.5 ml-5">{dateStr}</p>}
            {ev.place && <p className="text-[10px] text-zinc-500 truncate mt-0.5 ml-5">{ev.place}</p>}
          </div>
          {/* Edit button — separate from card click */}
          <button
            onClick={e => { e.stopPropagation(); onEdit() }}
            className="shrink-0 p-1 rounded text-zinc-700 hover:text-zinc-200 hover:bg-zinc-700 opacity-0 group-hover:opacity-100 transition-all">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2.25 2.25 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2.414a2 2 0 01.586-1.414z" />
            </svg>
          </button>
        </div>

        {/* Person avatars */}
        {ev.persons.length > 0 && (
          <div className="flex items-center gap-1 mt-2">
            <div className="flex -space-x-1.5">
              {ev.persons.slice(0, 4).map(ep => (
                ep.thumbnail_face_id ? (
                  <img key={ep.id} src={api.faceThumbnailUrl(ep.thumbnail_face_id, 32)} alt=""
                    className="w-5 h-5 rounded-full object-cover border border-zinc-900" />
                ) : (
                  <div key={ep.id} className="w-5 h-5 rounded-full bg-zinc-700 border border-zinc-900 flex items-center justify-center text-[8px] text-zinc-400">
                    {(ep.person_name ?? '?')[0]}
                  </div>
                )
              ))}
            </div>
            <span className="text-[10px] text-zinc-600 ml-1 truncate">
              {ev.persons[0]?.person_name}
              {ev.persons.length > 1 ? ` +${ev.persons.length - 1}` : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── EventsTab ─────────────────────────────────────────────────────────────────

export default function EventsTab({ navTarget, onNavConsumed }: {
  navTarget?: { eventId: number; key: number } | null
  onNavConsumed?: () => void
}) {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'with_photos'>('with_photos')
  const [viewingEvent, setViewingEvent] = useState<PersonEvent | null>(null)
  const [editingEvent, setEditingEvent] = useState<PersonEvent | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [pendingNavEventId, setPendingNavEventId] = useState<number | null>(null)
  const prevNavKey = useRef<number | null>(null)

  const { data: events = [], isLoading, refetch } = useQuery({
    queryKey: ['events', filter],
    queryFn: () => api.events.list(filter === 'with_photos'),
    staleTime: 15_000,
  })

  // Consume external nav target (e.g. from Genealogy page event click)
  useEffect(() => {
    if (!navTarget || navTarget.key === prevNavKey.current) return
    prevNavKey.current = navTarget.key
    setFilter('all')  // ensure the target event is included in the list
    setPendingNavEventId(navTarget.eventId)
    onNavConsumed?.()
  }, [navTarget]) // eslint-disable-line

  useEffect(() => {
    if (pendingNavEventId === null || isLoading || events.length === 0) return
    const ev = events.find(e => e.id === pendingNavEventId)
    if (ev) {
      setViewingEvent(ev)
      closeEditor()
      setPendingNavEventId(null)
    }
  }, [pendingNavEventId, events, isLoading]) // eslint-disable-line

  const { data: persons = [] } = useQuery<PersonFull[]>({
    queryKey: ['persons'],
    queryFn: api.persons.list,
    staleTime: 60_000,
  })

  const showEditor = isCreating || editingEvent !== null
  const editorIsNew = isCreating && editingEvent === null

  function closeEditor() {
    setEditingEvent(null)
    setIsCreating(false)
  }

  function handleSaved(saved: PersonEvent) {
    if (editorIsNew) {
      setIsCreating(false)
      setEditingEvent(saved)  // keep editor open so photos can be attached
    } else {
      setEditingEvent(saved)  // update with fresh data (e.g., added images)
    }
    refetch()
    qc.invalidateQueries({ queryKey: ['images-with-events'] })
  }

  function handleEditorDeleted() {
    closeEditor()
    setViewingEvent(null)
    refetch()
    qc.invalidateQueries({ queryKey: ['images-with-events'] })
  }

  function openEdit(ev: PersonEvent) {
    setViewingEvent(null)
    setIsCreating(false)
    setEditingEvent(ev)
  }

  // ── Full-page editor view ────────────────────────────────────────────────────
  if (showEditor) {
    const editorTitle = editorIsNew
      ? 'New event'
      : (editingEvent?.title ?? (EVENT_TYPE_OPTIONS.find(o => o.value === editingEvent?.event_type)?.label ?? 'Edit event'))

    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6">
          <button
            onClick={closeEditor}
            className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Events
          </button>
          <svg className="w-3.5 h-3.5 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <h1 className="text-sm font-semibold text-zinc-300 truncate">{editorTitle}</h1>
        </div>

        <EventEditor
          event={editingEvent}
          persons={persons}
          onSaved={handleSaved}
          onDeleted={handleEditorDeleted}
          onCancel={closeEditor}
        />
      </div>
    )
  }

  // ── Events grid view ──────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto px-6 py-8">

      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Events</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {isLoading ? '…' : `${events.length} event${events.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-0.5 bg-zinc-800 rounded-lg p-0.5">
            {([
              { value: 'with_photos', label: 'With photos' },
              { value: 'all',         label: 'All' },
            ] as const).map(opt => (
              <button key={opt.value} onClick={() => setFilter(opt.value)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  filter === opt.value ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
          <button onClick={() => { setIsCreating(true); setEditingEvent(null) }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-500 hover:bg-brand-400 text-white text-xs font-medium rounded-lg transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New event
          </button>
        </div>
      </div>

      {/* Loading skeletons */}
      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="h-28 bg-zinc-800 animate-pulse" />
              <div className="px-3 py-2.5 space-y-2">
                <div className="h-3 bg-zinc-800 rounded animate-pulse w-3/4" />
                <div className="h-2.5 bg-zinc-800 rounded animate-pulse w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && events.length === 0 && (
        <div className="text-center py-20">
          <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-zinc-500 text-sm">
            {filter === 'with_photos'
              ? 'No events with photos yet. Create an event and attach photos to it.'
              : 'No events yet. Create your first event.'}
          </p>
          <button onClick={() => setIsCreating(true)}
            className="mt-4 px-4 py-2 bg-brand-500 hover:bg-brand-400 text-white text-sm font-medium rounded-lg transition-colors">
            + New event
          </button>
        </div>
      )}

      {/* Events grid */}
      {!isLoading && events.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {events.map(ev => (
            <EventCard
              key={ev.id}
              ev={ev}
              onClick={() => setViewingEvent(ev)}
              onEdit={() => openEdit(ev)}
            />
          ))}
        </div>
      )}

      {/* Detail panel */}
      {viewingEvent && (
        <EventDetailPanel
          ev={viewingEvent}
          persons={persons}
          onEdit={() => openEdit(viewingEvent)}
          onClose={() => setViewingEvent(null)}
        />
      )}
    </div>
  )
}

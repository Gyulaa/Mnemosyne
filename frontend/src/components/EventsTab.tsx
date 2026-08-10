import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { PersonEvent, PersonFull, EventImage } from '../types'
import { api } from '../api'
import { EventEditor, EventIcon, EVENT_TYPE_OPTIONS, formatEventDate } from './EventTimeline'
import { useT } from '../SettingsContext'
import { ImagePreviewModal } from './ImagePreviewModal'

marked.setOptions({ breaks: true, gfm: true })

function renderMd(text: string): string {
  const html = marked.parse(text) as string
  return DOMPurify.sanitize(html, { ADD_ATTR: ['href', 'class', 'title'] })
}

// ── Toolbar button ─────────────────────────────────────────────────────────────

function TBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" onMouseDown={e => { e.preventDefault(); onClick() }} title={title}
      className="px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 rounded transition-colors font-mono">
      {children}
    </button>
  )
}


// ── EventDetailView ────────────────────────────────────────────────────────────

function EventDetailView({ ev, persons, onBack, onEdit, onEventUpdated, onNavToCluster, onExportStart, onExportEnd }: {
  ev: PersonEvent
  persons: PersonFull[]
  onBack: () => void
  onEdit: () => void
  onEventUpdated: (updated: PersonEvent) => void
  onNavToCluster?: (clusterId: number) => void
  onExportStart?: (cancelFn: () => void) => void
  onExportEnd?: (error?: string) => void
}) {
  const t = useT()
  const qc = useQueryClient()
  const [previewIdx, setPreviewIdx] = useState<number | null>(null)
  const [exportingZip, setExportingZip] = useState(false)

  // Event-specific face crops now arrive on EventPerson.event_face_id, so the
  // per-image person lookups this view used to fire are no longer needed.

  async function handleExportZip() {
    if (exportingZip || ev.images.length === 0) return
    setExportingZip(true)
    const controller = new AbortController()
    onExportStart?.(() => controller.abort())
    try {
      const blob = await api.events.exportImagesZip(ev.id, controller.signal)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const safe = (ev.title ?? 'event').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'event'
      a.href = url
      a.download = `event_${ev.id}_${safe}.zip`
      a.click()
      URL.revokeObjectURL(url)
      onExportEnd?.()
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') onExportEnd?.()
      else onExportEnd?.(String(e))
    } finally {
      setExportingZip(false)
    }
  }
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const [savingDesc, setSavingDesc] = useState(false)
  const [togglingSource, setTogglingSource] = useState(false)
  const descRef = useRef<HTMLTextAreaElement>(null)

  const typeLabel = t(EVENT_TYPE_OPTIONS.find(o => o.value === ev.event_type)?.key ?? ev.event_type)
  const dateStr = formatEventDate(ev.date, ev.year)

  function startEditDesc() {
    setDescDraft(ev.description ?? '')
    setEditingDesc(true)
    requestAnimationFrame(() => descRef.current?.focus())
  }

  function wrapDesc(before: string, after: string) {
    const ta = descRef.current
    if (!ta) return
    const s = ta.selectionStart, e = ta.selectionEnd
    const sel = descDraft.slice(s, e)
    const next = descDraft.slice(0, s) + before + sel + after + descDraft.slice(e)
    setDescDraft(next)
    requestAnimationFrame(() => {
      ta.selectionStart = s + before.length
      ta.selectionEnd = s + before.length + sel.length
      ta.focus()
    })
  }

  function prefixDesc(p: string) {
    const ta = descRef.current
    if (!ta) return
    const s = ta.selectionStart
    const ls = descDraft.lastIndexOf('\n', s - 1) + 1
    const next = descDraft.slice(0, ls) + p + descDraft.slice(ls)
    setDescDraft(next)
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = s + p.length
      ta.focus()
    })
  }

  async function saveDesc() {
    setSavingDesc(true)
    try {
      const updated = await api.events.update(ev.id, { description: descDraft.trim() || undefined })
      onEventUpdated(updated)
      setEditingDesc(false)
    } finally {
      setSavingDesc(false)
    }
  }

  async function handleToggleSource() {
    if (togglingSource) return
    setTogglingSource(true)
    try {
      if (ev.source_id) {
        await api.sources.delete(ev.source_id)
        onEventUpdated({ ...ev, source_id: null })
      } else {
        const source = await api.events.promoteToSource(ev.id, ev.title ?? typeLabel, 'event')
        onEventUpdated({ ...ev, source_id: source.id })
      }
      qc.invalidateQueries({ queryKey: ['sources'] })
    } finally {
      setTogglingSource(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t('events.heading')}
        </button>
        <svg className="w-3.5 h-3.5 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-sm font-semibold text-zinc-300 truncate">{ev.title || typeLabel}</span>
      </div>

      {/* Header card */}
      <div className="rounded-2xl overflow-hidden mb-6" style={{ background: '#111117', border: '1px solid rgba(255,255,255,0.07)' }}>
        {/* Cover photo strip */}
        {ev.images.length > 0 && (
          <div
            className={`grid gap-px ${
              ev.images.length === 1 ? 'grid-cols-1'
              : ev.images.length === 2 ? 'grid-cols-2'
              : ev.images.length === 3 ? 'grid-cols-3'
              : 'grid-cols-4'
            }`}
            style={{ height: ev.images.length === 1 ? 260 : 180 }}
          >
            {ev.images.slice(0, 4).map((ei, i) => (
              <button
                key={ei.id}
                onClick={() => setPreviewIdx(i)}
                className="relative overflow-hidden bg-zinc-800 hover:opacity-90 transition-opacity group"
              >
                <img src={api.imageViewUrl(ei.image_id, 600)} alt="" className="w-full h-full object-cover" />
                {i === 3 && ev.images.length > 4 && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <span className="text-white font-semibold text-lg">+{ev.images.length - 4}</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                  <div className="opacity-0 group-hover:opacity-100 w-9 h-9 rounded-full bg-black/40 flex items-center justify-center transition-opacity">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Title + actions */}
        <div className="px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <EventIcon type={ev.event_type} />
                <h1 className="text-xl font-bold text-zinc-100">{ev.title || typeLabel}</h1>
              </div>
              {ev.title && <p className="text-sm text-zinc-500 ml-7">{typeLabel}</p>}
              {(dateStr || ev.place) && (
                <p className="text-base text-zinc-400 mt-1 ml-7">
                  {[dateStr, ev.place].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleToggleSource}
                disabled={togglingSource}
                title={ev.source_id ? t('events.sourceOnTip') : t('events.sourceOffTip')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${
                  ev.source_id
                    ? 'text-green-400 bg-green-900/30 hover:bg-green-900/50'
                    : 'text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700'
                }`}
              >
                {ev.source_id && (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {togglingSource ? '…' : ev.source_id ? t('events.usedAsSource') : t('events.useAsSource')}
              </button>
              <button
                onClick={async () => {
                  await api.events.togglePrivacy(ev.id, !ev.is_private)
                  onEventUpdated({ ...ev, is_private: !ev.is_private })
                }}
                title={ev.is_private ? t('events.privacyOn') : t('events.privacyOff')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${ev.is_private ? 'text-amber-300 bg-amber-900/40 hover:bg-amber-900/60' : 'text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700'}`}
              >
                {ev.is_private ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="11" width="18" height="11" rx="2" /><path strokeLinecap="round" d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="11" width="18" height="11" rx="2" /><path strokeLinecap="round" d="M7 11V7a5 5 0 019.9-1" />
                  </svg>
                )}
                {ev.is_private ? t('events.private') : t('events.makePrivate')}
              </button>
              <button
                onClick={onEdit}
                className="px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
              >
                {t('events.editEvent')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Body — two column */}
      <div className="grid grid-cols-3 gap-6">

        {/* Left — description + full photo grid */}
        <div className="col-span-2 space-y-6">

          {/* Description */}
          <div className="rounded-xl overflow-hidden" style={{ background: '#13121a', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{t('events.description')}</h2>
              {!editingDesc && (
                <button
                  onClick={startEditDesc}
                  className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors"
                >
                  {ev.description ? t('events.edit') : t('events.addDesc')}
                </button>
              )}
            </div>

            {editingDesc ? (
              <div>
                {/* Markdown toolbar */}
                <div className="flex items-center gap-0.5 px-3 py-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
                  <TBtn onClick={() => wrapDesc('**', '**')} title="Bold"><strong>B</strong></TBtn>
                  <TBtn onClick={() => wrapDesc('*', '*')} title="Italic"><em>I</em></TBtn>
                  <TBtn onClick={() => wrapDesc('~~', '~~')} title="Strikethrough"><span className="line-through">S</span></TBtn>
                  <span className="w-px h-4 bg-zinc-700 mx-1" />
                  <TBtn onClick={() => prefixDesc('## ')} title="Heading">H</TBtn>
                  <TBtn onClick={() => prefixDesc('- ')} title="Bullet list">• —</TBtn>
                  <TBtn onClick={() => prefixDesc('> ')} title="Blockquote">"</TBtn>
                </div>
                <textarea
                  ref={descRef}
                  value={descDraft}
                  onChange={e => setDescDraft(e.target.value)}
                  placeholder={t('events.mdPlaceholder')}
                  rows={6}
                  className="w-full bg-transparent px-5 py-3 text-sm text-zinc-200 placeholder-zinc-600 outline-none resize-y leading-relaxed font-mono"
                />
                <div className="flex items-center gap-2 px-5 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <button
                    onClick={saveDesc}
                    disabled={savingDesc}
                    className="px-3 py-1 text-xs font-medium bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-white rounded-lg transition-colors"
                  >
                    {savingDesc ? t('events.saving') : t('events.save')}
                  </button>
                  <button
                    onClick={() => setEditingDesc(false)}
                    className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    {t('events.cancel')}
                  </button>
                </div>
              </div>
            ) : ev.description ? (
              <div
                className="note-content px-5 py-4 text-sm text-zinc-300 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: renderMd(ev.description) }}
              />
            ) : (
              <div className="px-5 py-6">
                <p className="text-sm text-zinc-600 italic">{t('events.noDescription')}</p>
              </div>
            )}
          </div>

          {/* Full photo grid */}
          {ev.images.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ background: '#13121a', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
                  {t('events.photos', { n: ev.images.length })}
                </h2>
                <button
                  onClick={handleExportZip}
                  disabled={exportingZip}
                  title={t('events.exportZipTitle')}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-100 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  {exportingZip ? (
                    <>
                      <div className="w-3 h-3 border border-zinc-500 border-t-brand-400 rounded-full animate-spin" />
                      {t('events.exportZipBusy')}
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      {t('events.exportZipLabel')}
                    </>
                  )}
                </button>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-3 gap-2">
                  {ev.images.map((ei, i) => (
                    <button
                      key={ei.id}
                      onClick={() => setPreviewIdx(i)}
                      className="relative overflow-hidden rounded-lg bg-zinc-800 hover:ring-2 hover:ring-brand-400 transition-all group"
                      style={{ aspectRatio: '4/3' }}
                    >
                      <img
                        src={api.imageViewUrl(ei.image_id, 400)}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right — people + no-photo note */}
        <div className="space-y-4">
          {ev.persons.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ background: '#13121a', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{t('events.people')}</h2>
              </div>
              <div className="p-4 space-y-3">
                {ev.persons.map(ep => {
                  const eventFaceId = ep.event_face_id ?? ep.thumbnail_face_id
                  return (
                  <div key={ep.id} className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      {eventFaceId ? (
                        <img src={api.faceThumbnailUrl(eventFaceId, 64)} alt=""
                          className={`w-10 h-10 rounded-full object-cover border ${ep.featured ? 'border-amber-500/70' : 'border-zinc-700'}`} />
                      ) : (
                        <div className={`w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center text-sm text-zinc-400 font-medium border ${ep.featured ? 'border-amber-500/70' : 'border-transparent'}`}>
                          {(ep.person_name ?? '?')[0]}
                        </div>
                      )}
                      {ep.featured && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-zinc-900 flex items-center justify-center">
                          <span className="text-xs text-amber-400">★</span>
                        </span>
                      )}
                    </div>
                    <div>
                      <p className={`text-sm ${ep.featured ? 'text-amber-100' : 'text-zinc-200'}`}>
                        {ep.featured && <span className="mr-1 text-amber-400 text-xs">★</span>}
                        {ep.person_name ?? t('images.unnamed')}
                      </p>
                      <p className="text-xs text-zinc-600">
                        {ep.role === 'primary' ? t('events.rolePrimary') : t('events.roleParticipant')}
                      </p>
                    </div>
                  </div>
                )})}
              </div>
            </div>
          )}

          {ev.images.length === 0 && (
            <div className="rounded-xl p-4 text-center" style={{ background: '#13121a', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-sm text-zinc-600 italic">{t('events.noPhotos')}</p>
              <button onClick={onEdit}
                className="mt-2 text-xs text-brand-500 hover:text-brand-400 transition-colors">
                {t('events.attachPhotos')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Image preview modal */}
      {previewIdx !== null && (
        <ImagePreviewModal
          imageIds={ev.images.map(i => i.image_id)}
          startIdx={previewIdx}
          onClose={() => setPreviewIdx(null)}
          onNavToCluster={onNavToCluster}
        />
      )}
    </div>
  )
}

// ── EventCard ─────────────────────────────────────────────────────────────────

function EventCard({ ev, onClick, onEdit, onTogglePrivacy }: {
  ev: PersonEvent
  onClick: () => void
  onEdit: () => void
  onTogglePrivacy: (evId: number, isPrivate: boolean) => void
}) {
  const t = useT()
  const typeLabel = t(EVENT_TYPE_OPTIONS.find(o => o.value === ev.event_type)?.key ?? ev.event_type)
  const dateStr = formatEventDate(ev.date, ev.year)

  const imgs = ev.images.slice(0, 4)
  const extra = ev.images.length - 4

  return (
    <div
      onClick={onClick}
      className="rounded-xl overflow-hidden transition-all cursor-pointer group"
      style={{ background: '#111117', border: '1px solid rgba(255,255,255,0.07)' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.14)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)' }}
    >
      {ev.images.length > 0 ? (
        <div className="relative overflow-hidden" style={{ height: ev.images.length === 1 ? 160 : 120 }}>
          {imgs.length === 1 ? (
            <img src={api.imageViewUrl(imgs[0].image_id, 400)} alt=""
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
          ) : (
            <div className={`grid h-full gap-px ${imgs.length === 2 ? 'grid-cols-2' : imgs.length === 3 ? 'grid-cols-3' : 'grid-cols-2 grid-rows-2'}`}>
              {imgs.map((ei, i) => (
                <div key={ei.id} className="relative overflow-hidden bg-zinc-800">
                  <img src={api.imageViewUrl(ei.image_id, 280)} alt="" className="w-full h-full object-cover" />
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

      <div className="px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <EventIcon type={ev.event_type} />
              <p className="text-xs font-semibold text-zinc-100 truncate">{ev.title || typeLabel}</p>
            </div>
            {ev.title && <p className="text-xs text-zinc-500 mt-0.5 ml-5">{typeLabel}</p>}
            {dateStr && <p className="text-xs text-zinc-500 mt-0.5 ml-5">{dateStr}</p>}
            {ev.place && <p className="text-xs text-zinc-500 truncate mt-0.5 ml-5">{ev.place}</p>}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={e => { e.stopPropagation(); onTogglePrivacy(ev.id, !ev.is_private) }}
              title={ev.is_private ? t('events.privacyOn') : t('events.privacyOff')}
              className={`p-1 rounded transition-all ${ev.is_private ? 'text-amber-400 hover:bg-zinc-700' : 'text-zinc-700 hover:text-zinc-300 hover:bg-zinc-700 opacity-0 group-hover:opacity-100'}`}
            >
              {ev.is_private ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path strokeLinecap="round" d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path strokeLinecap="round" d="M7 11V7a5 5 0 019.9-1" />
                </svg>
              )}
            </button>
            <button
              onClick={e => { e.stopPropagation(); onEdit() }}
              className="shrink-0 p-1 rounded text-zinc-700 hover:text-zinc-200 hover:bg-zinc-700 opacity-0 group-hover:opacity-100 transition-all">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2.25 2.25 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2.414a2 2 0 01.586-1.414z" />
              </svg>
            </button>
          </div>
        </div>

        {ev.persons.length > 0 && (
          <div className="flex items-center gap-1 mt-2">
            <div className="flex -space-x-1.5">
              {ev.persons.slice(0, 4).map(ep => (
                (ep.event_face_id ?? ep.thumbnail_face_id) ? (
                  <img key={ep.id} src={api.faceThumbnailUrl((ep.event_face_id ?? ep.thumbnail_face_id)!, 32)} alt=""
                    className={`w-5 h-5 rounded-full object-cover border ${ep.featured ? 'border-amber-500/80' : 'border-zinc-900'}`} />
                ) : (
                  <div key={ep.id} className={`w-5 h-5 rounded-full bg-zinc-700 border flex items-center justify-center text-[8px] text-zinc-400 ${ep.featured ? 'border-amber-500/80' : 'border-zinc-900'}`}>
                    {(ep.person_name ?? '?')[0]}
                  </div>
                )
              ))}
            </div>
            <span className="text-xs text-zinc-600 ml-1 truncate">
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

export default function EventsTab({ navTarget, onNavConsumed, onNavToCluster, onExportStart, onExportEnd }: {
  navTarget?: { eventId: number; key: number } | null
  onNavConsumed?: () => void
  onNavToCluster?: (clusterId: number) => void
  onExportStart?: (cancelFn: () => void) => void
  onExportEnd?: (error?: string) => void
}) {
  const t = useT()
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

  useEffect(() => {
    if (!navTarget || navTarget.key === prevNavKey.current) return
    prevNavKey.current = navTarget.key
    setFilter('all')
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
    // If we navigated to editor from a detail view, restore it with latest saved data
    if (!isCreating && viewingEvent !== null && editingEvent !== null) {
      setViewingEvent(editingEvent)
    }
    setEditingEvent(null)
    setIsCreating(false)
  }

  function handleSaved(saved: PersonEvent) {
    if (editorIsNew) {
      setIsCreating(false)
      setEditingEvent(saved)
    } else {
      setEditingEvent(saved)
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
    // Don't clear viewingEvent — closeEditor will restore it on back
    setIsCreating(false)
    setEditingEvent(ev)
  }

  // ── Mode A: full-page editor ─────────────────────────────────────────────────
  if (showEditor) {
    const editorTitle = editorIsNew
      ? t('events.newEvent')
      : (editingEvent?.title ?? (t(EVENT_TYPE_OPTIONS.find(o => o.value === editingEvent?.event_type)?.key ?? '') || t('events.editEvent')))

    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="flex items-center gap-2 mb-6">
          <button
            onClick={closeEditor}
            className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            {viewingEvent !== null && !isCreating ? (editingEvent?.title || t(EVENT_TYPE_OPTIONS.find(o => o.value === editingEvent?.event_type)?.key ?? '') || t('events.noTitle')) : t('events.heading')}
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

  // ── Mode B: full-page event detail ───────────────────────────────────────────
  if (viewingEvent) {
    return (
      <EventDetailView
        ev={viewingEvent}
        persons={persons}
        onBack={() => setViewingEvent(null)}
        onEdit={() => openEdit(viewingEvent)}
        onEventUpdated={updated => setViewingEvent(updated)}
        onNavToCluster={onNavToCluster}
        onExportStart={onExportStart}
        onExportEnd={onExportEnd}
      />
    )
  }

  // ── Mode C: events grid ──────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto px-6 py-8">

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">{t('events.heading')}</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {isLoading ? '…' : events.length !== 1 ? t('events.countPlural', { n: events.length }) : t('events.countSingular', { n: events.length })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-0.5 rounded-lg p-0.5" style={{ background: 'rgba(255,255,255,0.05)' }}>
            {([
              { value: 'with_photos' as const, label: t('events.filterWithPhotos') },
              { value: 'all' as const,         label: t('events.filterAll') },
            ]).map(opt => (
              <button key={opt.value} onClick={() => setFilter(opt.value)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  filter === opt.value ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                }`}
                style={filter === opt.value ? { background: 'rgba(255,255,255,0.09)' } : undefined}>
                {opt.label}
              </button>
            ))}
          </div>
          <button onClick={() => { setIsCreating(true); setEditingEvent(null) }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-500 hover:bg-brand-400 text-white text-xs font-medium rounded-lg transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {t('events.newEvent')}
          </button>
        </div>
      </div>

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

      {!isLoading && events.length === 0 && (
        <div className="text-center py-20">
          <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-zinc-500 text-sm">
            {filter === 'with_photos'
              ? t('events.noEventsPhotos')
              : t('events.noEvents')}
          </p>
          <button onClick={() => setIsCreating(true)}
            className="mt-4 px-4 py-2 bg-brand-500 hover:bg-brand-400 text-white text-sm font-medium rounded-lg transition-colors">
            {t('events.newEvent')}
          </button>
        </div>
      )}

      {!isLoading && events.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {events.map(ev => (
            <EventCard
              key={ev.id}
              ev={ev}
              onClick={() => setViewingEvent(ev)}
              onEdit={() => openEdit(ev)}
              onTogglePrivacy={async (evId, isPrivate) => {
                await api.events.togglePrivacy(evId, isPrivate)
                refetch()
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

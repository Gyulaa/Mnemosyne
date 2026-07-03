import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import type { PersonFull, Relation, PersonEvent, ImageItem, ImagePerson } from '../types'
import { api } from '../api'

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTHS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export const EVENT_TYPE_OPTIONS = [
  { value: 'custom',      label: 'General / Custom' },
  { value: 'military',    label: 'Military service' },
  { value: 'education',   label: 'Education' },
  { value: 'emigration',  label: 'Emigration' },
  { value: 'immigration', label: 'Immigration' },
  { value: 'occupation',  label: 'Occupation change' },
  { value: 'award',       label: 'Award / Honor' },
  { value: 'religious',   label: 'Religious event' },
  { value: 'travel',      label: 'Notable journey' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatEventDate(date: string | null | undefined, fallbackYear?: number | null): string | null {
  if (date) {
    const parts = date.split('-')
    if (parts.length === 3) return `${parseInt(parts[2])} ${MONTHS_SHORT[parseInt(parts[1]) - 1]} ${parts[0]}`
    if (parts.length === 2) return `${MONTHS_SHORT[parseInt(parts[1]) - 1]} ${parts[0]}`
    return parts[0]
  }
  return fallbackYear != null ? String(fallbackYear) : null
}

function getYear(date: string | null | undefined, fallbackYear?: number | null): number | null {
  if (date) { try { return parseInt(date.split('-')[0]) } catch { return null } }
  return fallbackYear ?? null
}

// ── DatePartPicker ─────────────────────────────────────────────────────────────

function DatePartPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parts = value ? value.split('-') : []
  const yr = parts[0] ?? '', mo = parts[1] ?? '', dy = parts[2] ?? ''

  function update(y: string, m: string, d: string) {
    if (!y) { onChange(''); return }
    let r = y
    if (m) { r += '-' + m; if (d) r += '-' + d }
    onChange(r)
  }
  const maxDays = yr && mo ? new Date(parseInt(yr), parseInt(mo), 0).getDate() : 31

  return (
    <div className="flex gap-1 items-center flex-wrap">
      <input type="number" value={yr} onChange={e => update(e.target.value, mo, dy)}
        placeholder="Year" min={1000} max={2100}
        className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400 [appearance:textfield]" />
      {yr && (
        <select value={mo} onChange={e => update(yr, e.target.value, e.target.value ? dy : '')}
          className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 outline-none focus:border-brand-400">
          <option value="">— month —</option>
          {MONTHS_EN.map((m, i) => <option key={i} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
        </select>
      )}
      {yr && mo && (
        <select value={dy} onChange={e => update(yr, mo, e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 outline-none focus:border-brand-400">
          <option value="">— day —</option>
          {Array.from({ length: maxDays }, (_, i) => i + 1).map(d => (
            <option key={d} value={String(d).padStart(2, '0')}>{d}.</option>
          ))}
        </select>
      )}
    </div>
  )
}

// ── EventIcon ─────────────────────────────────────────────────────────────────

export function EventIcon({ type, auto }: { type: string; auto?: boolean }) {
  const cls = `w-3.5 h-3.5 shrink-0 ${auto ? 'text-zinc-500' : 'text-brand-400'}`
  if (type === 'birth')      return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1M4.22 4.22l.707.707M18.36 18.36l.707.707M1 12h1M21 12h1M4.22 19.78l.707-.707M18.36 5.64l.707-.707M12 7a5 5 0 100 10A5 5 0 0012 7z" /></svg>
  if (type === 'death')      return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
  if (type === 'christening') return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" /></svg>
  if (type === 'burial')      return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
  if (type === 'marriage')    return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
  if (type === 'divorce')     return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
  if (type === 'military')    return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>
  if (type === 'education')   return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0112 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" /></svg>
  if (type === 'emigration' || type === 'immigration' || type === 'travel')
    return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
  return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="4" /><path strokeLinecap="round" d="M12 2v2M12 20v2M2 12h2M20 12h2" /></svg>
}

// ── ImagePickerModal ──────────────────────────────────────────────────────────

function ImagePickerModal({ personId, persons, alreadyAttachedIds = new Set(), onSelect, onClose }: {
  personId?: number
  persons: PersonFull[]
  alreadyAttachedIds?: Set<number>
  onSelect: (imageId: number, extraPersonIds: number[]) => void
  onClose: () => void
}) {
  const [step, setStep] = useState<'pick' | 'confirm'>('pick')
  const [pickedImageId, setPickedImageId] = useState<number | null>(null)
  const [otherPersons, setOtherPersons] = useState<ImagePerson[]>([])
  const [includedPersonIds, setIncludedPersonIds] = useState<Set<number>>(new Set())
  const [loadingPersons, setLoadingPersons] = useState(false)
  const [sort, setSort] = useState<'exif_date_desc' | 'exif_date_asc' | 'id_desc' | 'filename_asc'>('exif_date_desc')

  const { data: imagesPage } = useQuery({
    queryKey: ['person-images', personId ?? 'all', sort],
    queryFn: () => personId
      ? api.images.list(1, 120, 'all', '', sort, [personId])
      : api.images.list(1, 120, 'done', '', sort),
    staleTime: 60_000,
  })
  const images = imagesPage?.items ?? []
  const alreadyCount = images.filter(img => alreadyAttachedIds.has(img.id)).length

  async function handlePickImage(img: ImageItem) {
    if (alreadyAttachedIds.has(img.id)) return
    setPickedImageId(img.id)
    setLoadingPersons(true)
    try {
      const imgPersons = await api.images.persons(img.id)
      const others = personId ? imgPersons.filter(p => p.person_id !== personId) : imgPersons
      setOtherPersons(others)
      if (others.length > 0) {
        setIncludedPersonIds(new Set(others.map(p => p.person_id)))
        setStep('confirm')
      } else {
        onSelect(img.id, [])
      }
    } finally {
      setLoadingPersons(false)
    }
  }

  function togglePerson(pid: number) {
    setIncludedPersonIds(prev => {
      const next = new Set(prev)
      next.has(pid) ? next.delete(pid) : next.add(pid)
      return next
    })
  }

  const byId = new Map(persons.map(p => [p.id, p]))

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ width: 480, maxHeight: '80vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <div>
            <p className="text-sm font-semibold text-zinc-100">
              {step === 'pick' ? 'Select a photo' : 'Who else was there?'}
            </p>
            {step === 'pick' && alreadyCount > 0 && (
              <p className="text-[10px] text-zinc-500 mt-0.5">
                {alreadyCount} photo{alreadyCount !== 1 ? 's' : ''} already added to this event
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === 'pick' && (
              <select
                value={sort}
                onChange={e => setSort(e.target.value as typeof sort)}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-400 outline-none focus:border-brand-400 cursor-pointer"
              >
                <option value="exif_date_desc">Newest first</option>
                <option value="exif_date_asc">Oldest first</option>
                <option value="id_desc">Recently added</option>
                <option value="filename_asc">By name</option>
              </select>
            )}
            <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {step === 'pick' ? (
            images.length === 0 ? (
              <p className="text-sm text-zinc-500 italic text-center py-6">No photos available</p>
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {images.map(img => {
                  const attached = alreadyAttachedIds.has(img.id)
                  return (
                    <div key={img.id} className="relative aspect-square">
                      <button
                        onClick={() => handlePickImage(img)}
                        disabled={loadingPersons || attached}
                        title={attached ? 'Already added to this event' : undefined}
                        className={`w-full h-full rounded-lg overflow-hidden bg-zinc-800 transition-all
                          ${attached
                            ? 'ring-2 ring-brand-500 cursor-default'
                            : 'hover:ring-2 hover:ring-brand-400 cursor-pointer disabled:opacity-50'
                          }`}>
                        <img src={api.imageViewUrl(img.id, 240)} alt=""
                          className={`w-full h-full object-cover ${attached ? 'brightness-50' : ''}`} />
                      </button>
                      {attached && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center shadow-lg">
                            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-zinc-400">
                This photo also features these people. Add them to the event as participants?
              </p>
              <div className="space-y-1.5">
                {otherPersons.map(ip => {
                  const p = byId.get(ip.person_id)
                  const included = includedPersonIds.has(ip.person_id)
                  return (
                    <label key={ip.person_id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-800 cursor-pointer">
                      <input type="checkbox" checked={included} onChange={() => togglePerson(ip.person_id)}
                        className="w-4 h-4 accent-brand-500 shrink-0" />
                      <img src={api.faceThumbnailUrl(ip.face_id, 48)} alt=""
                        className="w-7 h-7 rounded-full object-cover shrink-0" />
                      <span className="text-sm text-zinc-200">{p?.name ?? ip.person_name ?? '(unnamed)'}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {step === 'confirm' && (
          <div className="shrink-0 flex gap-2 px-4 py-3 border-t border-zinc-800">
            <button onClick={() => setStep('pick')} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 rounded-lg transition-colors">Back</button>
            <button onClick={() => pickedImageId && onSelect(pickedImageId, [...includedPersonIds])}
              className="flex-1 px-3 py-1.5 text-xs font-medium bg-brand-500 hover:bg-brand-400 text-white rounded-lg transition-colors">
              Add photo
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ── EventEditor ───────────────────────────────────────────────────────────────

export interface EventEditorProps {
  event: PersonEvent | null        // null = creating new
  prefill?: { event_type?: string; date?: string; place?: string }
  personId?: number                // optional; used for image picker scope
  persons?: PersonFull[]
  onSaved: (ev: PersonEvent) => void
  onDeleted?: () => void
  onCancel: () => void
}

export function EventEditor({ event, prefill, personId, persons = [], onSaved, onDeleted, onCancel }: EventEditorProps) {
  const qc = useQueryClient()
  const [type, setType] = useState(event?.event_type ?? prefill?.event_type ?? 'custom')
  const [title, setTitle] = useState(event?.title ?? '')
  const [date, setDate] = useState(event?.date ?? prefill?.date ?? '')
  const [place, setPlace] = useState(event?.place ?? prefill?.place ?? '')
  const [description, setDescription] = useState(event?.description ?? '')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showImagePicker, setShowImagePicker] = useState(false)
  const [showPersonSearch, setShowPersonSearch] = useState(false)
  const [personSearchQ, setPersonSearchQ] = useState('')
  // Local copy of event to reflect image/person updates immediately
  const [localEvent, setLocalEvent] = useState<PersonEvent | null>(event)

  async function save() {
    setSaving(true)
    try {
      let saved: PersonEvent
      if (localEvent) {
        saved = await api.events.update(localEvent.id, {
          event_type: type,
          title: title.trim() || null,
          date: date || null,
          place: place.trim() || null,
          description: description.trim() || null,
        })
      } else {
        saved = await api.events.create({
          event_type: type,
          title: title.trim() || undefined,
          date: date || undefined,
          place: place.trim() || undefined,
          description: description.trim() || undefined,
          person_id: personId,
        })
        setLocalEvent(saved)
      }
      if (personId) qc.invalidateQueries({ queryKey: ['person-events', personId] })
      qc.invalidateQueries({ queryKey: ['events'] })
      onSaved(saved)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!localEvent) return
    await api.events.delete(localEvent.id)
    if (personId) qc.invalidateQueries({ queryKey: ['person-events', personId] })
    qc.invalidateQueries({ queryKey: ['events'] })
    onDeleted?.()
  }

  async function handleAddImage(imageId: number, extraPersonIds: number[]) {
    if (!localEvent) return
    let updated = await api.events.addImage(localEvent.id, imageId) as PersonEvent
    for (const pid of extraPersonIds) {
      try { updated = await api.events.addPerson(localEvent.id, pid, 'participant') as PersonEvent } catch { /* ignore duplicate */ }
    }
    setLocalEvent(updated)
    if (personId) qc.invalidateQueries({ queryKey: ['person-events', personId] })
    qc.invalidateQueries({ queryKey: ['events'] })
    qc.invalidateQueries({ queryKey: ['images-with-events'] })
    setShowImagePicker(false)
  }

  async function handleRemoveImage(eventImageId: number) {
    if (!localEvent) return
    await api.events.removeImage(eventImageId)
    const updated = await api.events.listForPerson(localEvent.id).catch(() => null)
    // Refresh localEvent from server
    const fresh = (await api.events.list()).find(e => e.id === localEvent.id)
    if (fresh) setLocalEvent(fresh)
    if (personId) qc.invalidateQueries({ queryKey: ['person-events', personId] })
    qc.invalidateQueries({ queryKey: ['events'] })
    qc.invalidateQueries({ queryKey: ['images-with-events'] })
  }

  async function handleRemovePerson(eventPersonId: number) {
    if (!localEvent) return
    await api.events.removePerson(eventPersonId)
    const fresh = (await api.events.list()).find(e => e.id === localEvent.id)
    if (fresh) setLocalEvent(fresh)
    if (personId) qc.invalidateQueries({ queryKey: ['person-events', personId] })
    qc.invalidateQueries({ queryKey: ['events'] })
  }

  const isExisting = !!localEvent
  const participants = localEvent?.persons.filter(ep => ep.role === 'participant') ?? []

  const alreadyInEventIds = useMemo(() => new Set([
    ...(localEvent?.persons.map(ep => ep.person_id) ?? []),
    ...(personId != null ? [personId] : []),
  ]), [localEvent, personId])

  const filteredPersonSearchResults = useMemo(() => {
    const q = personSearchQ.toLowerCase().trim()
    return persons
      .filter(p => !alreadyInEventIds.has(p.id) && (q ? (p.name ?? '').toLowerCase().includes(q) : true))
      .slice(0, 8)
  }, [personSearchQ, persons, alreadyInEventIds])

  async function handleAddPerson(pid: number) {
    if (!localEvent) return
    try {
      const updated = await api.events.addPerson(localEvent.id, pid, 'participant') as PersonEvent
      setLocalEvent(updated)
      setPersonSearchQ('')
      setShowPersonSearch(false)
      if (personId) qc.invalidateQueries({ queryKey: ['person-events', personId] })
      qc.invalidateQueries({ queryKey: ['events'] })
    } catch { /* ignore duplicate */ }
  }

  return (
    <div className="bg-zinc-800/40 border border-zinc-700/60 rounded-xl p-3 space-y-2.5">
      {/* Type */}
      <select value={type} onChange={e => setType(e.target.value)}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-brand-400">
        {EVENT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      {/* Title */}
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (optional)"
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400" />

      {/* Date + Place */}
      <div className="space-y-1.5">
        <DatePartPicker value={date} onChange={setDate} />
        <input value={place} onChange={e => setPlace(e.target.value)} placeholder="Place (optional)"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400" />
      </div>

      {/* Description */}
      <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" rows={2}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400 resize-none" />

      {/* Photos section — always visible when editing existing, shown as hint when new */}
      {isExisting ? (
        <div>
          <p className="text-[10px] text-zinc-500 mb-1.5">Photos</p>
          <div className="flex flex-wrap gap-1.5 items-center">
            {(localEvent?.images ?? []).map(ei => (
              <div key={ei.id} className="relative group/img w-12 h-12">
                <img src={api.imageViewUrl(ei.image_id, 120)} alt=""
                  className="w-12 h-12 rounded-lg object-cover" />
                <button onClick={() => handleRemoveImage(ei.id)}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-600 text-white text-[10px] flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity">✕</button>
              </div>
            ))}
            <button onClick={() => setShowImagePicker(true)}
              className="w-12 h-12 rounded-lg border-2 border-dashed border-zinc-700 hover:border-brand-400 flex items-center justify-center text-zinc-600 hover:text-brand-400 transition-colors text-xl">
              +
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-zinc-600 italic">Save the event first to attach photos.</p>
      )}

      {/* Participants + add participant (only for existing events) */}
      {isExisting && (
        <div>
          {participants.length > 0 && (
            <>
              <p className="text-[10px] text-zinc-500 mb-1">Also present</p>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {participants.map(ep => (
                  <div key={ep.id} className="flex items-center gap-1 bg-zinc-800 rounded-full pl-1 pr-2 py-0.5">
                    {ep.thumbnail_face_id ? (
                      <img src={api.faceThumbnailUrl(ep.thumbnail_face_id, 32)} alt="" className="w-4 h-4 rounded-full object-cover" />
                    ) : <div className="w-4 h-4 rounded-full bg-zinc-700" />}
                    <span className="text-[10px] text-zinc-300">{ep.person_name ?? '(unnamed)'}</span>
                    <button onClick={() => handleRemovePerson(ep.id)} className="text-zinc-600 hover:text-red-400 transition-colors text-[10px] ml-0.5">✕</button>
                  </div>
                ))}
              </div>
            </>
          )}
          {showPersonSearch ? (
            <div className="relative">
              <input
                autoFocus
                value={personSearchQ}
                onChange={e => setPersonSearchQ(e.target.value)}
                placeholder="Search person…"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400"
              />
              {filteredPersonSearchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-zinc-800 border border-zinc-700 rounded-xl shadow-xl z-20 overflow-hidden">
                  {filteredPersonSearchResults.map(p => (
                    <button key={p.id} onClick={() => handleAddPerson(p.id)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-700 text-left transition-colors">
                      {p.thumbnail_face_id
                        ? <img src={api.faceThumbnailUrl(p.thumbnail_face_id, 32)} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
                        : <div className="w-5 h-5 rounded-full bg-zinc-600 shrink-0 flex items-center justify-center text-[9px] text-zinc-400">{(p.name ?? '?')[0]}</div>}
                      <span className="text-xs text-zinc-200 truncate">{p.name ?? '(unnamed)'}</span>
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => { setShowPersonSearch(false); setPersonSearchQ('') }}
                className="mt-1 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setShowPersonSearch(true)}
              className="text-[10px] text-zinc-600 hover:text-brand-400 transition-colors">
              + Add participant
            </button>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-0.5">
        <div className="flex gap-2">
          <button onClick={save} disabled={saving}
            className="px-3 py-1 text-xs font-medium bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-white rounded-lg transition-colors">
            {saving ? 'Saving…' : isExisting ? 'Update' : 'Save'}
          </button>
          <button onClick={onCancel} className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
            {isExisting ? 'Done' : 'Cancel'}
          </button>
        </div>
        {isExisting && (
          confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-500">Delete?</span>
              <button onClick={handleDelete} className="text-[10px] text-red-400 hover:text-red-300 font-medium">Yes</button>
              <button onClick={() => setConfirmDelete(false)} className="text-[10px] text-zinc-600 hover:text-zinc-400">No</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors">Delete</button>
          )
        )}
      </div>

      {showImagePicker && (
        <ImagePickerModal
          personId={personId}
          persons={persons}
          alreadyAttachedIds={new Set((localEvent?.images ?? []).map(ei => ei.image_id))}
          onSelect={handleAddImage}
          onClose={() => setShowImagePicker(false)}
        />
      )}
    </div>
  )
}

// ── AutoEventRow ──────────────────────────────────────────────────────────────

interface AutoEvent {
  kind: 'auto'
  eventType: string
  year: number | null
  dateStr: string | null
  place: string | null
  label: string
  onEdit?: () => void
  onAttachPhoto?: () => void
}

function AutoEventRow({ ev, isLast }: { ev: AutoEvent; isLast: boolean }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center" style={{ minWidth: 48 }}>
        <span className="text-xs text-zinc-600 tabular-nums font-mono shrink-0 text-right w-full">{ev.year ?? ''}</span>
      </div>
      <div className="flex flex-col items-center">
        <div className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 mt-0.5">
          <EventIcon type={ev.eventType} auto />
        </div>
        {!isLast && <div className="w-px flex-1 bg-zinc-800 mt-1" />}
      </div>
      <div className="pb-4 min-w-0 flex-1">
        <p className="text-xs text-zinc-400 font-medium leading-snug">{ev.label}</p>
        {ev.dateStr && <p className="text-[10px] text-zinc-600 mt-0.5">{ev.dateStr}</p>}
        {ev.place && <p className="text-[10px] text-zinc-500 mt-0.5">{ev.place}</p>}
        <div className="flex gap-3 mt-1">
          {ev.onAttachPhoto && (
            <button onClick={ev.onAttachPhoto} className="text-[10px] text-zinc-600 hover:text-brand-400 transition-colors">+ Attach photo</button>
          )}
          {ev.onEdit && (
            <button onClick={ev.onEdit} className="text-[10px] text-zinc-700 hover:text-zinc-500 transition-colors">Edit in Bio →</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── ManualEventRow ─────────────────────────────────────────────────────────────

function ManualEventRow({ ev, isLast, dimmed, onEdit, onNavToEventPage }: {
  ev: PersonEvent
  isLast: boolean
  dimmed: boolean
  onEdit: () => void
  onNavToEventPage?: () => void
}) {
  const typeLabel = EVENT_TYPE_OPTIONS.find(o => o.value === ev.event_type)?.label ?? ev.event_type
  const dateStr = formatEventDate(ev.date, ev.year)
  const participants = ev.persons.filter(ep => ep.role === 'participant')

  return (
    <div className={`flex gap-3 transition-opacity ${dimmed ? 'opacity-40' : ''}`}>
      <div className="flex flex-col items-center" style={{ minWidth: 48 }}>
        <span className="text-xs text-zinc-600 tabular-nums font-mono shrink-0 text-right w-full">{ev.year ?? ''}</span>
      </div>
      <div className="flex flex-col items-center">
        <div className="w-6 h-6 rounded-full bg-zinc-900 border border-brand-600/50 flex items-center justify-center shrink-0 mt-0.5">
          <EventIcon type={ev.event_type} />
        </div>
        {!isLast && <div className="w-px flex-1 bg-zinc-800 mt-1" />}
      </div>
      <div className="pb-4 min-w-0 flex-1">
        <div className="group/ev">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-zinc-200 font-medium leading-snug">{ev.title || typeLabel}</p>
              {ev.title && <p className="text-[10px] text-zinc-500">{typeLabel}</p>}
              {dateStr && <p className="text-[10px] text-zinc-500 mt-0.5">{dateStr}</p>}
              {ev.place && <p className="text-[10px] text-zinc-500 mt-0.5">{ev.place}</p>}
              {ev.description && <p className="text-[10px] text-zinc-500 mt-1 leading-relaxed">{ev.description}</p>}
            </div>
            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/ev:opacity-100 transition-all">
              {onNavToEventPage && (
                <button onClick={onNavToEventPage}
                  title="Open in Events page"
                  className="p-1 rounded text-zinc-600 hover:text-brand-400 hover:bg-zinc-700 transition-all">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
              )}
              <button onClick={onEdit}
                className="p-1 rounded text-zinc-600 hover:text-zinc-200 hover:bg-zinc-700 transition-all">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2.25 2.25 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2.414a2 2 0 01.586-1.414z" />
                </svg>
              </button>
            </div>
          </div>
          {ev.images.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {ev.images.map(ei => (
                <img key={ei.id} src={api.imageViewUrl(ei.image_id, 120)} alt=""
                  className="w-10 h-10 rounded-lg object-cover border border-zinc-700" />
              ))}
            </div>
          )}
          {participants.length > 0 && (
            <div className="flex gap-1 mt-1.5 flex-wrap items-center">
              <span className="text-[9px] text-zinc-600">Also:</span>
              {participants.map(ep => (
                <div key={ep.id} className="flex items-center gap-0.5">
                  {ep.thumbnail_face_id ? (
                    <img src={api.faceThumbnailUrl(ep.thumbnail_face_id, 32)} alt="" className="w-4 h-4 rounded-full object-cover" />
                  ) : <div className="w-4 h-4 rounded-full bg-zinc-700" />}
                  <span className="text-[9px] text-zinc-500">{ep.person_name ?? '(unnamed)'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── EventTimeline ─────────────────────────────────────────────────────────────

interface Props {
  person: PersonFull
  relations: Relation[]
  persons: PersonFull[]
  onNavigateToBio?: () => void
  onNavToEvent?: (eventId: number) => void
}

export default function EventTimeline({ person, relations, persons, onNavigateToBio, onNavToEvent }: Props) {
  const qc = useQueryClient()

  // editingEvent: the event currently open in the editor (null = no editor open)
  const [editingEvent, setEditingEvent] = useState<PersonEvent | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [autoEventPrefill, setAutoEventPrefill] = useState<{ event_type: string; date: string; place: string } | null>(null)

  const { data: manualEvents = [], refetch } = useQuery({
    queryKey: ['person-events', person.id],
    queryFn: () => api.events.listForPerson(person.id),
    staleTime: 30_000,
  })

  const byId = useMemo(() => new Map(persons.map(p => [p.id, p])), [persons])

  function openAttachPhotoForAuto(eventType: string, date: string | null, place: string | null) {
    setAutoEventPrefill({ event_type: eventType, date: date ?? '', place: place ?? '' })
    setEditingEvent(null)
    setIsCreating(true)
  }

  // Build auto-events from person fields + relations
  const autoEvents = useMemo((): AutoEvent[] => {
    const evs: AutoEvent[] = []

    if (person.birth_date || person.birth_year || person.birth_place) {
      evs.push({
        kind: 'auto', eventType: 'birth',
        year: getYear(person.birth_date, person.birth_year),
        dateStr: formatEventDate(person.birth_date, person.birth_year),
        place: person.birth_place, label: 'Born',
        onEdit: onNavigateToBio,
        onAttachPhoto: () => openAttachPhotoForAuto('birth', person.birth_date ?? (person.birth_year ? String(person.birth_year) : null), person.birth_place),
      })
    }
    if (person.christening_date || person.christening_year || person.christening_place) {
      evs.push({
        kind: 'auto', eventType: 'christening',
        year: getYear(person.christening_date, person.christening_year),
        dateStr: formatEventDate(person.christening_date, person.christening_year),
        place: person.christening_place, label: 'Christened',
        onEdit: onNavigateToBio,
        onAttachPhoto: () => openAttachPhotoForAuto('christening', person.christening_date ?? (person.christening_year ? String(person.christening_year) : null), person.christening_place),
      })
    }
    for (const r of relations) {
      if (r.type !== 'spouse') continue
      if (r.person_a_id !== person.id && r.person_b_id !== person.id) continue
      const spouseId = r.person_a_id === person.id ? r.person_b_id : r.person_a_id
      const spouse = byId.get(spouseId)
      const spouseName = spouse?.name ?? '(unnamed)'
      if (r.marriage_year || r.marriage_place) {
        evs.push({
          kind: 'auto', eventType: 'marriage',
          year: r.marriage_year, dateStr: r.marriage_year ? String(r.marriage_year) : null,
          place: r.marriage_place, label: `Married ${spouseName}`,
          onEdit: onNavigateToBio,
          onAttachPhoto: () => openAttachPhotoForAuto('marriage', r.marriage_year ? String(r.marriage_year) : null, r.marriage_place),
        })
      }
      if (r.divorce_year || r.divorce_place) {
        evs.push({
          kind: 'auto', eventType: 'divorce',
          year: r.divorce_year, dateStr: r.divorce_year ? String(r.divorce_year) : null,
          place: r.divorce_place, label: `Divorced ${spouseName}`,
          onEdit: onNavigateToBio,
          onAttachPhoto: () => openAttachPhotoForAuto('divorce', r.divorce_year ? String(r.divorce_year) : null, r.divorce_place),
        })
      }
    }
    if (person.death_date || person.death_year || person.death_place) {
      evs.push({
        kind: 'auto', eventType: 'death',
        year: getYear(person.death_date, person.death_year),
        dateStr: formatEventDate(person.death_date, person.death_year),
        place: person.death_place, label: 'Died',
        onEdit: onNavigateToBio,
        onAttachPhoto: () => openAttachPhotoForAuto('death', person.death_date ?? (person.death_year ? String(person.death_year) : null), person.death_place),
      })
    }
    if (person.burial_date || person.burial_year || person.burial_place) {
      evs.push({
        kind: 'auto', eventType: 'burial',
        year: getYear(person.burial_date, person.burial_year),
        dateStr: formatEventDate(person.burial_date, person.burial_year),
        place: person.burial_place, label: 'Buried',
        onEdit: onNavigateToBio,
        onAttachPhoto: () => openAttachPhotoForAuto('burial', person.burial_date ?? (person.burial_year ? String(person.burial_year) : null), person.burial_place),
      })
    }
    return evs
  }, [person, relations, byId, onNavigateToBio])

  type Entry =
    | { kind: 'auto'; ev: AutoEvent; sortYear: number | null }
    | { kind: 'manual'; ev: PersonEvent; sortYear: number | null }

  const allEntries = useMemo((): Entry[] => {
    const combined: Entry[] = [
      ...autoEvents.map(ev => ({ kind: 'auto' as const, ev, sortYear: ev.year })),
      ...manualEvents.map(ev => ({ kind: 'manual' as const, ev, sortYear: ev.year })),
    ]
    combined.sort((a, b) => {
      if (a.sortYear == null && b.sortYear == null) return 0
      if (a.sortYear == null) return 1
      if (b.sortYear == null) return -1
      return a.sortYear - b.sortYear
    })
    return combined
  }, [autoEvents, manualEvents])

  const showEditor = isCreating || editingEvent !== null
  const editorIsNew = isCreating && editingEvent === null

  function closeEditor() {
    setEditingEvent(null)
    setIsCreating(false)
    setAutoEventPrefill(null)
  }

  function handleEditorSaved(saved: PersonEvent) {
    // If we just saved a new event, keep the editor open in "edit" mode so photos can be attached
    if (editorIsNew) {
      setIsCreating(false)
      setAutoEventPrefill(null)
      setEditingEvent(saved)
    } else {
      // Update was already applied; just refresh
      setEditingEvent(saved)
    }
    refetch()
    qc.invalidateQueries({ queryKey: ['events'] })
  }

  return (
    <div className="px-5 py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Timeline</h3>
        {!showEditor && (
          <button onClick={() => { setIsCreating(true); setEditingEvent(null); setAutoEventPrefill(null) }}
            className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors">
            + Add event
          </button>
        )}
      </div>

      {/* Editor (create or edit) — always shown at top */}
      {showEditor && (
        <div className="mb-4">
          <EventEditor
            event={editingEvent}
            prefill={autoEventPrefill ?? undefined}
            personId={person.id}
            persons={persons}
            onSaved={handleEditorSaved}
            onDeleted={() => { closeEditor(); refetch(); qc.invalidateQueries({ queryKey: ['events'] }) }}
            onCancel={closeEditor}
          />
        </div>
      )}

      {/* Empty state */}
      {allEntries.length === 0 && !showEditor && (
        <p className="text-sm text-zinc-600 italic">
          No events yet — add manually or fill in birth / death dates in the Bio tab.
        </p>
      )}

      {/* Timeline */}
      <div>
        {allEntries.map((entry, i) => {
          const isLast = i === allEntries.length - 1
          if (entry.kind === 'auto') {
            return <AutoEventRow key={`a-${i}`} ev={entry.ev} isLast={isLast} />
          }
          const ev = entry.ev
          const isEditing = editingEvent?.id === ev.id
          return (
            <ManualEventRow
              key={`m-${ev.id}`}
              ev={ev}
              isLast={isLast}
              dimmed={isEditing}
              onEdit={() => { setEditingEvent(ev); setIsCreating(false); setAutoEventPrefill(null) }}
              onNavToEventPage={onNavToEvent ? () => onNavToEvent(ev.id) : undefined}
            />
          )
        })}
      </div>
    </div>
  )
}

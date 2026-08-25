import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useBackdropClose } from '../modalBackdrop'
import type { LinkedCluster, PersonFull, Relation, ImageItem, ImagePerson, PersonDocument, DocumentType, Source, Citation } from '../types'
import NameEditor, { NameParts, namePartsFromPerson, deriveDisplayName } from './NameEditor'
import PlaceInput from './PlaceInput'
import VocabInput from './VocabInput'
import { useSettings, displayPersonName, displayInitials, useT, useDateLocale, formatPartialDate, monthNames } from '../SettingsContext'
import { NoteCard } from './NoteEditor'
import NoteEditorComponent from './NoteEditor'
import EventTimeline from './EventTimeline'
import RelationPathModal from './RelationPathModal'
import { docTypeLabel, builtinDocTypeOptions } from '../docTypes'
import { plainMentions } from '../markdown'
import { useFamilyContext, FamilyContextLines, personLifeSummary } from '../familyContext'

// ── Constants ─────────────────────────────────────────────────────────────────

const PHOTOS_CAP = 6



// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatDate(date: string | null | undefined, fallbackYear: number | null | undefined, locale: string): string | null {
  if (date) return formatPartialDate(date, locale)
  return fallbackYear != null ? String(fallbackYear) : null
}

function lifespan(p: PersonFull, locale: string) {
  const b = [formatDate(p.birth_date, p.birth_year, locale), p.birth_place].filter(Boolean).join(', ')
  const d = [formatDate(p.death_date, p.death_year, locale), p.death_place].filter(Boolean).join(', ')
  if (!b && !d) return null
  if (p.death_year || p.death_place || p.death_date) return `${b || '?'} – ${d || '?'}`
  return b ? `* ${b}` : null
}

function calcAge(p: PersonFull): { age: number; alive: boolean } | null {
  const by = p.birth_date ? parseInt(p.birth_date.slice(0, 4)) : (p.birth_year ?? null)
  if (by == null) return null
  if (p.death_date || p.death_year) {
    const dy = p.death_date ? parseInt(p.death_date.slice(0, 4)) : p.death_year!
    if (dy <= by) return null
    return { age: dy - by, alive: false }
  }
  const age = new Date().getFullYear() - by
  if (age > 130) return null
  return { age, alive: true }
}

// ── DatePartPicker ────────────────────────────────────────────────────────────
// value: "" | "YYYY" | "YYYY-MM" | "YYYY-MM-DD"

function DatePartPicker({ value, onChange, placeholder }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const t = useT()
  const dateLocale = useDateLocale()
  const parts = value ? value.split('-') : []
  const yr = parts[0] ?? ''
  const mo = parts[1] ?? ''
  const dy = parts[2] ?? ''

  function update(y: string, m: string, d: string) {
    if (!y) { onChange(''); return }
    let result = y
    if (m) {
      result += '-' + m
      if (d) result += '-' + d
    }
    onChange(result)
  }

  const maxDays = yr && mo ? new Date(parseInt(yr), parseInt(mo), 0).getDate() : 31

  return (
    <div className="flex gap-1 items-center flex-wrap">
      <input
        type="number"
        value={yr}
        onChange={e => update(e.target.value, mo, dy)}
        placeholder={placeholder ?? t('timeline.yearPh')}
        min={1000} max={2100}
        className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400 [appearance:textfield]"
      />
      {yr && (
        <select
          value={mo}
          onChange={e => update(yr, e.target.value, e.target.value ? dy : '')}
          className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 outline-none focus:border-brand-400"
        >
          <option value="">{t('timeline.monthPh')}</option>
          {monthNames(dateLocale).map((m, i) => (
            <option key={i} value={String(i + 1).padStart(2, '0')}>{m}</option>
          ))}
        </select>
      )}
      {yr && mo && (
        <select
          value={dy}
          onChange={e => update(yr, mo, e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 outline-none focus:border-brand-400"
        >
          <option value="">{t('timeline.dayPh')}</option>
          {Array.from({ length: maxDays }, (_, i) => i + 1).map(d => (
            <option key={d} value={String(d).padStart(2, '0')}>{d}.</option>
          ))}
        </select>
      )}
    </div>
  )
}

function isImage(mime: string | null) {
  return mime?.startsWith('image/') ?? false
}

function isPdf(mime: string | null) {
  return mime === 'application/pdf'
}

function isAudio(mime: string | null) {
  return mime?.startsWith('audio/') ?? false
}

function DocIcon({ mime }: { mime: string | null }) {
  if (isImage(mime)) {
    return (
      <svg className="w-4 h-4 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 16.5V6.75A2.25 2.25 0 015.25 4.5h13.5A2.25 2.25 0 0121 6.75v10.5A2.25 2.25 0 0118.75 19.5H5.25A2.25 2.25 0 013 17.25v-.75z" />
      </svg>
    )
  }
  if (isPdf(mime)) {
    return (
      <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    )
  }
  if (isAudio(mime)) {
    return (
      <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
      </svg>
    )
  }
  return (
    <svg className="w-4 h-4 text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  )
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function parseMeta(json: string | null): { width?: number; height?: number; make?: string; model?: string } {
  if (!json) return {}
  try { return JSON.parse(json) } catch { return {} }
}

function Lightbox({ images, idx, onClose, onChange, onNavigateTo }: {
  images: ImageItem[]
  idx: number
  onClose: () => void
  onChange: (i: number) => void
  onNavigateTo: (id: number) => void
}) {
  const t = useT()
  const dateLocale = useDateLocale()
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft')  onChange(Math.max(0, idx - 1))
      if (e.key === 'ArrowRight') onChange(Math.min(images.length - 1, idx + 1))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [idx, images.length, onClose, onChange])

  const img = images[idx]
  const { data: persons = [] } = useQuery<ImagePerson[]>({
    queryKey: ['image-persons', img.id],
    queryFn: () => api.images.persons(img.id),
    staleTime: 120_000,
    enabled: img.face_count > 0,
  })
  const exifMeta = parseMeta(img.meta_json)
  const backdrop = useBackdropClose(onClose)

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/90" {...backdrop}>
      {/* Nav arrows */}
      <button onClick={e => { e.stopPropagation(); onChange(idx - 1) }} disabled={idx === 0}
        className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-zinc-800/80 hover:bg-zinc-700 disabled:opacity-20 flex items-center justify-center text-zinc-200 text-2xl transition-colors z-10">‹</button>
      <button onClick={e => { e.stopPropagation(); onChange(idx + 1) }} disabled={idx === images.length - 1}
        className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-zinc-800/80 hover:bg-zinc-700 disabled:opacity-20 flex items-center justify-center text-zinc-200 text-2xl transition-colors z-10">›</button>

      {/* Card */}
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col mx-16"
        style={{ maxHeight: '92vh', width: 'min(860px, calc(100vw - 120px))' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Image area */}
        <div className="bg-zinc-950 flex items-center justify-center overflow-hidden relative" style={{ maxHeight: '68vh', minHeight: 200 }}>
          <img
            key={img.id}
            src={api.imageViewUrl(img.id, 1400)}
            alt={img.filename}
            className="max-w-full max-h-full object-contain"
            style={{ maxHeight: '68vh' }}
          />
          <div className="absolute bottom-2 right-2 bg-black/60 rounded-lg px-2 py-0.5 text-xs text-zinc-400 tabular-nums">
            {idx + 1} / {images.length}
          </div>
        </div>

        {/* Metadata */}
        <div className="px-5 py-4 flex items-start justify-between gap-4 overflow-y-auto">
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <p className="font-semibold text-zinc-100 truncate" title={img.filename}>{img.filename}</p>
              <p className="text-xs text-zinc-500 truncate mt-0.5" title={img.path}>{img.path}</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
              {img.exif_date && (
                <span className="flex items-center gap-1 text-zinc-300 font-medium">
                  <svg className="w-3 h-3 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {new Date(img.exif_date).toLocaleString(dateLocale)}
                </span>
              )}
              {(exifMeta.make || exifMeta.model) && (
                <span>{[exifMeta.make, exifMeta.model].filter(Boolean).join(' ')}</span>
              )}
              {exifMeta.width && exifMeta.height && (
                <span>{exifMeta.width} × {exifMeta.height}</span>
              )}
            </div>
            {persons.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-zinc-600">{t('person.lightboxPersons')}</span>
                {persons.map(p => (
                  <button key={p.person_id}
                    onClick={() => { onNavigateTo(p.person_id); onClose() }}
                    className="inline-flex items-center gap-1 pl-0.5 pr-2 py-0.5 bg-zinc-800 border border-zinc-700 hover:border-zinc-500 hover:bg-zinc-700 rounded-full text-xs text-zinc-300 transition-colors cursor-pointer">
                    <img src={api.faceThumbnailUrl(p.face_id, 32)} alt=""
                      className="w-4 h-4 rounded-full object-cover shrink-0" />
                    {p.person_name ?? t('images.unnamed')}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={onClose}
            className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── PhotoGallery ──────────────────────────────────────────────────────────────

function PhotoGallery({ images, onOpen }: { images: ImageItem[]; onOpen: (i: number) => void }) {
  const dateLocale = useDateLocale()
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {images.map((img, i) => (
        <button key={img.id} onClick={() => onOpen(i)}
          className="aspect-square rounded-lg overflow-hidden bg-zinc-800 hover:ring-2 hover:ring-brand-400 transition-all group relative">
          <img src={api.imageViewUrl(img.id, 360)} alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
          {img.exif_date && (
            <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <p className="text-xs text-zinc-300 text-center leading-tight">{fmtDate(img.exif_date, dateLocale)}</p>
            </div>
          )}
        </button>
      ))}
    </div>
  )
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ person, size }: { person: PersonFull; size: number }) {
  const [err, setErr] = useState(false)
  const init = displayInitials(person)
  if (person.thumbnail_face_id && !err) {
    return (
      <img src={api.faceThumbnailUrl(person.thumbnail_face_id, size * 2)} alt=""
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }} onError={() => setErr(true)} />
    )
  }
  return (
    <div className="rounded-full bg-zinc-700 flex items-center justify-center shrink-0 font-bold text-zinc-300"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
      {init}
    </div>
  )
}

// ── PersonPicker ──────────────────────────────────────────────────────────────

function _personLifespan(p: PersonFull): string {
  const by = p.birth_date ? parseInt(p.birth_date) : (p.birth_year ?? null)
  const dy = p.death_date ? parseInt(p.death_date) : (p.death_year ?? null)
  const years = [by, dy].filter(v => v != null).join('–')
  if (years && p.birth_place) return `${years} · ${p.birth_place}`
  return years || p.birth_place || ''
}

function PersonPicker({ persons, excludeIds, relations, label, headerExtra, onSelect, onClose }: {
  persons: PersonFull[]
  excludeIds: Set<number>
  relations: Relation[]
  label: string
  /** Rendered under the dialog title in both modes — the child picker's co-parent choice. */
  headerExtra?: React.ReactNode
  onSelect: (p: PersonFull) => void
  onClose: () => void
}) {
  const t = useT()
  const qc = useQueryClient()
  const { nameOrder } = useSettings()
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<'list' | 'create'>('list')
  const [newParts, setNewParts] = useState<NameParts>({ title: '', first_name: '', last_name: '', middle_name: '', nickname: '' })
  const [newBirthYear, setNewBirthYear] = useState('')
  const [newSex, setNewSex] = useState<'' | 'M' | 'F'>('')
  const [creating, setCreating] = useState(false)

  const personById = useMemo(() => new Map(persons.map(p => [p.id, p])), [persons])

  const parentsOf = useMemo(() => {
    const map = new Map<number, string[]>()
    for (const rel of relations) {
      if (rel.type !== 'parent') continue
      const name = personById.get(rel.person_a_id)?.name
      if (!name) continue
      const list = map.get(rel.person_b_id) ?? []
      list.push(name)
      map.set(rel.person_b_id, list)
    }
    return map
  }, [relations, personById])

  const spousesOf = useMemo(() => {
    const map = new Map<number, string[]>()
    for (const rel of relations) {
      if (rel.type !== 'spouse') continue
      const nameA = personById.get(rel.person_a_id)?.name
      const nameB = personById.get(rel.person_b_id)?.name
      if (nameA) { const l = map.get(rel.person_b_id) ?? []; l.push(nameA); map.set(rel.person_b_id, l) }
      if (nameB) { const l = map.get(rel.person_a_id) ?? []; l.push(nameB); map.set(rel.person_a_id, l) }
    }
    return map
  }, [relations, personById])

  const filtered = persons
    .filter(p => !excludeIds.has(p.id))
    .filter(p => (p.name ?? '').toLowerCase().includes(search.toLowerCase()))
    .slice(0, 12)

  const backdrop = useBackdropClose(onClose)

  async function handleCreate() {
    const displayName = deriveDisplayName(newParts).trim()
    if (creating || !displayName) return
    setCreating(true)
    try {
      const newPerson = await api.persons.create({
        name:        displayName,
        first_name:  newParts.first_name.trim()  || null,
        last_name:   newParts.last_name.trim()   || null,
        middle_name: newParts.middle_name.trim() || null,
        title:       newParts.title.trim()       || null,
        nickname:    newParts.nickname.trim()    || null,
        birth_year:  newBirthYear ? parseInt(newBirthYear) : null,
        sex:         newSex || null,
      })
      await qc.invalidateQueries({ queryKey: ['persons'] })
      onSelect(newPerson)
      onClose()
    } finally {
      setCreating(false)
    }
  }

  if (mode === 'create') {
    const displayName = deriveDisplayName(newParts)
    const INPUT = 'w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400'
    const LABEL = 'block text-xs text-zinc-500 mb-0.5'
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center" {...backdrop}>
        <div className="bg-zinc-800 border border-zinc-700 rounded-2xl shadow-2xl w-96 flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="px-4 pt-3 pb-2 border-b border-zinc-700">
            <div className="flex items-center gap-2">
              <button onClick={() => setMode('list')} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none transition-colors">‹</button>
              <p className="text-xs font-semibold text-zinc-300">{t('person.pickerTitle', { label: label.toLowerCase() })}</p>
            </div>
            {headerExtra}
          </div>
          <div className="px-4 py-4 space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={LABEL}>{t('person.firstName')}</label>
                <input autoFocus value={newParts.first_name} onChange={e => setNewParts(p => ({ ...p, first_name: e.target.value }))}
                  placeholder={t('person.firstNamePh')} className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>{t('person.lastName')}</label>
                <input value={newParts.last_name} onChange={e => setNewParts(p => ({ ...p, last_name: e.target.value }))}
                  placeholder={t('person.lastNamePh')} className={INPUT} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={LABEL}>{t('person.birthYear')}</label>
                <input type="number" value={newBirthYear} onChange={e => setNewBirthYear(e.target.value)}
                  placeholder="1945" className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>{t('person.sex')}</label>
                <div className="flex gap-1">
                  {(['', 'M', 'F'] as const).map(v => (
                    <button key={v} type="button" onClick={() => setNewSex(v)}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-xs transition-colors ${newSex === v ? 'bg-brand-500 text-white' : 'bg-zinc-700 border border-zinc-600 text-zinc-400 hover:bg-zinc-650'}`}>
                      {v === '' ? '—' : v === 'M' ? t('person.sexMale') : t('person.sexFemale')}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {displayName && (
              <p className="text-xs text-zinc-500">
                {t('person.displayedAs')} <span className="text-zinc-300 font-medium">{displayName}</span>
              </p>
            )}
            <button onClick={handleCreate} disabled={creating || !displayName.trim()}
              className="w-full py-2 bg-brand-500 hover:bg-brand-400 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
              {creating ? t('person.creating') : t('person.createAndAdd')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" {...backdrop}>
      <div className="bg-zinc-800 border border-zinc-700 rounded-2xl shadow-2xl w-96 flex flex-col overflow-hidden" style={{ maxHeight: 480 }} onClick={e => e.stopPropagation()}>
        <div className="px-4 pt-3 pb-2 border-b border-zinc-700">
          <p className="text-xs font-semibold text-zinc-300 mb-2">{label}</p>
          {headerExtra}
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('person.pickerSearch')}
            className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400" />
        </div>
        <div className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-4 italic">{t('person.noResults')}</p>
          ) : filtered.map(p => {
            const lifespan = _personLifespan(p)
            const parents  = parentsOf.get(p.id) ?? []
            const spouses  = spousesOf.get(p.id) ?? []
            return (
              <button key={p.id} onClick={() => { onSelect(p); onClose() }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-zinc-700 transition-colors border-b border-zinc-700/40 last:border-0">
                <div className="shrink-0"><Avatar person={p} size={32} /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-zinc-200 truncate">{displayPersonName(p, nameOrder)}</span>
                    {p.sex && <span className="text-xs text-zinc-600 shrink-0">{p.sex === 'M' ? '♂' : '♀'}</span>}
                  </div>
                  {lifespan && <p className="text-xs text-zinc-500 mt-0.5 truncate">{lifespan}</p>}
                  {parents.length > 0 && (
                    <p className="text-xs text-zinc-600 mt-0.5 truncate">
                      <span className="text-zinc-700">{t('person.pickerParents')} </span>{parents.join(', ')}
                    </p>
                  )}
                  {spouses.length > 0 && (
                    <p className="text-xs text-zinc-600 mt-0.5 truncate">
                      <span className="text-zinc-700">{t('person.pickerSpouse')} </span>{spouses.join(', ')}
                    </p>
                  )}
                </div>
              </button>
            )
          })}
        </div>
        <div className="border-t border-zinc-700">
          <button onClick={() => setMode('create')}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-zinc-700/60 transition-colors">
            <div className="w-8 h-8 rounded-full bg-brand-700 flex items-center justify-center shrink-0 text-white text-base font-bold">+</div>
            <span className="text-sm text-brand-300 font-medium">{t('person.createNew')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

// ── CoParentChoice ───────────────────────────────────────────────────────────

/**
 * Which spouse a child being added also belongs to.
 *
 * A child carries two `parent` rows and nothing else records a couple, so the
 * answer to "whose child is this too?" is a second relation — and asking it
 * here is what saves the user from opening the spouse's own panel and adding
 * the same child a second time. Picking nobody is a real answer (a child from
 * a partner who is not in the tree), not a skipped question, which is why the
 * last row is an explicit choice rather than the absence of one.
 *
 * The options are a list of people, so they carry the life summary and the
 * relative lines every other person list in the app carries: two of a man's
 * wives can read identically on the name alone.
 */
function CoParentChoice({ options, persons, relations, value, onChange }: {
  options: { rel: Relation; p: PersonFull }[]
  persons: PersonFull[]
  relations: Relation[]
  value: number | null
  onChange: (id: number | null) => void
}) {
  const t = useT()
  const { nameOrder } = useSettings()
  const fam = useFamilyContext(persons, relations, nameOrder)

  const rowCls = (active: boolean) =>
    `w-full flex items-start gap-2 px-2 py-1.5 rounded-lg text-left border transition-colors ${
      active
        ? 'bg-brand-500/15 border-brand-500/50'
        : 'bg-zinc-700/40 border-transparent hover:bg-zinc-700'
    }`

  return (
    <div className="mb-2">
      <p className="text-[11px] text-zinc-500 mb-1">{t('person.otherParentLabel')}</p>
      <div className="space-y-1 max-h-44 overflow-y-auto">
        {options.map(({ rel, p }) => {
          const life = personLifeSummary(p)
          const marriage = [rel.marriage_year, rel.marriage_place].filter(Boolean).join(', ')
          return (
            <button key={p.id} onClick={() => onChange(p.id)} className={rowCls(value === p.id)}>
              <Avatar person={p} size={24} />
              <span className="flex-1 min-w-0">
                <span className="block text-xs text-zinc-100 truncate">{displayPersonName(p, nameOrder)}</span>
                {life && <span className="block text-xs text-zinc-500 truncate">{life}</span>}
                {marriage && <span className="block text-xs text-zinc-500 truncate">⚭ {marriage}</span>}
                <FamilyContextLines fam={fam.get(p.id)} dim />
              </span>
              {value === p.id && <span className="text-brand-300 text-xs shrink-0">✓</span>}
            </button>
          )
        })}
        <button onClick={() => onChange(null)} className={rowCls(value === null)}>
          <span className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-zinc-500 text-xs shrink-0">?</span>
          <span className="flex-1 text-xs text-zinc-300 leading-6 truncate">{t('person.otherParentNone')}</span>
          {value === null && <span className="text-brand-300 text-xs shrink-0">✓</span>}
        </button>
      </div>
    </div>
  )
}

// ── RelRow ────────────────────────────────────────────────────────────────────

type PickerMode = 'parent' | 'spouse' | 'child' | 'sibling' | null

function RelRow({
  label, persons, groups, editing, onNavigate, onRemove, addLabel, onAdd, addDisabled,
  relPrivacy, onTogglePrivacy,
}: {
  label: string
  persons: PersonFull[]
  /**
   * Optional sub-grouping of the same people. The children row splits by
   * co-parent once there is more than one, so a second marriage's children
   * are not silently mixed into the first's; left undefined the row renders
   * flat, which is what every other relation row wants.
   */
  groups?: { key: string; label: string; persons: PersonFull[] }[]
  editing: boolean
  onNavigate: (id: number) => void
  onRemove?: (p: PersonFull) => void
  addLabel: string
  onAdd: () => void
  addDisabled?: boolean
  relPrivacy?: Map<number, { relId: number; isPrivate: boolean }>
  onTogglePrivacy?: (relId: number, isPrivate: boolean) => Promise<void>
}) {
  const t = useT()
  const { nameOrder } = useSettings()
  const [privacyBusy, setPrivacyBusy] = useState<Set<number>>(new Set())
  if (!editing && persons.length === 0) return null

  async function toggleRelPrivacy(relId: number, isPrivate: boolean) {
    if (!onTogglePrivacy) return
    setPrivacyBusy(s => new Set([...s, relId]))
    try { await onTogglePrivacy(relId, isPrivate) }
    finally { setPrivacyBusy(s => { const n = new Set(s); n.delete(relId); return n }) }
  }

  function chip(p: PersonFull) {
    const priv = relPrivacy?.get(p.id)
    const isPrivate = priv?.isPrivate ?? false
    return (
      <div key={p.id} className="inline-flex items-center group">
        <button
          onClick={() => onNavigate(p.id)}
          className="inline-flex items-center gap-1.5 pl-1.5 pr-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/60 hover:border-zinc-500 rounded-full transition-colors max-w-[160px]"
        >
          <Avatar person={p} size={20} />
          <span className="text-xs text-zinc-200 truncate leading-none">{displayPersonName(p, nameOrder)}</span>
        </button>
        {priv && onTogglePrivacy && (
          <button
            onClick={() => !privacyBusy.has(priv.relId) && toggleRelPrivacy(priv.relId, !isPrivate)}
            title={isPrivate ? t('person.privacyOn') : t('person.privacyOff')}
            className={`ml-0.5 w-4 h-4 flex items-center justify-center transition-colors shrink-0 ${isPrivate ? 'text-amber-400' : 'text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-300'}`}
          >
            {isPrivate ? (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <rect x="3" y="11" width="18" height="11" rx="2" /><path strokeLinecap="round" d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
            ) : (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <rect x="3" y="11" width="18" height="11" rx="2" /><path strokeLinecap="round" d="M7 11V7a5 5 0 019.9-1" />
              </svg>
            )}
          </button>
        )}
        {editing && onRemove && (
          <button onClick={() => onRemove(p)}
            className="ml-0.5 w-4 h-4 rounded-full bg-zinc-700 hover:bg-red-700 flex items-center justify-center text-xs text-zinc-400 hover:text-white transition-colors shrink-0"
            title={t('person.removeRelation')}>✕</button>
        )}
      </div>
    )
  }

  const addButton = editing && !addDisabled && (
    <button onClick={onAdd}
      className="inline-flex items-center gap-1 h-7 px-2.5 text-xs text-zinc-500 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-dashed border-zinc-700 hover:border-zinc-500 rounded-full transition-colors shrink-0">
      {addLabel}
    </button>
  )

  return (
    <div>
      <p className="text-xs text-zinc-600 uppercase tracking-wider mb-1.5">{label}</p>
      {groups ? (
        <div className="space-y-2">
          {groups.map(g => (
            <div key={g.key}>
              <p className="text-xs text-zinc-600 mb-1 truncate">{g.label}</p>
              <div className="flex flex-wrap gap-1.5 items-center">{g.persons.map(chip)}</div>
            </div>
          ))}
          {addButton}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5 items-center">
          {persons.map(chip)}
          {addButton}
        </div>
      )}
    </div>
  )
}

// ── DocUploadForm ─────────────────────────────────────────────────────────────

function DocUploadForm({ personId, onDone }: { personId: number; onDone: () => void }) {
  const t = useT()
  const qc = useQueryClient()
  const { data: docTypes = [] } = useQuery<DocumentType[]>({ queryKey: ['doc-types'], queryFn: api.documentTypes.list })
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [docType, setDocType] = useState('other')
  const [year, setYear] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) setFile(f)
  }

  async function submit() {
    if (!file || uploading) return
    setUploading(true)
    try {
      await api.documents.upload([personId], [file], {
        title: title.trim() || undefined,
        doc_type: docType,
        year: year ? parseInt(year) : undefined,
      })
      qc.invalidateQueries({ queryKey: ['person-docs', personId] })
      onDone()
    } catch (e) {
      alert(t('person.uploadFailed', { e: String(e) }))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-3 mb-3 space-y-2.5">
      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-lg px-3 py-3 text-center cursor-pointer transition-colors ${dragOver ? 'border-brand-400 bg-brand-500/10' : 'border-zinc-700 hover:border-zinc-500'}`}
      >
        <input ref={fileRef} type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        {file ? (
          <p className="text-xs text-zinc-200 truncate">{file.name}</p>
        ) : (
          <p className="text-xs text-zinc-500">{t('person.uploadDropZone')}</p>
        )}
      </div>

      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder={t('person.docTitle')}
        className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400"
      />
      <div className="flex gap-2">
        <select
          value={docType}
          onChange={e => setDocType(e.target.value)}
          className="flex-1 bg-zinc-700 border border-zinc-600 rounded-lg px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-brand-400"
        >
          {docTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          {docTypes.length === 0 && builtinDocTypeOptions(t).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input
          type="number"
          value={year}
          onChange={e => setYear(e.target.value)}
          placeholder={t('person.docYear')}
          className="w-20 bg-zinc-700 border border-zinc-600 rounded-lg px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400"
        />
      </div>
      <div className="flex gap-2 pt-0.5">
        <button
          onClick={submit}
          disabled={!file || uploading}
          className="flex-1 py-1.5 bg-brand-500 hover:bg-brand-400 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors"
        >
          {uploading ? t('person.uploading') : t('person.upload')}
        </button>
        <button
          onClick={onDone}
          className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-700 rounded-lg transition-colors"
        >
          {t('person.cancel')}
        </button>
      </div>
    </div>
  )
}

// ── DocLinkExistingModal ──────────────────────────────────────────────────────

function DocLinkExistingModal({ personId, linkedDocIds, onClose }: {
  personId: number
  linkedDocIds: Set<number>
  onClose: () => void
}) {
  const t = useT()
  const qc = useQueryClient()
  const { data: allDocs = [] } = useQuery<PersonDocument[]>({ queryKey: ['docs-all'], queryFn: api.documents.listAll })
  const { data: types = [] }   = useQuery<DocumentType[]>({ queryKey: ['doc-types'], queryFn: api.documentTypes.list })
  const [search, setSearch] = useState('')
  const [linking, setLinking] = useState<number | null>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const typeMap = new Map(types.map(dt => [dt.key, dt.label]))
  const available = allDocs.filter(d => !linkedDocIds.has(d.id))
  const filtered = search
    ? available.filter(d => [d.title ? plainMentions(d.title) : null, d.filename, ...(d.persons.map(p => p.name))].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase()))
    : available
  const backdrop = useBackdropClose(onClose)

  async function link(docId: number) {
    setLinking(docId)
    try {
      await api.documents.linkPerson(docId, personId)
      qc.invalidateQueries({ queryKey: ['person-docs', personId] })
      qc.invalidateQueries({ queryKey: ['docs-all'] })
      onClose()
    } finally {
      setLinking(null)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" {...backdrop}>
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl w-[440px] max-w-[92vw] max-h-[70vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-zinc-800 shrink-0">
          <p className="text-sm font-semibold text-zinc-100">{t('person.linkExistingDoc')}</p>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M6 6l12 12M6 18L18 6"/></svg>
          </button>
        </div>
        <div className="px-4 py-2 border-b border-zinc-800 shrink-0">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('person.searchDocs')}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400" />
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/60">
          {filtered.length === 0 ? (
            <p className="px-4 py-4 text-xs text-zinc-600 italic">
              {available.length === 0 ? t('person.allLinked') : t('person.noDocs')}
            </p>
          ) : filtered.map(doc => (
            <button key={doc.id} onClick={() => link(doc.id)} disabled={linking === doc.id}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-800 transition-colors disabled:opacity-60">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-zinc-200 truncate">{plainMentions(doc.title || doc.filename)}</p>
                <p className="text-xs text-zinc-500">
                  {typeMap.get(doc.doc_type ?? '') ?? doc.doc_type ?? t('person.docFallback')}
                  {doc.year ? ` · ${doc.year}` : ''}
                </p>
                {doc.persons.length > 0 && (
                  <p className="text-xs text-zinc-600 truncate">{doc.persons.map(p => p.name).join(', ')}</p>
                )}
              </div>
              {linking === doc.id ? (
                <svg className="w-4 h-4 animate-spin text-brand-400 shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={3} strokeOpacity={0.3}/>
                  <path fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a10 10 0 100 10h-2A8 8 0 014 12z"/>
                </svg>
              ) : (
                <svg className="w-4 h-4 text-zinc-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"/>
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── DocPreviewModal ───────────────────────────────────────────────────────────

function DocPreviewModal({ doc, onClose }: { doc: PersonDocument; onClose: () => void }) {
  const t = useT()
  const url = api.documents.fileUrl(doc.id)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  const backdrop = useBackdropClose(onClose)

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/95" {...backdrop}>
      <button onClick={onClose}
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-zinc-800/80 hover:bg-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white text-lg transition-colors">
        ✕
      </button>
      {isImage(doc.mime_type) ? (
        <img src={url} alt={plainMentions(doc.title || doc.filename)}
          className="max-w-[85vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
          onClick={e => e.stopPropagation()} />
      ) : isPdf(doc.mime_type) ? (
        <iframe src={url} className="w-[85vw] h-[85vh] rounded-lg shadow-2xl border-0 bg-white"
          title={plainMentions(doc.title || doc.filename)} onClick={e => e.stopPropagation()} />
      ) : isAudio(doc.mime_type) ? (
        <div className="flex flex-col items-center gap-4 px-8" onClick={e => e.stopPropagation()}>
          <p className="text-zinc-300 text-sm font-medium">{plainMentions(doc.title || doc.filename)}</p>
          <audio controls src={url} className="w-[60vw] max-w-xl" />
        </div>
      ) : null}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-3">
        <span className="text-zinc-400 text-sm truncate max-w-xs">{plainMentions(doc.title || doc.filename)}</span>
        <a href={api.documents.fileUrl(doc.id, true)} onClick={e => e.stopPropagation()}
          className="text-xs text-zinc-500 hover:text-zinc-200 transition-colors underline underline-offset-2">
          {t('person.download')}
        </a>
      </div>
    </div>,
    document.body
  )
}

// ── DocRow ────────────────────────────────────────────────────────────────────

function DocRow({ doc, onUnlink, onNavToDocument }: { doc: PersonDocument; onUnlink: () => void; onNavToDocument?: (docId: number, editMode?: boolean) => void }) {
  const t = useT()
  const qc = useQueryClient()
  const { data: docTypes = [] } = useQuery<DocumentType[]>({ queryKey: ['doc-types'], queryFn: api.documentTypes.list })
  const [editing, setEditing] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [title, setTitle] = useState(doc.title ?? '')
  const [docType, setDocType] = useState(doc.doc_type ?? 'other')
  const [year, setYear] = useState(doc.year ? String(doc.year) : '')
  const [saving, setSaving] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [privacyBusy, setPrivacyBusy] = useState(false)
  const canPreview = isImage(doc.mime_type) || isPdf(doc.mime_type) || isAudio(doc.mime_type)

  async function togglePrivacy() {
    setPrivacyBusy(true)
    try {
      await api.documents.togglePrivacy(doc.id, !doc.is_private)
      qc.invalidateQueries({ queryKey: ['person-docs', doc.person_id] })
    } finally {
      setPrivacyBusy(false)
    }
  }

  async function promote() {
    setPromoting(true)
    try {
      await api.documents.promoteToSource(doc.id, doc.title || doc.filename)
      qc.invalidateQueries({ queryKey: ['person-docs', doc.person_id] })
      qc.invalidateQueries({ queryKey: ['sources'] })
    } finally {
      setPromoting(false)
    }
  }

  async function save() {
    setSaving(true)
    try {
      await api.documents.update(doc.id, {
        title: title.trim() || undefined,
        doc_type: docType,
        year: year ? parseInt(year) : undefined,
      })
      qc.invalidateQueries({ queryKey: ['person-docs', doc.person_id] })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const displayName = plainMentions(doc.title || doc.filename)
  const typeMap = new Map(docTypes.map(dt => [dt.key, dt.label]))
  const typeLabel = docTypeLabel(t, doc.doc_type, typeMap.get(doc.doc_type ?? ''))

  if (editing) {
    return (
      <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-2.5 space-y-2">
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={t('person.docTitle')}
          className="w-full bg-zinc-700 border border-zinc-600 rounded px-2.5 py-1 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400"
        />
        <div className="flex gap-1.5">
          <select
            value={docType}
            onChange={e => setDocType(e.target.value)}
            className="flex-1 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-brand-400"
          >
            {docTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            {docTypes.length === 0 && builtinDocTypeOptions(t).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input
            type="number"
            value={year}
            onChange={e => setYear(e.target.value)}
            placeholder={t('timeline.yearPh')}
            className="w-16 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400"
          />
        </div>
        <div className="flex gap-1.5">
          <button onClick={save} disabled={saving}
            className="px-3 py-1 text-xs font-medium bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-white rounded transition-colors">
            {saving ? '…' : t('person.save')}
          </button>
          <button onClick={() => setEditing(false)}
            className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-700 rounded transition-colors">
            {t('person.cancel')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      {previewing && <DocPreviewModal doc={doc} onClose={() => setPreviewing(false)} />}
      <div className="flex items-center gap-2.5 py-1.5 group">
        {isImage(doc.mime_type) ? (
          <button onClick={() => setPreviewing(true)} className="shrink-0 rounded overflow-hidden w-10 h-10 bg-zinc-800 border border-zinc-700">
            <img src={api.documents.fileUrl(doc.id)} alt="" className="w-10 h-10 object-cover" />
          </button>
        ) : isAudio(doc.mime_type) ? (
          <button onClick={() => setPreviewing(true)}
            className="shrink-0 w-10 h-10 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center">
            <DocIcon mime={doc.mime_type} />
          </button>
        ) : (
          <DocIcon mime={doc.mime_type} />
        )}
        <div className="flex-1 min-w-0">
          {onNavToDocument ? (
            <button onClick={() => onNavToDocument(doc.id)}
              className="text-xs text-zinc-200 hover:text-brand-300 truncate block leading-snug transition-colors text-left w-full">
              {displayName}
            </button>
          ) : canPreview ? (
            <button onClick={() => setPreviewing(true)}
              className="text-xs text-zinc-200 hover:text-brand-300 truncate block leading-snug transition-colors text-left w-full">
              {displayName}
            </button>
          ) : (
            <a href={api.documents.fileUrl(doc.id)} target="_blank" rel="noreferrer"
              className="text-xs text-zinc-200 hover:text-brand-300 truncate block leading-snug transition-colors">
              {displayName}
            </a>
          )}
          <div className="flex items-center gap-1.5">
            <p className="text-xs text-zinc-600 leading-snug">
              {[typeLabel, doc.year].filter(Boolean).join(' · ')}
            </p>
            {doc.source_id != null && (
              <span className="text-xs px-1 py-0.5 rounded bg-amber-900/40 text-amber-400 font-medium leading-none">
                Source
              </span>
            )}
          </div>
        </div>
        <button
          onClick={togglePrivacy}
          disabled={privacyBusy}
          title={doc.is_private ? t('person.privacyOn') : t('person.privacyOff')}
          className={`w-6 h-6 rounded flex items-center justify-center transition-colors disabled:opacity-50 shrink-0 ${doc.is_private ? 'text-amber-400 hover:bg-zinc-700' : 'text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-300 hover:bg-zinc-700'}`}
        >
          {doc.is_private ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="11" width="18" height="11" rx="2" /><path strokeLinecap="round" d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="11" width="18" height="11" rx="2" /><path strokeLinecap="round" d="M7 11V7a5 5 0 019.9-1" />
            </svg>
          )}
        </button>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {canPreview && (
            <button onClick={() => setPreviewing(true)} title={t('person.preview')}
              className="w-6 h-6 rounded flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                <circle cx="12" cy="12" r="3" strokeWidth={2} />
              </svg>
            </button>
          )}
          {doc.source_id == null && (
            <button onClick={promote} disabled={promoting} title={t('person.addToSourceLib')}
              className="w-6 h-6 rounded flex items-center justify-center text-zinc-500 hover:text-amber-400 hover:bg-zinc-700 transition-colors">
              {promoting ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={3} strokeOpacity={0.3} />
                  <path fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a10 10 0 100 10h-2A8 8 0 014 12z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
              )}
            </button>
          )}
          <a
            href={api.documents.fileUrl(doc.id, true)}
            title={t('person.download')}
            className="w-6 h-6 rounded flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </a>
          <button onClick={() => onNavToDocument ? onNavToDocument(doc.id, true) : setEditing(true)} title={t('person.editDocTitle')}
            className="w-6 h-6 rounded flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2.25 2.25 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2.414a2 2 0 01.586-1.414z" />
            </svg>
          </button>
          <button onClick={onUnlink} title={t('person.unlinkDocTitle')}
            className="w-6 h-6 rounded flex items-center justify-center text-zinc-600 hover:text-amber-400 hover:bg-zinc-700 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </>

  )
}

// ── CitationsInline ───────────────────────────────────────────────────────────

const SOURCE_TYPE_LABELS: Record<string, string> = {
  register: 'Register', census: 'Census', book: 'Book',
  audio: 'Audio', website: 'Website', oral: 'Oral history', other: 'Other',
}

const BookIcon = () => (
  <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
  </svg>
)

function CitationsInline({
  personId, fact, relationId, citations, sources, onMutated,
}: {
  personId: number
  fact: string
  /** Set for a fact the relation owns — a marriage — so both spouses see it. */
  relationId?: number
  citations: Citation[]
  sources: Source[]
  onMutated: () => void
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<Source | null>(null)
  const [pickTab, setPickTab] = useState<'source' | 'document'>('source')
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Any document can back a citation, not only the ones already promoted into
  // the source library — see `pickDocument` below. Only fetched once the
  // Documents tab is actually opened.
  const { data: allDocs = [] } = useQuery<PersonDocument[]>({
    queryKey: ['docs-all'],
    queryFn: api.documents.listAll,
    enabled: adding && pickTab === 'document',
    staleTime: 60_000,
  })

  function resetPicker() {
    setPicked(null); setSearch(''); setDetail(''); setErr(null); setPickTab('source')
  }

  /**
   * Promote a document to a source, then cite it. `promote-to-source` is
   * idempotent — a document already in the library yields the same source —
   * so this never creates a duplicate for a document cited twice.
   */
  async function pickDocument(d: PersonDocument) {
    setErr(null)
    try {
      setPicked(await api.documents.promoteToSource(d.id, d.title || d.filename))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to use document as a source')
    }
  }

  async function addCitation() {
    if (!picked) return
    setSaving(true); setErr(null)
    try {
      await api.citations.add(personId, {
        source_id: picked.id,
        fact,
        relation_id: relationId,
        detail: detail.trim() || undefined,
      })
      onMutated()
      setAdding(false)
      resetPicker()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to add citation')
    } finally {
      setSaving(false)
    }
  }

  const matchingSources = sources
    .filter(s => s.title.toLowerCase().includes(search.trim().toLowerCase()))
    .slice(0, 40)
  const matchingDocs = allDocs
    .filter(d => plainMentions(d.title || d.filename).toLowerCase().includes(search.trim().toLowerCase()))
    .slice(0, 40)

  async function removeCitation(id: number) {
    await api.citations.delete(id)
    onMutated()
  }

  const count = citations.length

  return (
    <div className="mt-1">
      {/* ── collapsed trigger ── */}
      {!expanded && (
        <button
          onClick={() => { setExpanded(true); if (count === 0) setAdding(true) }}
          className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5 border transition-colors ${
            count > 0
              ? 'border-amber-700/60 text-amber-400 bg-amber-900/20 hover:bg-amber-900/40'
              : 'border-zinc-700 text-zinc-500 bg-transparent hover:border-zinc-500 hover:text-zinc-300'
          }`}
        >
          <BookIcon />
          {count > 0 ? (count > 1 ? t('person.citeSrcCountPlural', { n: count }) : t('person.citeSrcCount', { n: count })) : t('person.citeSrc')}
        </button>
      )}

      {/* ── expanded panel ── */}
      {expanded && (
        <div className="mt-1 rounded-lg border border-zinc-700/60 bg-zinc-900/60 overflow-hidden">
          {/* header */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{t('person.sources')}</span>
            <button onClick={() => { setExpanded(false); setAdding(false) }}
              className="text-zinc-600 hover:text-zinc-300 transition-colors">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* citation list */}
          <div className="px-3 py-2 space-y-2">
            {citations.length === 0 && !adding && (
              <p className="text-xs text-zinc-600 italic">{t('person.noSources')}</p>
            )}
            {citations.map(c => (
              <div key={c.id} className="flex items-start gap-2 group/c">
                <div className="flex-1 min-w-0 space-y-0.5">
                  {/* source title — clickable if backed by a document */}
                  {c.source_document_id != null ? (
                    <a
                      href={api.documents.fileUrl(c.source_document_id)}
                      target="_blank" rel="noreferrer"
                      className="text-xs text-amber-300 hover:text-amber-200 font-medium leading-snug underline underline-offset-2 truncate block transition-colors"
                    >
                      {c.source_title}
                    </a>
                  ) : (
                    <p className="text-xs text-amber-300 font-medium leading-snug truncate">{c.source_title}</p>
                  )}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {c.source_type && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-500 border border-zinc-700">
                        {SOURCE_TYPE_LABELS[c.source_type] ?? c.source_type}
                      </span>
                    )}
                    {c.source_year && (
                      <span className="text-xs text-zinc-600">{c.source_year}</span>
                    )}
                    {c.source_author && (
                      <span className="text-xs text-zinc-600">{c.source_author}</span>
                    )}
                  </div>
                  {c.detail && (
                    <p className="text-xs text-zinc-500 leading-snug">
                      <span className="text-zinc-600">{t('person.sourcePagePrefix')} </span>{c.detail}
                    </p>
                  )}
                  {c.source_document_id != null && (
                    <a
                      href={api.documents.fileUrl(c.source_document_id)}
                      target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-300 transition-colors"
                    >
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                      {t('person.viewDocument')}
                    </a>
                  )}
                </div>
                <button onClick={() => removeCitation(c.id)} title={t('person.removeCitation')}
                  className="shrink-0 mt-0.5 opacity-0 group-hover/c:opacity-100 text-zinc-600 hover:text-red-400 transition-all">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}

            {/* add form */}
            {adding ? (
              <div className="space-y-1.5 pt-1 border-t border-zinc-800">
                {picked ? (
                  <div className="flex items-center gap-2 bg-zinc-800/70 border border-amber-700/40 rounded px-2 py-1">
                    <BookIcon />
                    <span className="text-xs text-amber-300 truncate flex-1">
                      {picked.title}{picked.year ? ` (${picked.year})` : ''}
                    </span>
                    <button onClick={() => setPicked(null)} title={t('person.changeSource')}
                      className="shrink-0 text-zinc-500 hover:text-zinc-200 transition-colors">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-1">
                      {(['source', 'document'] as const).map(k => (
                        <button key={k} onClick={() => { setPickTab(k); setSearch('') }}
                          className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
                            pickTab === k ? 'bg-amber-600/20 text-amber-400' : 'text-zinc-500 hover:text-zinc-300'
                          }`}>
                          {t(k === 'source' ? 'person.fromSources' : 'person.fromDocuments')}
                        </button>
                      ))}
                    </div>
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('docs.search')}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-amber-500" />
                    <div className="max-h-40 overflow-y-auto rounded border border-zinc-800">
                      {pickTab === 'source' ? (
                        matchingSources.length === 0 ? (
                          <p className="text-xs text-zinc-600 italic px-2 py-2">
                            {sources.length === 0 ? t('person.noSourcesLibHint') : t('docs.noResults')}
                          </p>
                        ) : matchingSources.map(s => (
                          <button key={s.id} onClick={() => setPicked(s)}
                            className="w-full text-left px-2 py-1.5 hover:bg-zinc-800 transition-colors">
                            <p className="text-xs text-zinc-100 truncate">{s.title}</p>
                            <p className="text-xs text-zinc-500 truncate">
                              {[s.source_type, s.year, s.author].filter(Boolean).join(' · ')}
                            </p>
                          </button>
                        ))
                      ) : (
                        matchingDocs.length === 0 ? (
                          <p className="text-xs text-zinc-600 italic px-2 py-2">{t('docs.noResults')}</p>
                        ) : matchingDocs.map(d => (
                          <button key={d.id} onClick={() => pickDocument(d)}
                            className="w-full text-left px-2 py-1.5 hover:bg-zinc-800 transition-colors">
                            <p className="text-xs text-zinc-100 truncate">{plainMentions(d.title || d.filename)}</p>
                            <p className="text-xs text-zinc-500 truncate">
                              {[docTypeLabel(t, d.doc_type, undefined), d.year].filter(Boolean).join(' · ')}
                            </p>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
                <input value={detail} onChange={e => setDetail(e.target.value)}
                  placeholder={t('person.citationPh')}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-amber-500" />
                {err && <p className="text-xs text-red-400">{err}</p>}
                <div className="flex gap-1.5">
                  <button onClick={addCitation} disabled={saving || !picked}
                    className="px-2.5 py-1 text-xs font-medium bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded transition-colors">
                    {saving ? '…' : t('person.save')}
                  </button>
                  <button onClick={() => { setAdding(false); resetPicker(); if (count === 0) setExpanded(false) }}
                    className="px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                    {t('person.cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAdding(true)}
                className="text-xs text-zinc-500 hover:text-amber-400 transition-colors pt-0.5">
                {t('person.addCitation')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── PersonPanel ───────────────────────────────────────────────────────────────

interface Props {
  person: PersonFull
  persons: PersonFull[]
  relations: Relation[]
  onClose: () => void
  onNavigateTo: (id: number) => void
  onNavToEvent?: (eventId: number) => void
  onNavToDocument?: (docId: number, editMode?: boolean) => void
  onDeleted?: () => void
}

// blank details state derived from a person
function detailsFromPerson(p: PersonFull) {
  return {
    birth_date: p.birth_date ?? (p.birth_year ? String(p.birth_year) : ''),
    birth_place: p.birth_place ?? '',
    death_date: p.death_date ?? (p.death_year ? String(p.death_year) : ''),
    death_place: p.death_place ?? '',
    sex: (p.sex ?? '') as '' | 'M' | 'F',
    occupation: p.occupation ?? '',
    religion: p.religion ?? '',
    nationality: p.nationality ?? '',
    cause_of_death: p.cause_of_death ?? '',
    education: p.education ?? '',
    christening_date: p.christening_date ?? (p.christening_year ? String(p.christening_year) : ''),
    christening_place: p.christening_place ?? '',
    burial_date: p.burial_date ?? (p.burial_year ? String(p.burial_year) : ''),
    burial_place: p.burial_place ?? '',
  }
}

export default function PersonPanel({ person, persons, relations, onClose, onNavigateTo, onNavToEvent, onNavToDocument, onDeleted }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const { nameOrder } = useSettings()
  const dateLocale = useDateLocale()
  const [visible, setVisible] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [mergePickerOpen, setMergePickerOpen] = useState(false)
  const [mergePending, setMergePending] = useState<PersonFull | null>(null)
  const [merging, setMerging] = useState(false)
  const [relatePickerOpen, setRelatePickerOpen] = useState(false)
  const [relatePerson, setRelatePerson] = useState<PersonFull | null>(null)
  const [relWarning, setRelWarning] = useState<string | null>(null)

  // header editing
  const [editingHeader, setEditingHeader] = useState(false)
  const [headerData, setHeaderData] = useState({ nameParts: { title: '', last_name: '', first_name: '', middle_name: '', nickname: '' } as NameParts })

  // details section
  const [editingDetails, setEditingDetails] = useState(false)
  const [detailsData, setDetailsData] = useState(detailsFromPerson(person))

  // notes
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesVal, setNotesVal] = useState('')

  // relations
  const [editingRelations, setEditingRelations] = useState(false)
  const [pickerMode, setPickerMode] = useState<PickerMode>(null)
  // Whose child, besides this person's — chosen in the picker, applied as a
  // second `parent` relation. null means "not from a spouse / unknown".
  const [childCoParentId, setChildCoParentId] = useState<number | null>(null)
  const [expandedRelId, setExpandedRelId] = useState<number | null>(null)
  const [marriageEdits, setMarriageEdits] = useState<Record<number, { marriage_year: string; marriage_place: string; divorce_year: string; divorce_place: string }>>({})

  // photos
  const [showAllPhotos, setShowAllPhotos] = useState(false)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  // cluster linking
  const [showClusterPicker, setShowClusterPicker] = useState(false)
  const [clusterSearch, setClusterSearch] = useState('')
  const [clusterLinking, setClusterLinking] = useState(false)

  // tab
  const [activeTab, setActiveTab] = useState<'bio' | 'events' | 'documents' | 'notes'>('bio')
  const [autoPhotoEventType, setAutoPhotoEventType] = useState<string | null>(null)

  // documents
  const [showUploadForm, setShowUploadForm] = useState(false)
  const [showLinkForm, setShowLinkForm] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // Reset details and tab when person changes
  useEffect(() => {
    setDetailsData(detailsFromPerson(person))
    setActiveTab('bio')
    setRelWarning(null)
  }, [person.id])

  const { data: imagesPage, isLoading: loadingImgs } = useQuery({
    queryKey: ['person-images', person.id],
    queryFn: () => api.images.list(1, 60, 'all', '', 'exif_date_desc', [person.id]),
    staleTime: 60_000,
  })

  const { data: docs = [], isLoading: loadingDocs } = useQuery({
    queryKey: ['person-docs', person.id],
    queryFn: () => api.documents.list(person.id),
    staleTime: 30_000,
  })

  const { data: citations = [] } = useQuery({
    queryKey: ['person-citations', person.id],
    queryFn: () => api.citations.listForPerson(person.id),
    staleTime: 30_000,
  })

  const { data: personNotes = [], refetch: refetchNotes } = useQuery({
    queryKey: ['person-notes', person.id],
    queryFn: () => api.notes.list(person.id),
    staleTime: 30_000,
  })

  const [creatingNote, setCreatingNote] = useState(false)
  const [newNoteShell, setNewNoteShell] = useState<import('../types').PersonNote | null>(null)

  async function startNewNote() {
    const shell = await api.notes.create(person.id, { content: '', sort_order: personNotes.length })
    setNewNoteShell(shell)
    setCreatingNote(true)
  }

  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.sources.list(),
    staleTime: 60_000,
  })

  function citationsFor(fact: string) {
    return citations.filter(c => c.fact === fact && c.relation_id == null)
  }

  /** Sources for one marriage — the same list on either spouse's panel. */
  function marriageCitations(relId: number) {
    return citations.filter(c => c.relation_id === relId)
  }

  function invalidateCitations() {
    qc.invalidateQueries({ queryKey: ['person-citations', person.id] })
  }

  const { data: unlinkedClusters = [] } = useQuery<LinkedCluster[]>({
    queryKey: ['clusters-unlinked'],
    queryFn: api.cluster.unlinked,
    enabled: showClusterPicker,
    staleTime: 30_000,
  })

  async function handleLinkCluster(c: LinkedCluster) {
    if (clusterLinking) return
    setClusterLinking(true)
    try {
      await api.cluster.linkPerson(c.id, person.id)
      qc.invalidateQueries({ queryKey: ['persons'] })
      qc.invalidateQueries({ queryKey: ['clusters'] })
      qc.invalidateQueries({ queryKey: ['clusters-unlinked'] })
      qc.invalidateQueries({ queryKey: ['person-images', person.id] })
      setShowClusterPicker(false)
      setClusterSearch('')
    } finally {
      setClusterLinking(false)
    }
  }

  async function handleUnlinkCluster(clusterId: number) {
    await api.cluster.linkPerson(clusterId, null)
    qc.invalidateQueries({ queryKey: ['persons'] })
    qc.invalidateQueries({ queryKey: ['clusters'] })
    qc.invalidateQueries({ queryKey: ['clusters-unlinked'] })
    qc.invalidateQueries({ queryKey: ['person-images', person.id] })
  }

  const saveMut = useMutation({
    mutationFn: (patch: Parameters<typeof api.persons.update>[1]) => api.persons.update(person.id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] })
      // A place or a vocabulary value typed here is a suggestion everywhere
      // else the moment it is saved — without these it only shows up after a
      // reload.
      qc.invalidateQueries({ queryKey: ['places'] })
      qc.invalidateQueries({ queryKey: ['field-values'] })
      setEditingHeader(false)
      setEditingDetails(false)
      setEditingNotes(false)
    },
  })

  const addRelMut = useMutation({
    mutationFn: ({ type, a, b }: { type: 'parent' | 'spouse' | 'sibling'; a: number; b: number }) =>
      api.relations.create(type, a, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['relations'] }),
  })

  // A child is two relations, not one: this person's, and — when a co-parent was
  // chosen — the spouse's. Adding both here is the whole point of the choice;
  // otherwise the user has to open the spouse's panel and add the same child again.
  const addChildMut = useMutation({
    mutationFn: async ({ childId, coParentId }: { childId: number; coParentId: number | null }) => {
      await api.relations.create('parent', person.id, childId)
      if (coParentId != null) await api.relations.create('parent', coParentId, childId)
    },
    // Two writes, so a failure can land between them: refresh either way and say
    // so, rather than leaving the second parent silently unwritten.
    onError: (e: unknown) => setRelWarning(String(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['relations'] }),
  })

  const delRelMut = useMutation({
    mutationFn: (id: number) => api.relations.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['relations'] }),
  })

  const updateRelMut = useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Parameters<typeof api.relations.update>[1] }) =>
      api.relations.update(id, fields),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['relations'] })
      qc.invalidateQueries({ queryKey: ['places'] })
      setExpandedRelId(null)
    },
  })

  // The X on a document row detaches the document from *this* person — it never
  // deletes it. The document stays in the project, keeps its other person links
  // and its files; deleting one for good is a Documents-tab action.
  const unlinkDocMut = useMutation({
    mutationFn: (id: number) => api.documents.unlinkPerson(id, person.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['person-docs', person.id] })
      qc.invalidateQueries({ queryKey: ['docs-all'] })
    },
  })

  const byId = new Map(persons.map(p => [p.id, p]))

  const birthYear = (p: PersonFull) =>
    p.birth_date ? parseInt(p.birth_date) : (p.birth_year ?? 9999)

  const parents = relations
    .filter(r => r.type === 'parent' && r.person_b_id === person.id)
    .map(r => byId.get(r.person_a_id)).filter(Boolean) as PersonFull[]
  const children = (relations
    .filter(r => r.type === 'parent' && r.person_a_id === person.id)
    .map(r => byId.get(r.person_b_id)).filter(Boolean) as PersonFull[])
    .sort((a, b) => birthYear(a) - birthYear(b))
  const spouseRelations = (relations
    .filter(r => r.type === 'spouse' && (r.person_a_id === person.id || r.person_b_id === person.id))
    .map(r => ({ rel: r, p: byId.get(r.person_a_id === person.id ? r.person_b_id : r.person_a_id) }))
    .filter(x => x.p != null) as { rel: Relation; p: PersonFull }[])
    .sort((a, b) => (a.rel.marriage_year ?? birthYear(a.p) + 20) - (b.rel.marriage_year ?? birthYear(b.p) + 20))
  const siblings = (relations
    .filter(r => r.type === 'sibling' && (r.person_a_id === person.id || r.person_b_id === person.id))
    .map(r => byId.get(r.person_a_id === person.id ? r.person_b_id : r.person_a_id))
    .filter(Boolean) as PersonFull[])
    .sort((a, b) => birthYear(a) - birthYear(b))

  // The couple a child belongs to is not stored anywhere of its own — it is the
  // child's *other* `parent` row, read back out here. Undefined co-parent is a
  // real state (a partner nobody recorded), not missing data.
  const coParentOfChild = new Map<number, number | null>()
  for (const c of children) coParentOfChild.set(c.id, null)
  for (const r of relations) {
    if (r.type !== 'parent' || r.person_a_id === person.id) continue
    if (coParentOfChild.has(r.person_b_id)) coParentOfChild.set(r.person_b_id, r.person_a_id)
  }

  // Headings only earn their space once the children do not all share one
  // co-parent; with a single family they would repeat on every row.
  const childGroups = (() => {
    const keys = new Set(children.map(c => coParentOfChild.get(c.id) ?? 0))
    if (keys.size < 2) return undefined
    const spouseIds = spouseRelations.map(x => x.p.id)
    const order = [
      ...spouseIds,
      ...[...keys].filter(k => k !== 0 && !spouseIds.includes(k)),   // a co-parent who is not (or no longer) a spouse
    ]
    const groups: { key: string; label: string; persons: PersonFull[] }[] = []
    for (const id of order) {
      const list = children.filter(c => coParentOfChild.get(c.id) === id)
      if (list.length === 0) continue
      const co = byId.get(id)
      groups.push({
        key: String(id),
        label: t('person.otherParentIs', { name: co ? displayPersonName(co, nameOrder) : '?' }),
        persons: list,
      })
    }
    const orphans = children.filter(c => coParentOfChild.get(c.id) == null)
    if (orphans.length > 0) groups.push({ key: 'none', label: t('person.otherParentUnknown'), persons: orphans })
    return groups
  })()

  const allRelatedIds = new Set([
    person.id,
    ...parents.map(p => p.id),
    ...children.map(p => p.id),
    ...spouseRelations.map(x => x.p.id),
    ...siblings.map(p => p.id),
  ])

  function findRelationId(type: 'parent' | 'spouse' | 'sibling', otherPersonId: number): number | null {
    for (const r of relations) {
      if (r.type !== type) continue
      if ((r.person_a_id === person.id && r.person_b_id === otherPersonId) ||
          (r.person_a_id === otherPersonId && r.person_b_id === person.id)) return r.id
    }
    return null
  }

  function handleAdd(p: PersonFull) {
    if (!pickerMode) return

    const exists = (type: 'parent' | 'spouse' | 'sibling', aId: number, bId: number) =>
      relations.some(r => r.type === type &&
        ((r.person_a_id === aId && r.person_b_id === bId) ||
         (r.person_a_id === bId && r.person_b_id === aId)))

    const warn = (msg: string) => { setPickerMode(null); setRelWarning(msg) }

    switch (pickerMode) {
      case 'parent':
        if (exists('parent', p.id, person.id)) { warn(t('person.alreadyListed', { name: displayPersonName(p, nameOrder) })); return }
        addRelMut.mutate({ type: 'parent',  a: p.id,      b: person.id }); break
      case 'child': {
        if (exists('parent', person.id, p.id)) { warn(t('person.alreadyListed', { name: displayPersonName(p, nameOrder) })); return }
        // A child carries at most two parents (the server refuses a third), so
        // the co-parent only goes in when the slot beside this person is free.
        const childParentIds = relations
          .filter(r => r.type === 'parent' && r.person_b_id === p.id)
          .map(r => r.person_a_id)
        if (childParentIds.length >= 2) { warn(t('person.childHasTwoParents', { name: displayPersonName(p, nameOrder) })); return }
        const co = childCoParentId
        const coFits = co != null && (childParentIds.length === 0 || childParentIds.includes(co))
        addChildMut.mutate({ childId: p.id, coParentId: coFits ? co : null })
        if (co != null && !coFits) {
          const other = byId.get(childParentIds[0])
          setRelWarning(t('person.coParentSkipped', {
            child: displayPersonName(p, nameOrder),
            parent: other ? displayPersonName(other, nameOrder) : '?',
          }))
        }
        break
      }
      case 'spouse':
        if (exists('spouse', person.id, p.id)) { warn(t('person.alreadyListed', { name: displayPersonName(p, nameOrder) })); return }
        addRelMut.mutate({ type: 'spouse',  a: person.id, b: p.id });      break
      case 'sibling':
        if (exists('sibling', person.id, p.id)) { warn(t('person.alreadyListed', { name: displayPersonName(p, nameOrder) })); return }
        addRelMut.mutate({ type: 'sibling', a: person.id, b: p.id });      break
    }
  }

  function handleRemove(type: 'parent' | 'spouse' | 'sibling', other: PersonFull) {
    const rid = findRelationId(type, other.id)
    if (rid != null) delRelMut.mutate(rid)
  }

  async function handleToggleRelPrivacy(relId: number, isPrivate: boolean) {
    await api.relations.togglePrivacy(relId, isPrivate)
    qc.invalidateQueries({ queryKey: ['relations'] })
  }

  const parentRelPrivacy = new Map(
    relations.filter(r => r.type === 'parent' && r.person_b_id === person.id)
      .map(r => [r.person_a_id, { relId: r.id, isPrivate: r.is_private }])
  )
  const childRelPrivacy = new Map(
    relations.filter(r => r.type === 'parent' && r.person_a_id === person.id)
      .map(r => [r.person_b_id, { relId: r.id, isPrivate: r.is_private }])
  )
  const siblingRelPrivacy = new Map(
    relations
      .filter(r => r.type === 'sibling' && (r.person_a_id === person.id || r.person_b_id === person.id))
      .map(r => [r.person_a_id === person.id ? r.person_b_id : r.person_a_id, { relId: r.id, isPrivate: r.is_private }])
  )

  async function handleDeletePerson() {
    if (deleting) return
    setDeleting(true)
    try {
      await api.persons.delete(person.id)
      qc.invalidateQueries({ queryKey: ['persons'] })
      qc.invalidateQueries({ queryKey: ['relations'] })
      onDeleted?.()
      onClose()
    } catch (e) {
      setDeleting(false)
      setConfirmDelete(false)
      alert(String(e))
    }
  }

  async function handleMergePerson() {
    if (!mergePending || merging) return
    setMerging(true)
    try {
      const surviving = await api.persons.mergeInto(mergePending.id, person.id)
      qc.invalidateQueries({ queryKey: ['persons'] })
      qc.invalidateQueries({ queryKey: ['relations'] })
      qc.invalidateQueries({ queryKey: ['events'] })
      setMergePending(null)
      onClose()
      onNavigateTo(surviving.id)
    } catch (e) {
      setMerging(false)
      alert(String(e))
    }
  }

  function startHeaderEdit() {
    setHeaderData({ nameParts: namePartsFromPerson(person) })
    setEditingHeader(true)
  }

  function saveHeader() {
    const { nameParts } = headerData
    saveMut.mutate({
      title: nameParts.title.trim() || null,
      last_name: nameParts.last_name.trim() || null,
      first_name: nameParts.first_name.trim() || null,
      middle_name: nameParts.middle_name.trim() || null,
      nickname: nameParts.nickname.trim() || null,
    })
  }

  function saveDetails() {
    saveMut.mutate({
      birth_date: detailsData.birth_date || null,
      birth_place: detailsData.birth_place.trim() || null,
      death_date: detailsData.death_date || null,
      death_place: detailsData.death_place.trim() || null,
      sex: (detailsData.sex || null) as 'M' | 'F' | null,
      occupation: detailsData.occupation.trim() || null,
      religion: detailsData.religion.trim() || null,
      nationality: detailsData.nationality.trim() || null,
      cause_of_death: detailsData.cause_of_death.trim() || null,
      education: detailsData.education.trim() || null,
      christening_date: detailsData.christening_date || null,
      christening_place: detailsData.christening_place.trim() || null,
      burial_date: detailsData.burial_date || null,
      burial_place: detailsData.burial_place.trim() || null,
    })
  }

  function saveMarriage(relId: number) {
    const e = marriageEdits[relId]
    if (!e) return
    updateRelMut.mutate({
      id: relId,
      fields: {
        marriage_year: e.marriage_year ? parseInt(e.marriage_year) : null,
        marriage_place: e.marriage_place.trim() || null,
        divorce_year: e.divorce_year ? parseInt(e.divorce_year) : null,
        divorce_place: e.divorce_place.trim() || null,
      },
    })
  }

  function openMarriage(rel: Relation) {
    if (expandedRelId === rel.id) { setExpandedRelId(null); return }
    setMarriageEdits(prev => ({
      ...prev,
      [rel.id]: {
        marriage_year: rel.marriage_year ? String(rel.marriage_year) : '',
        marriage_place: rel.marriage_place ?? '',
        divorce_year: rel.divorce_year ? String(rel.divorce_year) : '',
        divorce_place: rel.divorce_place ?? '',
      },
    }))
    setExpandedRelId(rel.id)
  }

  const span = lifespan(person, dateLocale)
  const ageInfo = calcAge(person)

  // Header action strip: relate + merge + [delete] + close, w-8 each with gap-1.5,
  // offset right-3. The title block pads against this so long names wrap instead
  // of sliding underneath the icons.
  const canDeletePerson = person.clusters.length === 0
  const headerBtnCount  = canDeletePerson ? 4 : 3
  const HEADER_ACTIONS_W = headerBtnCount * 32 + (headerBtnCount - 1) * 6 + 12 + 8
  const images = imagesPage?.items ?? []
  const visibleImages = showAllPhotos ? images : images.slice(0, PHOTOS_CAP)

  // Details section visibility
  const hasDetails = !!(
    person.birth_date || person.birth_year || person.birth_place ||
    person.death_date || person.death_year || person.death_place ||
    person.sex || person.occupation || person.religion || person.nationality ||
    person.cause_of_death || person.education ||
    person.christening_date || person.christening_place ||
    person.burial_date || person.burial_place
  )

  const pickerLabels: Record<NonNullable<PickerMode>, string> = {
    parent: t('person.addParentLabel'), child: t('person.addChildLabel'), spouse: t('person.addSpouseLabel'), sibling: t('person.addSiblingLabel'),
  }

  const SEX_LABEL: Record<string, string> = { M: t('person.sexMale'), F: t('person.sexFemale') }
  const backdrop = useBackdropClose(onClose)

  return (
    <>
      <div className="absolute inset-0 transition-opacity duration-300"
        style={{ background: 'rgba(0,0,0,0.5)', opacity: visible ? 1 : 0 }}
        {...backdrop} />

      <div
        className="absolute right-0 top-0 bottom-0 flex flex-col bg-zinc-900 shadow-2xl transition-transform duration-300 ease-out overflow-hidden"
        style={{ width: 440, borderLeft: '1px solid rgba(63,63,70,0.6)', transform: visible ? 'translateX(0)' : 'translateX(100%)' }}
        onClick={e => e.stopPropagation()}
      >
        {/*
          One flex strip instead of four independently positioned buttons: keeps the
          row gapless when the conditional delete button is absent, and gives the
          header a single known width to pad against (see HEADER_ACTIONS_W).
        */}
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5">
          {/* Find relation */}
          <button onClick={() => setRelatePickerOpen(true)} title={t('person.findPath')}
            className="w-8 h-8 rounded-full bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center text-zinc-400 hover:text-white transition-colors shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="5" cy="12" r="2" />
              <circle cx="19" cy="5" r="2" />
              <circle cx="19" cy="19" r="2" />
              <path strokeLinecap="round" d="M7 12h4l3-5m-3 5l3 5" />
            </svg>
          </button>

          {/* Merge — always visible (useful even with clusters) */}
          <button onClick={() => setMergePickerOpen(true)} title={t('person.mergeWith')}
            className="w-8 h-8 rounded-full bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center text-zinc-400 hover:text-white transition-colors shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </button>

          {canDeletePerson && (
            <button onClick={() => setConfirmDelete(true)} title={t('person.deletePerson')}
              className="w-8 h-8 rounded-full bg-zinc-700 hover:bg-red-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}

          <button onClick={onClose} title={t('person.close')}
            className="w-8 h-8 rounded-full bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center text-zinc-300 hover:text-white transition-colors text-sm shrink-0">✕</button>
        </div>

        {confirmDelete && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 rounded-none">
            <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-5 shadow-2xl w-64 text-center">
              <p className="text-zinc-100 font-medium mb-1 text-sm">{t('person.deleteConfirmTitle')}</p>
              <p className="text-zinc-400 text-xs mb-4 leading-relaxed">{t('person.deleteConfirmBody', { name: displayPersonName(person, nameOrder) })}</p>
              <div className="flex gap-2 justify-center">
                <button onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1.5 rounded-lg bg-zinc-700 text-zinc-300 text-xs hover:bg-zinc-600 transition-colors">
                  {t('person.cancel')}
                </button>
                <button onClick={handleDeletePerson} disabled={deleting}
                  className="px-3 py-1.5 rounded-lg bg-red-700 text-white text-xs hover:bg-red-600 transition-colors disabled:opacity-50">
                  {deleting ? t('person.deleting') : t('person.delete')}
                </button>
              </div>
            </div>
          </div>
        )}

        {mergePending && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 rounded-none">
            <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-5 shadow-2xl w-72 text-center">
              <p className="text-zinc-100 font-medium mb-1 text-sm">{t('person.mergeConfirmTitle')}</p>
              <p className="text-zinc-400 text-xs mb-1 leading-relaxed">
                {t('person.mergeConfirmBody', { nameA: displayPersonName(mergePending, nameOrder), nameB: displayPersonName(person, nameOrder) })}
              </p>
              <p className="text-zinc-600 text-xs mb-4 leading-relaxed">
                {t('person.mergeConfirmNote', { name: displayPersonName(person, nameOrder) })}
              </p>
              <div className="flex gap-2 justify-center">
                <button onClick={() => setMergePending(null)}
                  className="px-3 py-1.5 rounded-lg bg-zinc-700 text-zinc-300 text-xs hover:bg-zinc-600 transition-colors">
                  {t('person.cancel')}
                </button>
                <button onClick={handleMergePerson} disabled={merging}
                  className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs hover:bg-brand-500 transition-colors disabled:opacity-50">
                  {merging ? t('person.merging') : t('person.merge')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Header ── */}
        <div className="shrink-0 px-5 pt-5 pb-4 border-b border-zinc-800">
          <div className="flex gap-4 items-start">
            <Avatar person={person} size={72} />
            <div className="flex-1 min-w-0 pt-0.5">
              {editingHeader ? (
                <div className="mb-2">
                  <NameEditor
                    autoFocus
                    value={headerData.nameParts}
                    onChange={nameParts => setHeaderData(d => ({ ...d, nameParts }))}
                  />
                </div>
              ) : (
                <h2
                  className="text-lg font-bold text-zinc-100 leading-snug break-words"
                  title={displayPersonName(person, nameOrder)}
                >
                  {/*
                    Floated spacer reserves only the band the action strip actually
                    covers (its lower edge sits ~24px into the h2), so a long name
                    wraps under the icons and keeps full width from line 2 on.
                  */}
                  <span aria-hidden className="float-right" style={{ width: HEADER_ACTIONS_W - 20, height: 26 }} />
                  {displayPersonName(person, nameOrder)}
                  {person.sex && <span className="ml-1.5 text-sm font-normal text-zinc-500">{person.sex === 'M' ? '♂' : '♀'}</span>}
                </h2>
              )}
              {!editingHeader && person.nickname && (
                <p className="text-sm text-zinc-500 mt-0.5">„{person.nickname}"</p>
              )}
              {!editingHeader && (
                <div className="mt-1 space-y-0.5">
                  {span && <p className="text-xs text-zinc-400">{span}</p>}
                  {ageInfo && (
                    <p className="text-xs text-zinc-500">
                      {ageInfo.alive
                        ? t('person.ageTodayDisplay', { n: ageInfo.age })
                        : t('person.ageLived', { n: ageInfo.age })}
                    </p>
                  )}
                  <p className="text-xs text-zinc-600">{person.face_count > 0 ? t('person.photosInApp', { n: person.face_count }) : t('person.noPhotos')}</p>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2 mt-3 ml-[88px]">
            {editingHeader ? (
              <>
                <button onClick={saveHeader} disabled={saveMut.isPending}
                  className="px-3 py-1 text-xs font-medium bg-brand-500 hover:bg-brand-600 text-white rounded-lg transition-colors">{t('person.save')}</button>
                <button onClick={() => setEditingHeader(false)}
                  className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 rounded-lg transition-colors">{t('person.cancel')}</button>
              </>
            ) : (
              <button onClick={startHeaderEdit}
                className="px-3 py-1 text-xs text-zinc-500 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors">{t('person.edit')}</button>
            )}
          </div>
        </div>

        {/* ── Tab bar ── */}
        <div className="shrink-0 flex border-b border-zinc-800">
          {(['bio', 'events', 'documents', 'notes'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-xs font-medium transition-colors capitalize ${
                activeTab === tab
                  ? 'text-zinc-100 border-b-2 border-brand-400 -mb-px'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab === 'bio' ? t('person.tabBio') : tab === 'events' ? t('person.tabEvents') : tab === 'documents' ? (docs.length > 0 ? t('person.tabDocsN', { n: docs.length }) : t('person.tabDocs')) : (personNotes.length > 0 ? t('person.tabNotesN', { n: personNotes.length }) : t('person.tabNotes'))}
            </button>
          ))}
        </div>

        {/* ── Scroll body ── */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Bio tab ── */}
          {activeTab === 'bio' && <>

          {/* Details */}
          <section className="px-5 py-4 border-b border-zinc-800/80">
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{t('person.details')}</h3>
              {!editingDetails ? (
                <button onClick={() => { setDetailsData(detailsFromPerson(person)); setEditingDetails(true) }}
                  className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors">
                  {hasDetails ? t('person.edit') : t('person.add')}
                </button>
              ) : (
                <div className="flex gap-3">
                  <button onClick={saveDetails} disabled={saveMut.isPending}
                    className="text-xs text-brand-400 hover:text-brand-300 font-medium transition-colors">{t('person.save')}</button>
                  <button onClick={() => setEditingDetails(false)}
                    className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">{t('person.cancel')}</button>
                </div>
              )}
            </div>

            {editingDetails ? (
              <div className="space-y-2">
                {/* Birth */}
                <div>
                  <span className="text-xs text-zinc-500 block mb-1">{t('person.birth')}</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <DatePartPicker value={detailsData.birth_date} onChange={v => setDetailsData(d => ({ ...d, birth_date: v }))} />
                    <PlaceInput value={detailsData.birth_place} onChange={v => setDetailsData(d => ({ ...d, birth_place: v }))}
                      placeholder={t('person.place')}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400" />
                  </div>
                  <CitationsInline personId={person.id} fact="birth" citations={citationsFor('birth')} sources={sources} onMutated={invalidateCitations} />
                </div>
                {/* Death */}
                <div>
                  <span className="text-xs text-zinc-500 block mb-1">{t('person.death')}</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <DatePartPicker value={detailsData.death_date} onChange={v => setDetailsData(d => ({ ...d, death_date: v }))} />
                    <PlaceInput value={detailsData.death_place} onChange={v => setDetailsData(d => ({ ...d, death_place: v }))}
                      placeholder={t('person.place')}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400" />
                  </div>
                  <CitationsInline personId={person.id} fact="death" citations={citationsFor('death')} sources={sources} onMutated={invalidateCitations} />
                </div>
                {/* Sex */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 w-20 shrink-0">{t('person.sex')}</span>
                  <div className="flex gap-1">
                    {(['', 'M', 'F'] as const).map(v => (
                      <button key={v} onClick={() => setDetailsData(d => ({ ...d, sex: v }))}
                        className={`px-2.5 py-0.5 rounded text-xs transition-colors ${detailsData.sex === v ? 'bg-brand-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
                        {v === '' ? '—' : v === 'M' ? t('person.sexMale') : t('person.sexFemale')}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Occupation */}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 w-20 shrink-0">{t('person.occupation')}</span>
                    <VocabInput field="occupation" value={detailsData.occupation} onChange={v => setDetailsData(d => ({ ...d, occupation: v }))}
                      placeholder={t('person.occupationPh')}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400" />
                  </div>
                  <CitationsInline personId={person.id} fact="occupation" citations={citationsFor('occupation')} sources={sources} onMutated={invalidateCitations} />
                </div>
                {/* Education */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 w-20 shrink-0">{t('person.education')}</span>
                  <VocabInput field="education" value={detailsData.education} onChange={v => setDetailsData(d => ({ ...d, education: v }))}
                    placeholder={t('person.educationPh')}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400" />
                </div>
                {/* Religion */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 w-20 shrink-0">{t('person.religion')}</span>
                  <VocabInput field="religion" value={detailsData.religion} onChange={v => setDetailsData(d => ({ ...d, religion: v }))}
                    placeholder={t('person.religionPh')}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400" />
                </div>
                {/* Nationality */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 w-20 shrink-0">{t('person.nationality')}</span>
                  <VocabInput field="nationality" value={detailsData.nationality} onChange={v => setDetailsData(d => ({ ...d, nationality: v }))}
                    placeholder={t('person.nationalityPh')}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400" />
                </div>
                {/* Cause of death */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 w-20 shrink-0">{t('person.causeOfDeath')}</span>
                  <VocabInput field="cause_of_death" value={detailsData.cause_of_death} onChange={v => setDetailsData(d => ({ ...d, cause_of_death: v }))}
                    placeholder={t('person.causeOfDeathPh')}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400" />
                </div>
                {/* Christening */}
                <div>
                  <span className="text-xs text-zinc-500 block mb-1">{t('person.christening')}</span>
                  <div className="flex items-center gap-1.5 flex-wrap pl-0">
                    <DatePartPicker value={detailsData.christening_date} onChange={v => setDetailsData(d => ({ ...d, christening_date: v }))} />
                    <PlaceInput value={detailsData.christening_place} onChange={v => setDetailsData(d => ({ ...d, christening_place: v }))}
                      placeholder={t('person.place')}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400" />
                  </div>
                  <CitationsInline personId={person.id} fact="christening" citations={citationsFor('christening')} sources={sources} onMutated={invalidateCitations} />
                </div>
                {/* Burial */}
                <div>
                  <span className="text-xs text-zinc-500 block mb-1">{t('person.burial')}</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <DatePartPicker value={detailsData.burial_date} onChange={v => setDetailsData(d => ({ ...d, burial_date: v }))} />
                    <PlaceInput value={detailsData.burial_place} onChange={v => setDetailsData(d => ({ ...d, burial_place: v }))}
                      placeholder={t('person.place')}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400" />
                  </div>
                  <CitationsInline personId={person.id} fact="burial" citations={citationsFor('burial')} sources={sources} onMutated={invalidateCitations} />
                </div>
              </div>
            ) : hasDetails ? (
              <div className="space-y-1.5">
                {(person.birth_date || person.birth_year || person.birth_place) && (
                  <div>
                    <div className="flex gap-2 text-xs items-center">
                      <span className="text-zinc-500 w-20 shrink-0">{t('person.birth')}</span>
                      <span className="text-zinc-300 flex-1">{[formatDate(person.birth_date, person.birth_year, dateLocale), person.birth_place].filter(Boolean).join(', ')}</span>
                      <button onClick={() => { setAutoPhotoEventType('birth'); setActiveTab('events') }} title={t('person.attachPhotoBirth')}
                        className="text-zinc-600 hover:text-brand-400 transition-colors shrink-0">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </button>
                    </div>
                    <CitationsInline personId={person.id} fact="birth" citations={citationsFor('birth')} sources={sources} onMutated={invalidateCitations} />
                  </div>
                )}
                {(person.death_date || person.death_year || person.death_place) && (
                  <div>
                    <div className="flex gap-2 text-xs items-center">
                      <span className="text-zinc-500 w-20 shrink-0">{t('person.death')}</span>
                      <span className="text-zinc-300 flex-1">{[formatDate(person.death_date, person.death_year, dateLocale), person.death_place].filter(Boolean).join(', ')}</span>
                      <button onClick={() => { setAutoPhotoEventType('death'); setActiveTab('events') }} title={t('person.attachPhotoDeath')}
                        className="text-zinc-600 hover:text-brand-400 transition-colors shrink-0">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </button>
                    </div>
                    <CitationsInline personId={person.id} fact="death" citations={citationsFor('death')} sources={sources} onMutated={invalidateCitations} />
                  </div>
                )}
                {ageInfo && (
                  <div className="flex gap-2 text-xs">
                    <span className="text-zinc-500 w-20 shrink-0">
                      {ageInfo.alive ? t('person.ageToday') : t('person.ageAtDeath')}
                    </span>
                    <span className="text-zinc-400 tabular-nums">
                      {ageInfo.alive ? t('person.ageApprox', { n: ageInfo.age }) : t('person.yearsN', { n: ageInfo.age })}
                    </span>
                  </div>
                )}
                {person.sex && (
                  <div className="flex gap-2 text-xs">
                    <span className="text-zinc-500 w-20 shrink-0">{t('person.sex')}</span>
                    <span className="text-zinc-300">{SEX_LABEL[person.sex]}</span>
                  </div>
                )}
                {person.occupation && (
                  <div>
                    <div className="flex gap-2 text-xs">
                      <span className="text-zinc-500 w-20 shrink-0">{t('person.occupation')}</span>
                      <span className="text-zinc-300">{person.occupation}</span>
                    </div>
                    <div className="ml-0">
                      <CitationsInline personId={person.id} fact="occupation" citations={citationsFor('occupation')} sources={sources} onMutated={invalidateCitations} />
                    </div>
                  </div>
                )}
                {person.education && (
                  <div className="flex gap-2 text-xs">
                    <span className="text-zinc-500 w-20 shrink-0">{t('person.education')}</span>
                    <span className="text-zinc-300">{person.education}</span>
                  </div>
                )}
                {person.religion && (
                  <div className="flex gap-2 text-xs">
                    <span className="text-zinc-500 w-20 shrink-0">{t('person.religion')}</span>
                    <span className="text-zinc-300">{person.religion}</span>
                  </div>
                )}
                {person.nationality && (
                  <div className="flex gap-2 text-xs">
                    <span className="text-zinc-500 w-20 shrink-0">{t('person.nationality')}</span>
                    <span className="text-zinc-300">{person.nationality}</span>
                  </div>
                )}
                {person.cause_of_death && (
                  <div className="flex gap-2 text-xs">
                    <span className="text-zinc-500 w-20 shrink-0">{t('person.causeOfDeath')}</span>
                    <span className="text-zinc-300">{person.cause_of_death}</span>
                  </div>
                )}
                {(person.christening_date || person.christening_place) && (
                  <div>
                    <div className="flex gap-2 text-xs">
                      <span className="text-zinc-500 w-20 shrink-0">{t('person.christening')}</span>
                      <span className="text-zinc-300">{[formatDate(person.christening_date, person.christening_year, dateLocale), person.christening_place].filter(Boolean).join(', ')}</span>
                    </div>
                    <div className="ml-0">
                      <CitationsInline personId={person.id} fact="christening" citations={citationsFor('christening')} sources={sources} onMutated={invalidateCitations} />
                    </div>
                  </div>
                )}
                {(person.burial_date || person.burial_place) && (
                  <div>
                    <div className="flex gap-2 text-xs">
                      <span className="text-zinc-500 w-20 shrink-0">{t('person.burial')}</span>
                      <span className="text-zinc-300">{[formatDate(person.burial_date, person.burial_year, dateLocale), person.burial_place].filter(Boolean).join(', ')}</span>
                    </div>
                    <div className="ml-0">
                      <CitationsInline personId={person.id} fact="burial" citations={citationsFor('burial')} sources={sources} onMutated={invalidateCitations} />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-zinc-600 italic">{t('person.noDetails')}</p>
            )}
          </section>

          {/* Relations */}
          <section className="px-5 py-4 border-b border-zinc-800/80">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{t('person.relations')}</h3>
              {!editingRelations ? (
                <button onClick={() => setEditingRelations(true)}
                  className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors">{t('person.relEdit')}</button>
              ) : (
                <button onClick={() => { setEditingRelations(false); setRelWarning(null) }}
                  className="text-xs text-brand-400 hover:text-brand-300 font-medium transition-colors">{t('person.relDone')}</button>
              )}
            </div>

            {relWarning && (
              <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-950/40 border border-amber-800/40 rounded-lg px-3 py-2 mb-3">
                <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 3h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <span className="flex-1">{relWarning}</span>
                <button onClick={() => setRelWarning(null)} className="text-amber-600 hover:text-amber-400 transition-colors shrink-0">✕</button>
              </div>
            )}

            <div className="space-y-3.5">
              <RelRow label={t('person.parents')} persons={parents} editing={editingRelations} onNavigate={onNavigateTo}
                onRemove={p => handleRemove('parent', p)} addLabel={t('person.addParent')} onAdd={() => setPickerMode('parent')} addDisabled={parents.length >= 2}
                relPrivacy={parentRelPrivacy} onTogglePrivacy={handleToggleRelPrivacy} />

              {/* Spouses — rendered manually for marriage details */}
              {(editingRelations || spouseRelations.length > 0) && (
                <div>
                  <p className="text-xs text-zinc-600 uppercase tracking-wider mb-1.5">{t('person.spouses')}</p>
                  <div className="space-y-2">
                    {spouseRelations.map(({ rel, p }) => (
                      <div key={rel.id}>
                        <div className="flex items-center gap-1.5">
                          <div className="inline-flex items-center group">
                            <button onClick={() => onNavigateTo(p.id)}
                              className="inline-flex items-center gap-1.5 pl-1.5 pr-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/60 hover:border-zinc-500 rounded-full transition-colors max-w-[160px]">
                              <Avatar person={p} size={20} />
                              <span className="text-xs text-zinc-200 truncate leading-none">{displayPersonName(p, nameOrder)}</span>
                            </button>
                            <button
                              onClick={() => handleToggleRelPrivacy(rel.id, !rel.is_private)}
                              title={rel.is_private ? t('person.privacyOn') : t('person.privacyOff')}
                              className={`ml-0.5 w-4 h-4 flex items-center justify-center transition-colors shrink-0 ${rel.is_private ? 'text-amber-400' : 'text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-300'}`}
                            >
                              {rel.is_private ? (
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <rect x="3" y="11" width="18" height="11" rx="2" /><path strokeLinecap="round" d="M7 11V7a5 5 0 0110 0v4" />
                                </svg>
                              ) : (
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <rect x="3" y="11" width="18" height="11" rx="2" /><path strokeLinecap="round" d="M7 11V7a5 5 0 019.9-1" />
                                </svg>
                              )}
                            </button>
                            {editingRelations && (
                              <button onClick={() => handleRemove('spouse', p)}
                                className="ml-0.5 w-4 h-4 rounded-full bg-zinc-700 hover:bg-red-700 flex items-center justify-center text-xs text-zinc-400 hover:text-white transition-colors shrink-0"
                                title={t('person.removeRelation')}>✕</button>
                            )}
                          </div>
                          <button
                            onClick={() => openMarriage(rel)}
                            className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded transition-colors ${expandedRelId === rel.id ? 'text-brand-400 bg-brand-500/10' : 'text-zinc-500 hover:text-zinc-300'}`}
                          >
                            {rel.marriage_year || rel.marriage_place
                              ? `${t('person.marriagePrefix')}: ${[rel.marriage_year, rel.marriage_place].filter(Boolean).join(', ')}`
                              : t('person.addMarriageDetails')}
                            {/* Whether the marriage is backed by a source is
                                readable without opening the row — the same
                                amber the citation pill uses. */}
                            {marriageCitations(rel.id).length > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-amber-400"
                                title={marriageCitations(rel.id).length > 1
                                  ? t('person.citeSrcCountPlural', { n: marriageCitations(rel.id).length })
                                  : t('person.citeSrcCount', { n: marriageCitations(rel.id).length })}>
                                <BookIcon />
                                {marriageCitations(rel.id).length > 1 && marriageCitations(rel.id).length}
                              </span>
                            )}
                          </button>
                        </div>
                        {expandedRelId === rel.id && (
                          <div className="mt-2 ml-2 pl-3 border-l border-zinc-700 space-y-1.5">
                            <div className="flex gap-1.5">
                              <input type="number" placeholder={t('person.marriageYear')}
                                value={marriageEdits[rel.id]?.marriage_year ?? ''}
                                onChange={e => setMarriageEdits(m => ({ ...m, [rel.id]: { ...m[rel.id], marriage_year: e.target.value } }))}
                                className="w-24 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400" />
                              <PlaceInput placeholder={t('person.location')}
                                value={marriageEdits[rel.id]?.marriage_place ?? ''}
                                onChange={v => setMarriageEdits(m => ({ ...m, [rel.id]: { ...m[rel.id], marriage_place: v } }))}
                                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400" />
                            </div>
                            <div className="flex gap-1.5">
                              <input type="number" placeholder={t('person.divorceYear')}
                                value={marriageEdits[rel.id]?.divorce_year ?? ''}
                                onChange={e => setMarriageEdits(m => ({ ...m, [rel.id]: { ...m[rel.id], divorce_year: e.target.value } }))}
                                className="w-24 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400" />
                              <PlaceInput placeholder={t('person.location')}
                                value={marriageEdits[rel.id]?.divorce_place ?? ''}
                                onChange={v => setMarriageEdits(m => ({ ...m, [rel.id]: { ...m[rel.id], divorce_place: v } }))}
                                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400" />
                            </div>
                            <CitationsInline
                              personId={person.id}
                              fact="marriage"
                              relationId={rel.id}
                              citations={marriageCitations(rel.id)}
                              sources={sources}
                              onMutated={invalidateCitations}
                            />
                            <div className="flex gap-1.5 pt-0.5">
                              <button onClick={() => saveMarriage(rel.id)} disabled={updateRelMut.isPending}
                                className="px-3 py-0.5 text-xs font-medium bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-white rounded transition-colors">
                                {t('person.save')}
                              </button>
                              <button onClick={() => setExpandedRelId(null)}
                                className="px-3 py-0.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                                {t('person.cancel')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    {editingRelations && (
                      <button onClick={() => setPickerMode('spouse')}
                        className="inline-flex items-center gap-1 h-7 px-2.5 text-xs text-zinc-500 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-dashed border-zinc-700 hover:border-zinc-500 rounded-full transition-colors">
                        {t('person.addSpouse')}
                      </button>
                    )}
                  </div>
                </div>
              )}

              <RelRow label={t('person.children')} persons={children} groups={childGroups} editing={editingRelations} onNavigate={onNavigateTo}
                onRemove={p => handleRemove('parent', p)} addLabel={t('person.addChild')}
                onAdd={() => {
                  // One spouse is not a choice worth making — preselect it, so the
                  // common case adds the child to both parents with no extra click.
                  setChildCoParentId(spouseRelations.length === 1 ? spouseRelations[0].p.id : null)
                  setPickerMode('child')
                }}
                relPrivacy={childRelPrivacy} onTogglePrivacy={handleToggleRelPrivacy} />
              <RelRow label={t('person.siblings')} persons={siblings} editing={editingRelations} onNavigate={onNavigateTo}
                onRemove={p => handleRemove('sibling', p)} addLabel={t('person.addSibling')} onAdd={() => setPickerMode('sibling')}
                relPrivacy={siblingRelPrivacy} onTogglePrivacy={handleToggleRelPrivacy} />

              {!editingRelations && parents.length === 0 && spouseRelations.length === 0 && children.length === 0 && siblings.length === 0 && (
                <p className="text-sm text-zinc-600 italic">{t('person.noRelations')}</p>
              )}
            </div>
          </section>

          {/* Clusters */}
          <section className="px-5 py-4 border-b border-zinc-800/80">
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{t('person.clusters')}</h3>
              {person.clusters.length === 0 && (
                <button onClick={() => { setShowClusterPicker(p => !p); setClusterSearch('') }}
                  className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors">{t('person.addCluster')}</button>
              )}
            </div>
            {person.clusters.length === 0 && !showClusterPicker && (
              <p className="text-sm text-zinc-600 italic">{t('person.noCluster')}</p>
            )}
            {person.clusters.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {person.clusters.map(c => (
                    <div key={c.id} className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full pl-2.5 pr-1.5 py-1">
                      <span className="text-xs text-zinc-300">{t('person.clusterN', { n: String(c.label).padStart(3, '0') })}</span>
                      <span className="text-xs text-zinc-600 tabular-nums">{t('person.clusterFaces', { n: c.face_count })}</span>
                      <button onClick={() => handleUnlinkCluster(c.id)} title={t('person.unlinkCluster')}
                        className="w-4 h-4 rounded-full bg-zinc-700 hover:bg-red-700 flex items-center justify-center text-xs text-zinc-400 hover:text-white transition-colors shrink-0">✕</button>
                    </div>
                  ))}
                </div>
                {person.clusters.length > 1 && (
                  <p className="text-xs text-amber-600">{t('person.multipleClusters')}</p>
                )}
              </div>
            )}
            {showClusterPicker && (
              <div className="mt-2 bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden">
                <div className="p-2 border-b border-zinc-700">
                  <input autoFocus type="search" value={clusterSearch}
                    onChange={e => setClusterSearch(e.target.value)} placeholder={t('person.searchCluster')}
                    className="w-full bg-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400" />
                </div>
                <div className="max-h-52 overflow-y-auto">
                  {unlinkedClusters.filter(c => String(c.label).includes(clusterSearch) || clusterSearch === '').map(c => (
                    <button key={c.id} onClick={() => handleLinkCluster(c)} disabled={clusterLinking}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-zinc-700 transition-colors">
                      <div className="flex gap-px shrink-0">
                        {c.preview_face_ids?.slice(0, 2).map(fid => (
                          <img key={fid} src={api.faceThumbnailUrl(fid, 32)} className="w-7 h-7 rounded object-cover" alt="" />
                        )) ?? <div className="w-7 h-7 rounded bg-zinc-600" />}
                      </div>
                      <span className="text-zinc-200">{t('person.clusterN', { n: String(c.label).padStart(3, '0') })}</span>
                      <span className="ml-auto text-xs text-zinc-500 shrink-0 tabular-nums">{t('person.facesN', { n: c.face_count })}</span>
                    </button>
                  ))}
                  {unlinkedClusters.filter(c => String(c.label).includes(clusterSearch) || clusterSearch === '').length === 0 && (
                    <p className="text-xs text-zinc-600 px-3 py-3">{t('person.noFreeClusters')}</p>
                  )}
                </div>
                <div className="border-t border-zinc-700 px-3 py-2">
                  <button onClick={() => setShowClusterPicker(false)} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">{t('person.close')}</button>
                </div>
              </div>
            )}
          </section>

          {/* Photos */}
          <section className="px-5 py-4 border-b border-zinc-800/80">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
                {`${t('person.photosSection')}${imagesPage ? ` (${imagesPage.total})` : ''}`}
              </h3>
              {images.length > PHOTOS_CAP && (
                <button onClick={() => setShowAllPhotos(s => !s)}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                  {showAllPhotos ? t('person.showLess') : t('person.showAll', { n: images.length })}
                </button>
              )}
            </div>
            {loadingImgs ? (
              <div className="grid grid-cols-3 gap-1.5">
                {Array.from({ length: PHOTOS_CAP }).map((_, i) => <div key={i} className="aspect-square rounded-lg bg-zinc-800 animate-pulse" />)}
              </div>
            ) : images.length === 0 ? (
              <p className="text-sm text-zinc-600 italic">{t('person.noPhotosSection')}</p>
            ) : (
              <>
                <PhotoGallery images={visibleImages} onOpen={setLightboxIdx} />
                {!showAllPhotos && images.length > PHOTOS_CAP && (
                  <button onClick={() => setShowAllPhotos(true)}
                    className="mt-2 w-full text-xs text-zinc-500 hover:text-zinc-300 transition-colors py-1">
                    {t('person.morePhotos', { n: images.length - PHOTOS_CAP })}
                  </button>
                )}
              </>
            )}
          </section>

          </> /* end bio tab */}

          {/* ── Events tab ── */}
          {activeTab === 'events' && (
            <EventTimeline
              person={person}
              relations={relations}
              persons={persons}
              onNavigateToBio={() => { setActiveTab('bio'); setDetailsData(detailsFromPerson(person)); setEditingDetails(true) }}
              onNavToEvent={onNavToEvent}
              onNavToPerson={onNavigateTo}
              autoPhotoEventType={autoPhotoEventType}
              onAutoPhotoConsumed={() => setAutoPhotoEventType(null)}
            />
          )}

          {/* ── Documents tab ── */}
          {activeTab === 'documents' && (
          <section className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
                {`${t('person.docsSection')}${docs.length > 0 ? ` (${docs.length})` : ''}`}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setShowLinkForm(true); setShowUploadForm(false) }}
                  className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors"
                >
                  {t('person.linkDoc')}
                </button>
                <button
                  onClick={() => setShowUploadForm(s => !s)}
                  className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors"
                >
                  {showUploadForm ? t('person.cancel') : t('person.uploadDoc')}
                </button>
              </div>
            </div>

            {showLinkForm && (
              <DocLinkExistingModal
                personId={person.id}
                linkedDocIds={new Set(docs.map(d => d.id))}
                onClose={() => setShowLinkForm(false)}
              />
            )}

            {showUploadForm && (
              <DocUploadForm personId={person.id} onDone={() => setShowUploadForm(false)} />
            )}

            {loadingDocs ? (
              <div className="space-y-2">
                {[1, 2].map(i => <div key={i} className="h-8 rounded bg-zinc-800 animate-pulse" />)}
              </div>
            ) : docs.length === 0 && !showUploadForm ? (
              <p className="text-sm text-zinc-600 italic">{t('person.noDocuments')}</p>
            ) : (
              <div className="divide-y divide-zinc-800/60">
                {docs.map(doc => (
                  <DocRow key={doc.id} doc={doc} onUnlink={() => unlinkDocMut.mutate(doc.id)} onNavToDocument={onNavToDocument} />
                ))}
              </div>
            )}
          </section>
          )}

          {/* ── Notes tab ── */}
          {activeTab === 'notes' && (
          <section className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{t('person.notesSection')}</h3>
              <button onClick={startNewNote}
                className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors">
                {t('person.addNote')}
              </button>
            </div>
            <div className="space-y-3">
              {personNotes.map(note => (
                <NoteCard
                  key={note.id}
                  note={note}
                  sources={sources}
                  persons={persons}
                  relations={relations}
                  onUpdated={() => refetchNotes()}
                  onDeleted={() => refetchNotes()}
                  onNavToEvent={onNavToEvent}
                  onNavToPerson={onNavigateTo}
                  personId={person.id}
                />
              ))}
              {creatingNote && newNoteShell && (
                <NoteEditorComponent
                  note={newNoteShell}
                  sources={sources}
                  persons={persons}
                  relations={relations}
                  onNavToPerson={onNavigateTo}
                  onSaved={() => { refetchNotes(); setCreatingNote(false); setNewNoteShell(null) }}
                  onDeleted={() => { refetchNotes(); setCreatingNote(false); setNewNoteShell(null) }}
                  onCancel={async () => {
                    await api.notes.delete(newNoteShell.id)
                    setCreatingNote(false)
                    setNewNoteShell(null)
                  }}
                  autoFocusContent
                />
              )}
              {personNotes.length === 0 && !creatingNote && (
                <p className="text-sm text-zinc-600 italic">{t('person.noNotes')}</p>
              )}
            </div>
          </section>
          )}

          <div className="h-8" />
        </div>
      </div>

      {pickerMode && (
        <PersonPicker
          persons={persons}
          excludeIds={allRelatedIds}
          relations={relations}
          label={pickerLabels[pickerMode]}
          headerExtra={pickerMode === 'child' && spouseRelations.length > 0 ? (
            <CoParentChoice
              options={spouseRelations}
              persons={persons}
              relations={relations}
              value={childCoParentId}
              onChange={setChildCoParentId}
            />
          ) : undefined}
          onSelect={handleAdd}
          onClose={() => setPickerMode(null)}
        />
      )}

      {mergePickerOpen && (
        <PersonPicker
          persons={persons}
          excludeIds={new Set([person.id])}
          relations={relations}
          label={t('person.mergeIntoLabel')}
          onSelect={p => { setMergePending(p); setMergePickerOpen(false) }}
          onClose={() => setMergePickerOpen(false)}
        />
      )}

      {relatePickerOpen && (
        <PersonPicker
          persons={persons}
          excludeIds={new Set([person.id])}
          relations={relations}
          label={t('person.findRelLabel')}
          onSelect={p => { setRelatePerson(p); setRelatePickerOpen(false) }}
          onClose={() => setRelatePickerOpen(false)}
        />
      )}

      {relatePerson && (
        <RelationPathModal
          personA={person}
          personB={relatePerson}
          persons={persons}
          relations={relations}
          onClose={() => setRelatePerson(null)}
          onNavigate={id => { setRelatePerson(null); onNavigateTo(id) }}
        />
      )}

      {lightboxIdx !== null && (
        <Lightbox
          images={images}
          idx={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onChange={setLightboxIdx}
          onNavigateTo={id => { setLightboxIdx(null); onNavigateTo(id) }}
        />
      )}
    </>
  )
}

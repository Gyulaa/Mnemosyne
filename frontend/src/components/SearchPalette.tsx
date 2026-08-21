import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { PersonFull, PersonEvent, PersonDocument } from '../types'
import { useSettings, displayPersonName, displayInitials, useT } from '../SettingsContext'
import { plainMentions, plainMarkdown } from '../markdown'

interface Props {
  open: boolean
  onClose: () => void
  onNavToGenealogy: (personId: number) => void
  onNavToEvent: (eventId: number) => void
  onViewDocument: (doc: PersonDocument) => void
}

type NoteHit = { id: number; person_id: number; title: string | null; content: string }

type ResultItem =
  | { kind: 'person';   id: number; person: PersonFull }
  | { kind: 'event';    id: number; event: PersonEvent }
  | { kind: 'document'; id: number; doc: PersonDocument }
  | { kind: 'note';     id: number; note: NoteHit; person: PersonFull | undefined }

function personYears(p: PersonFull): string {
  const by = p.birth_date ? p.birth_date.slice(0, 4) : p.birth_year != null ? String(p.birth_year) : null
  const dy = p.death_date ? p.death_date.slice(0, 4) : p.death_year != null ? String(p.death_year) : null
  return [by, dy].filter(Boolean).join('–')
}

function personSub(p: PersonFull): string {
  const parts = [personYears(p), p.birth_place].filter(Boolean)
  return parts.join(' · ')
}

function Avatar({ p }: { p: PersonFull }) {
  const [err, setErr] = useState(false)
  if (p.thumbnail_face_id && !err) {
    return (
      <img
        src={api.faceThumbnailUrl(p.thumbnail_face_id, 56)}
        className="w-full h-full object-cover"
        onError={() => setErr(true)}
      />
    )
  }
  return (
    <span className="text-xs font-semibold text-zinc-400 leading-none select-none">
      {displayInitials(p)}
    </span>
  )
}

export default function SearchPalette({ open, onClose, onNavToGenealogy, onNavToEvent, onViewDocument }: Props) {
  const { nameOrder } = useSettings()
  const t = useT()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: persons   = [] } = useQuery<PersonFull[]>    ({ queryKey: ['persons'],   queryFn: api.persons.list })
  const { data: events    = [] } = useQuery<PersonEvent[]>   ({ queryKey: ['events'],    queryFn: () => api.events.list() })
  const { data: documents = [] } = useQuery<PersonDocument[]>({ queryKey: ['docs-all'],  queryFn: api.documents.listAll })
  const { data: notes     = [] } = useQuery<NoteHit[]>       ({ queryKey: ['notes-all'], queryFn: api.notes.listAll })

  const personById = useMemo(() => new Map(persons.map(p => [p.id, p])), [persons])

  const results = useMemo((): ResultItem[] => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const matched: ResultItem[] = []

    for (const p of persons) {
      const hit =
        (p.name ?? '').toLowerCase().includes(q) ||
        (p.nickname ?? '').toLowerCase().includes(q) ||
        (p.first_name ?? '').toLowerCase().includes(q) ||
        (p.last_name ?? '').toLowerCase().includes(q)
      if (hit) matched.push({ kind: 'person', id: p.id, person: p })
      if (matched.length >= 6) break
    }

    for (const e of events) {
      if (
        (e.title ?? '').toLowerCase().includes(q) ||
        (e.description ?? '').toLowerCase().includes(q) ||
        (e.place ?? '').toLowerCase().includes(q)
      ) matched.push({ kind: 'event', id: e.id, event: e })
      if (matched.filter(r => r.kind === 'event').length >= 3) break
    }

    for (const d of documents) {
      if (
        plainMentions(d.title ?? '').toLowerCase().includes(q) ||
        (d.filename ?? '').toLowerCase().includes(q) ||
        plainMarkdown(d.description ?? '').toLowerCase().includes(q)
      ) matched.push({ kind: 'document', id: d.id, doc: d })
      if (matched.filter(r => r.kind === 'document').length >= 3) break
    }

    for (const n of notes) {
      if (
        (n.title ?? '').toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q)
      ) matched.push({ kind: 'note', id: n.id, note: n, person: personById.get(n.person_id) })
      if (matched.filter(r => r.kind === 'note').length >= 3) break
    }

    return matched
  }, [query, persons, events, documents, notes, personById])

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => { setCursor(0) }, [results])

  function activate(item: ResultItem) {
    onClose()
    if (item.kind === 'person') onNavToGenealogy(item.id)
    else if (item.kind === 'event') onNavToEvent(item.id)
    else if (item.kind === 'document') onViewDocument(item.doc)
    else if (item.kind === 'note' && item.person) onNavToGenealogy(item.note.person_id)
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown')  { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)) }
    if (e.key === 'ArrowUp')    { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    if (e.key === 'Enter' && results[cursor]) activate(results[cursor])
    if (e.key === 'Escape') onClose()
  }

  if (!open) return null

  const hasQ = query.trim().length > 0

  return (
    <div
      className="fixed inset-0 z-[600] flex items-start justify-center pt-[12vh] bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[580px] rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: '#111117', border: '1px solid rgba(255,255,255,0.1)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Input row */}
        <div className="flex items-center gap-3 px-4 h-14" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <svg className="w-4 h-4 text-zinc-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder={t('search.placeholder')}
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 outline-none"
          />
          {hasQ && (
            <button onClick={() => setQuery('')} className="text-zinc-600 hover:text-zinc-400 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
              </svg>
            </button>
          )}
          <kbd className="shrink-0 text-xs text-zinc-600 border border-zinc-700 rounded px-1.5 py-0.5 font-mono">Esc</kbd>
        </div>

        {/* Results */}
        {hasQ && (
          <div className="max-h-[420px] overflow-y-auto py-2">
            {results.length === 0 && (
              <p className="px-4 py-5 text-sm text-zinc-500 text-center">{t('search.noResults', { q: query })}</p>
            )}

            {/* Person results */}
            {results.some(r => r.kind === 'person') && (
              <div>
                <p className="px-4 pb-1 pt-0.5 text-xs text-zinc-600 uppercase tracking-widest font-semibold">{t('search.persons')}</p>
                {results.filter(r => r.kind === 'person').map((item, i) => {
                  const p = (item as Extract<ResultItem, { kind: 'person' }>).person
                  const idx = results.indexOf(item)
                  const active = cursor === idx
                  return (
                    <button
                      key={p.id}
                      onClick={() => activate(item)}
                      onMouseEnter={() => setCursor(idx)}
                      className={[
                        'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                        active ? 'bg-zinc-800' : 'hover:bg-zinc-800/40',
                      ].join(' ')}
                    >
                      <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 shrink-0 overflow-hidden flex items-center justify-center">
                        <Avatar p={p} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-zinc-100 truncate font-medium">{displayPersonName(p, nameOrder)}</p>
                        {personSub(p) && <p className="text-xs text-zinc-500 truncate">{personSub(p)}</p>}
                      </div>
                      {active && (
                        <kbd className="shrink-0 text-xs text-zinc-600 border border-zinc-700 rounded px-1.5 py-0.5 font-mono">↵</kbd>
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Event results */}
            {results.some(r => r.kind === 'event') && (
              <div className={results.some(r => r.kind === 'person') ? 'mt-1' : ''}>
                <p className="px-4 pb-1 pt-0.5 text-xs text-zinc-600 uppercase tracking-widest font-semibold">{t('search.events')}</p>
                {results.filter(r => r.kind === 'event').map(item => {
                  const e = (item as Extract<ResultItem, { kind: 'event' }>).event
                  const idx = results.indexOf(item)
                  const active = cursor === idx
                  return (
                    <button
                      key={e.id}
                      onClick={() => activate(item)}
                      onMouseEnter={() => setCursor(idx)}
                      className={[
                        'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                        active ? 'bg-zinc-800' : 'hover:bg-zinc-800/40',
                      ].join(' ')}
                    >
                      <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 shrink-0 flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <rect x="3" y="4" width="18" height="18" rx="2" />
                          <path strokeLinecap="round" d="M3 9h18M8 2v3m8-3v3" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-zinc-100 truncate font-medium">{e.title ?? t('events.noTitle')}</p>
                        {(e.date || e.place) && (
                          <p className="text-xs text-zinc-500 truncate">
                            {[e.date, e.place].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>
                      {active && (
                        <kbd className="shrink-0 text-xs text-zinc-600 border border-zinc-700 rounded px-1.5 py-0.5 font-mono">↵</kbd>
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Document results */}
            {results.some(r => r.kind === 'document') && (
              <div className={results.some(r => r.kind !== 'document') ? 'mt-1' : ''}>
                <p className="px-4 pb-1 pt-0.5 text-xs text-zinc-600 uppercase tracking-widest font-semibold">{t('search.documents')}</p>
                {results.filter(r => r.kind === 'document').map(item => {
                  const d = (item as Extract<ResultItem, { kind: 'document' }>).doc
                  const idx = results.indexOf(item)
                  const active = cursor === idx
                  return (
                    <button
                      key={d.id}
                      onClick={() => activate(item)}
                      onMouseEnter={() => setCursor(idx)}
                      className={[
                        'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                        active ? 'bg-zinc-800' : 'hover:bg-zinc-800/40',
                      ].join(' ')}
                    >
                      <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 shrink-0 flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-zinc-100 truncate font-medium">{plainMentions(d.title ?? d.filename)}</p>
                        <p className="text-xs text-zinc-500 truncate">
                          {[d.doc_type, d.year].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {active && (
                        <kbd className="shrink-0 text-xs text-zinc-600 border border-zinc-700 rounded px-1.5 py-0.5 font-mono">↵</kbd>
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Note results */}
            {results.some(r => r.kind === 'note') && (
              <div className={results.some(r => r.kind !== 'note') ? 'mt-1' : ''}>
                <p className="px-4 pb-1 pt-0.5 text-xs text-zinc-600 uppercase tracking-widest font-semibold">{t('search.notes')}</p>
                {results.filter(r => r.kind === 'note').map(item => {
                  const n = (item as Extract<ResultItem, { kind: 'note' }>).note
                  const owner = (item as Extract<ResultItem, { kind: 'note' }>).person
                  const idx = results.indexOf(item)
                  const active = cursor === idx
                  return (
                    <button
                      key={n.id}
                      onClick={() => activate(item)}
                      onMouseEnter={() => setCursor(idx)}
                      className={[
                        'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                        active ? 'bg-zinc-800' : 'hover:bg-zinc-800/40',
                      ].join(' ')}
                    >
                      <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 shrink-0 flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-zinc-100 truncate font-medium">{n.title ?? t('notes.noTitle')}</p>
                        <p className="text-xs text-zinc-500 truncate">
                          {owner ? displayPersonName(owner, nameOrder) : ''}
                          {n.content && ` · ${n.content.slice(0, 60)}${n.content.length > 60 ? '…' : ''}`}
                        </p>
                      </div>
                      {active && (
                        <kbd className="shrink-0 text-xs text-zinc-600 border border-zinc-700 rounded px-1.5 py-0.5 font-mono">↵</kbd>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {!hasQ && (
          <div className="flex items-center gap-2 px-4 py-3 text-xs text-zinc-600">
            <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M3 12h18M3 6h18M3 18h18" />
            </svg>
            {t('search.hint')}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Person pickers shared by the document screens.
 *
 * Rows show the name in the configured name order, a life-summary line, and
 * the close-relative lines from familyContext — the same shape the cluster and
 * mention pickers use, so telling two same-named people apart works the same
 * way everywhere.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { PersonFull, Relation } from '../types'
import { useSettings, displayPersonName, useT } from '../SettingsContext'
import {
  useFamilyContext, FamilyContextLines, personLifeSummary, personMatches,
} from '../familyContext'

/** Persons + relations, fetched once and shared by every picker on screen. */
export function usePersonDirectory() {
  const { nameOrder } = useSettings()
  const { data: persons = [] }   = useQuery<PersonFull[]>({ queryKey: ['persons'], queryFn: api.persons.list })
  const { data: relations = [] } = useQuery<Relation[]>({ queryKey: ['relations'], queryFn: api.relations.list })
  const familyMap = useFamilyContext(persons, relations, nameOrder)
  return { persons, relations, familyMap, nameOrder }
}

// ── PersonRow ─────────────────────────────────────────────────────────────────

function PersonRow({ person, selected, familyMap, onClick }: {
  person: PersonFull
  selected: boolean
  familyMap: ReturnType<typeof useFamilyContext>
  onClick: () => void
}) {
  const { nameOrder } = useSettings()
  const bio = personLifeSummary(person)
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-2.5 px-3 py-2 text-xs text-left transition-colors ${
        selected ? 'bg-brand-900/40 text-brand-200' : 'text-zinc-300 hover:bg-zinc-800'
      }`}
    >
      <span className={`w-4 h-4 mt-0.5 rounded border shrink-0 flex items-center justify-center ${
        selected ? 'bg-brand-500 border-brand-400' : 'border-zinc-600'
      }`}>
        {selected && (
          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 10" stroke="currentColor" strokeWidth={2}>
            <path d="M1 5l3 3 7-7" />
          </svg>
        )}
      </span>
      <span className="flex flex-col min-w-0 flex-1">
        <span className="truncate font-medium">{displayPersonName(person, nameOrder)}</span>
        {bio && (
          <span className={`text-xs truncate ${selected ? 'text-brand-400/70' : 'text-zinc-500'}`}>{bio}</span>
        )}
        <FamilyContextLines fam={familyMap.get(person.id)} dim={!selected} />
      </span>
    </button>
  )
}

// ── PersonMultiSelect ─────────────────────────────────────────────────────────

/**
 * Searchable checkbox list of persons, with the selection shown as chips above.
 * `onToggle` fires per click; the caller owns the selected set.
 */
export function PersonMultiSelect({
  persons, familyMap, selectedIds, onToggle, maxHeight = 260, limit = 80,
}: {
  persons: PersonFull[]
  familyMap: ReturnType<typeof useFamilyContext>
  selectedIds: Set<number>
  onToggle: (id: number) => void
  maxHeight?: number
  limit?: number
}) {
  const t = useT()
  const { nameOrder } = useSettings()
  const [search, setSearch] = useState('')

  const filtered = useMemo(
    () => persons.filter(p => personMatches(p, search, nameOrder)),
    [persons, search, nameOrder],
  )
  // Selected people stay reachable even when the query or the cap hides them.
  const visible = useMemo(() => {
    const head = filtered.slice(0, limit)
    const shown = new Set(head.map(p => p.id))
    const pinned = persons.filter(p => selectedIds.has(p.id) && !shown.has(p.id))
    return [...pinned, ...head]
  }, [filtered, persons, selectedIds, limit])

  const selected = persons.filter(p => selectedIds.has(p.id))

  return (
    <div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {selected.map(p => (
            <span key={p.id}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-800/60 border border-brand-600/50 text-brand-300 text-xs">
              {displayPersonName(p, nameOrder)}
              <button onClick={() => onToggle(p.id)} className="hover:text-white">×</button>
            </span>
          ))}
        </div>
      )}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={t('docs.searchPersons')}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400 mb-1"
      />
      <div className="overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800/40 divide-y divide-zinc-800/70"
        style={{ maxHeight }}>
        {visible.map(p => (
          <PersonRow key={p.id} person={p} selected={selectedIds.has(p.id)}
            familyMap={familyMap} onClick={() => onToggle(p.id)} />
        ))}
        {visible.length === 0 && (
          <p className="px-3 py-2 text-xs text-zinc-600">{t('docs.noPersonsFound')}</p>
        )}
        {filtered.length > limit && (
          <p className="px-3 py-1.5 text-xs text-zinc-600 italic">
            {t('docs.morePersons', { n: filtered.length - limit })}
          </p>
        )}
      </div>
    </div>
  )
}

// ── PersonFilterCombobox ──────────────────────────────────────────────────────

/** Single-select dropdown used as the "filter by person" control. */
export function PersonFilterCombobox({ persons, familyMap, value, onChange, emptyLabel }: {
  persons: PersonFull[]
  familyMap: ReturnType<typeof useFamilyContext>
  value: number | null
  onChange: (id: number | null) => void
  /** What "nobody chosen" means here. Defaults to "all persons", which is the
   *  filter reading; a caller where an empty value means something else (a
   *  share rule that has not been pointed at anybody yet) supplies its own. */
  emptyLabel?: string
}) {
  const t = useT()
  const { nameOrder } = useSettings()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const selected = persons.find(p => p.id === value)

  const filtered = useMemo(
    () => persons.filter(p => personMatches(p, search, nameOrder)),
    [persons, search, nameOrder],
  )

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const select = (id: number | null) => { onChange(id); setOpen(false); setSearch('') }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs outline-none hover:border-zinc-600 focus:border-brand-400 min-w-[140px] max-w-[180px]"
      >
        <span className={selected ? 'text-zinc-100 truncate' : 'text-zinc-500'}>
          {selected ? displayPersonName(selected, nameOrder) : (emptyLabel ?? t('docs.allPersons'))}
        </span>
        <svg className={`w-3 h-3 text-zinc-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-2 py-2 border-b border-zinc-800">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('docs.searchPersons')}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400"
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1 divide-y divide-zinc-800/70">
            <button
              onClick={() => select(null)}
              className={`w-full px-3 py-1.5 text-xs text-left hover:bg-zinc-800 transition-colors ${value === null ? 'text-brand-300' : 'text-zinc-400'}`}
            >
              {emptyLabel ?? t('docs.allPersons')}
            </button>
            {filtered.map(p => {
              const bio = personLifeSummary(p)
              const active = value === p.id
              return (
                <button key={p.id} onClick={() => select(p.id)}
                  className={`w-full px-3 py-2 text-xs text-left flex flex-col hover:bg-zinc-800 transition-colors ${active ? 'text-brand-300' : 'text-zinc-100'}`}
                >
                  <span className="truncate font-medium">{displayPersonName(p, nameOrder)}</span>
                  {bio && <span className="text-xs text-zinc-500 leading-tight truncate">{bio}</span>}
                  <FamilyContextLines fam={familyMap.get(p.id)} dim />
                </button>
              )
            })}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-zinc-600 italic">{t('docs.noResults')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

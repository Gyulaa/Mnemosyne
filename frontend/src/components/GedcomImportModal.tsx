import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { api } from '../api'
import type {
  GedcomPreview, GedcomImportPerson, GedcomImportAction,
  GedcomImportDecision, GedcomImportStats, PersonFull, Relation,
} from '../types'

// ── helpers ───────────────────────────────────────────────────────────────────

function formatLifespan(birth_year: number | null, death_year: number | null, birth_place?: string | null): string {
  const years = [birth_year, death_year].filter(Boolean).join('–')
  if (years && birth_place) return `${years} · ${birth_place}`
  return years || birth_place || ''
}

function confBadge(conf: 'exact' | 'high' | 'low') {
  if (conf === 'exact') return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-900/60 text-emerald-300">Egyezés</span>
  if (conf === 'high')  return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-900/60  text-amber-300" >Lehetséges</span>
  return                       <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-800       text-zinc-400" >Gyenge</span>
}

// ── RelativeChips: compact inline relatives for the GEDCOM person ─────────────

function RelativeChips({ relatives }: { relatives: GedcomImportPerson['relatives'] }) {
  if (!relatives.length) return null
  const parents  = relatives.filter(r => r.role === 'parent')
  const spouses  = relatives.filter(r => r.role === 'spouse')
  const children = relatives.filter(r => r.role === 'child')
  return (
    <div className="mt-1 space-y-0.5">
      {parents.length > 0 && (
        <p className="text-[10px] text-zinc-500 leading-snug">
          <span className="text-zinc-600">Szülők: </span>{parents.map(r => r.name).join(', ')}
        </p>
      )}
      {spouses.length > 0 && (
        <p className="text-[10px] text-zinc-500 leading-snug">
          <span className="text-zinc-600">Házastárs: </span>{spouses.map(r => r.name).join(', ')}
        </p>
      )}
      {children.length > 0 && (
        <p className="text-[10px] text-zinc-500 leading-snug">
          <span className="text-zinc-600">Gyermek: </span>
          {children.length <= 3
            ? children.map(r => r.name).join(', ')
            : `${children.slice(0, 2).map(r => r.name).join(', ')} +${children.length - 2}`}
        </p>
      )}
    </div>
  )
}

// ── PersonCombobox: searchable rich picker for existing persons ───────────────

interface ComboboxProps {
  action: GedcomImportAction
  mergeWithId: number | null
  existingPersons: PersonFull[]
  parentsOf: Map<number, string[]>
  spousesOf: Map<number, string[]>
  onChange: (action: GedcomImportAction, mergeWithId: number | null) => void
}

function PersonCombobox({ action, mergeWithId, existingPersons, parentsOf, spousesOf, onChange }: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return existingPersons
      .filter(p => !q || (p.name ?? '').toLowerCase().includes(q))
      .slice(0, 30)
  }, [existingPersons, query])

  function handleOpen() {
    setOpen(true)
    setQuery('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function select(a: GedcomImportAction, id: number | null) {
    onChange(a, id)
    setOpen(false)
    setQuery('')
  }

  // Current selection label
  const selectedPerson = action === 'merge' && mergeWithId != null
    ? existingPersons.find(p => p.id === mergeWithId)
    : null

  const triggerLabel = action === 'skip'
    ? <span className="text-zinc-500">⊘ Kihagyás</span>
    : action === 'create'
    ? <span className="text-brand-300">+ Új személy</span>
    : selectedPerson
    ? <span className="text-zinc-100">{selectedPerson.name ?? '—'}{selectedPerson.birth_year ? <span className="text-zinc-500 font-normal ml-1">({selectedPerson.birth_year})</span> : ''}</span>
    : <span className="text-zinc-500">Válassz…</span>

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        className="w-full flex items-center justify-between gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-left hover:border-zinc-500 transition-colors focus:outline-none focus:border-brand-400"
      >
        <span className="truncate font-medium">{triggerLabel}</span>
        <svg className="w-3 h-3 text-zinc-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {selectedPerson && (() => {
        const lifespan = formatLifespan(selectedPerson.birth_year, selectedPerson.death_year, selectedPerson.birth_place)
        const parents  = parentsOf.get(selectedPerson.id) ?? []
        const spouses  = spousesOf.get(selectedPerson.id) ?? []
        return (
          <div className="mt-1 px-0.5 space-y-0.5">
            {lifespan && <p className="text-[10px] text-zinc-500">{lifespan}</p>}
            {parents.length > 0 && (
              <p className="text-[10px] text-zinc-500 leading-snug">
                <span className="text-zinc-600">Szülők: </span>{parents.join(', ')}
              </p>
            )}
            {spouses.length > 0 && (
              <p className="text-[10px] text-zinc-500 leading-snug">
                <span className="text-zinc-600">Házastárs: </span>{spouses.join(', ')}
              </p>
            )}
          </div>
        )
      })()}

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-zinc-850 border border-zinc-700 rounded-xl shadow-2xl flex flex-col"
          style={{ maxHeight: 320, minWidth: 280, background: '#1c1c1e' }}>
          {/* Search */}
          <div className="px-2.5 pt-2.5 pb-1.5 border-b border-zinc-800">
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Keresés neve alapján…"
              className="w-full bg-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none border border-zinc-700 focus:border-brand-400"
            />
          </div>

          <div className="overflow-y-auto flex-1">
            {/* Fixed options */}
            <button onClick={() => select('create', null)}
              className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-zinc-800 ${action === 'create' ? 'text-brand-300' : 'text-zinc-400'}`}>
              + Új személy létrehozása
            </button>
            <button onClick={() => select('skip', null)}
              className={`w-full text-left px-3 py-2 text-xs border-b border-zinc-800 transition-colors hover:bg-zinc-800 ${action === 'skip' ? 'text-zinc-300' : 'text-zinc-600'}`}>
              ⊘ Kihagyás
            </button>

            {/* Existing persons */}
            {filtered.length === 0 && (
              <p className="px-3 py-3 text-xs text-zinc-600 italic">Nincs találat</p>
            )}
            {filtered.map(ep => {
              const lifespan = formatLifespan(ep.birth_year, ep.death_year, ep.birth_place)
              const parents = parentsOf.get(ep.id) ?? []
              const spouses = spousesOf.get(ep.id) ?? []
              const isSelected = action === 'merge' && mergeWithId === ep.id
              return (
                <button
                  key={ep.id}
                  onClick={() => select('merge', ep.id)}
                  className={`w-full text-left px-3 py-2 transition-colors hover:bg-zinc-800 border-b border-zinc-800/50 last:border-0
                    ${isSelected ? 'bg-emerald-900/20 border-l-2 border-l-emerald-500' : ''}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-medium ${isSelected ? 'text-emerald-300' : 'text-zinc-100'}`}>
                      {ep.name ?? '—'}
                    </span>
                    {ep.sex && <span className="text-[10px] text-zinc-600">{ep.sex === 'M' ? '♂' : '♀'}</span>}
                  </div>
                  {lifespan && <p className="text-[10px] text-zinc-500 mt-0.5">{lifespan}</p>}
                  {parents.length > 0 && (
                    <p className="text-[10px] text-zinc-600 mt-0.5">
                      <span className="text-zinc-700">Szülők: </span>{parents.join(', ')}
                    </p>
                  )}
                  {spouses.length > 0 && (
                    <p className="text-[10px] text-zinc-600 mt-0.5">
                      <span className="text-zinc-700">Házastárs: </span>{spouses.join(', ')}
                    </p>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── PersonRow ─────────────────────────────────────────────────────────────────

interface RowProps {
  person: GedcomImportPerson
  action: GedcomImportAction
  mergeWithId: number | null
  existingPersons: PersonFull[]
  parentsOf: Map<number, string[]>
  spousesOf: Map<number, string[]>
  onChange: (action: GedcomImportAction, mergeWithId: number | null) => void
}

function PersonRow({ person, action, mergeWithId, existingPersons, parentsOf, spousesOf, onChange }: RowProps) {
  const lifespan = formatLifespan(person.birth_year, person.death_year, person.birth_place)
  const sexIcon = person.sex === 'M' ? '♂' : person.sex === 'F' ? '♀' : ''

  return (
    <tr className="border-b border-zinc-800 hover:bg-zinc-900/40 align-top">
      {/* Import person info */}
      <td className="py-3 px-3">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-zinc-100 font-medium">{person.name ?? '—'}</span>
          {sexIcon && <span className="text-xs text-zinc-500">{sexIcon}</span>}
        </div>
        {lifespan && <div className="text-xs text-zinc-500 mt-0.5">{lifespan}</div>}
        <RelativeChips relatives={person.relatives} />
        {(person.events_count > 0 || person.notes_count > 0 || person.docs_count > 0) && (
          <div className="text-[10px] text-zinc-700 mt-1">
            {[
              person.events_count > 0 && `${person.events_count} esemény`,
              person.notes_count  > 0 && `${person.notes_count} megjegyzés`,
              person.docs_count   > 0 && `${person.docs_count} dok.`,
            ].filter(Boolean).join(' · ')}
          </div>
        )}
      </td>

      {/* Confidence badge */}
      <td className="py-3 px-2 text-center">
        {person.suggested_match ? confBadge(person.suggested_match.confidence) : (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-brand-900/40 text-brand-300">Új</span>
        )}
      </td>

      {/* Decision */}
      <td className="py-3 px-3" style={{ minWidth: 260 }}>
        <PersonCombobox
          action={action}
          mergeWithId={mergeWithId}
          existingPersons={existingPersons}
          parentsOf={parentsOf}
          spousesOf={spousesOf}
          onChange={onChange}
        />
        {action === 'merge' && mergeWithId != null && (
          <div className="text-[10px] text-zinc-600 mt-1 px-0.5">Hiányzó mezők lesznek kiegészítve</div>
        )}
      </td>
    </tr>
  )
}

// ── Stats summary ─────────────────────────────────────────────────────────────

function StatsSummary({ stats }: { stats: GedcomImportStats }) {
  const rows: [string, number][] = [
    ['Új személy', stats.persons_created],
    ['Merged személy', stats.persons_merged],
    ['Kihagyva', stats.persons_skipped],
    ['Kapcsolat hozzáadva', stats.relations_added],
    ['Esemény hozzáadva', stats.events_added],
    ['Forrás hozzáadva', stats.sources_added],
    ['Megjegyzés hozzáadva', stats.notes_added],
    ['Dokumentum hozzáadva', stats.documents_added],
  ]
  return (
    <div className="space-y-1.5">
      {rows.filter(([, v]) => v > 0).map(([label, val]) => (
        <div key={label} className="flex items-center justify-between text-sm">
          <span className="text-zinc-400">{label}</span>
          <span className="font-medium text-zinc-100">{val}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

type Phase = 'upload' | 'preview' | 'importing' | 'done' | 'error'

interface Props {
  existingPersons: PersonFull[]
  relations: Relation[]
  onDone: () => void
  onClose: () => void
}

export default function GedcomImportModal({ existingPersons, relations, onDone, onClose }: Props) {
  const [phase, setPhase]       = useState<Phase>('upload')
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview]   = useState<GedcomPreview | null>(null)
  const [decisions, setDecisions] = useState<Map<string, { action: GedcomImportAction; mergeWithId: number | null }>>(new Map())
  const [stats, setStats]       = useState<GedcomImportStats | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Sorted existing persons for the combobox
  const sortedPersons = useMemo(() =>
    [...existingPersons].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'hu')),
    [existingPersons]
  )

  // Precompute parent/spouse maps for the picker
  const personById = useMemo(() => new Map(existingPersons.map(p => [p.id, p])), [existingPersons])

  const parentsOf = useMemo(() => {
    const map = new Map<number, string[]>()
    for (const rel of relations) {
      if (rel.type !== 'parent') continue
      const parentName = personById.get(rel.person_a_id)?.name
      if (!parentName) continue
      const list = map.get(rel.person_b_id) ?? []
      list.push(parentName)
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
      if (nameA && nameB) {
        const la = map.get(rel.person_a_id) ?? []; la.push(nameB); map.set(rel.person_a_id, la)
        const lb = map.get(rel.person_b_id) ?? []; lb.push(nameA); map.set(rel.person_b_id, lb)
      }
    }
    return map
  }, [relations, personById])

  // ── File handling ──────────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    setPhase('importing')
    setErrorMsg('')
    try {
      const prev = await api.project.previewGedcomImport(file)
      const map = new Map<string, { action: GedcomImportAction; mergeWithId: number | null }>()
      for (const p of prev.persons) {
        map.set(p.xref, { action: p.action, mergeWithId: p.merge_with_id })
      }
      setDecisions(map)
      setPreview(prev)
      setPhase('preview')
    } catch (e) {
      setErrorMsg(String(e))
      setPhase('error')
    }
  }, [])

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  // ── Decision helpers ───────────────────────────────────────────────────────

  function setDecision(xref: string, action: GedcomImportAction, mergeWithId: number | null) {
    setDecisions(prev => {
      const next = new Map(prev)
      next.set(xref, { action, mergeWithId })
      return next
    })
  }

  function applyAll(action: GedcomImportAction) {
    if (!preview) return
    setDecisions(prev => {
      const next = new Map(prev)
      for (const p of preview.persons) {
        if (action === 'merge' && p.suggested_match) {
          next.set(p.xref, { action: 'merge', mergeWithId: p.suggested_match.id })
        } else if (action === 'create') {
          next.set(p.xref, { action: 'create', mergeWithId: null })
        }
      }
      return next
    })
  }

  // ── Confirm import ─────────────────────────────────────────────────────────

  async function handleConfirm() {
    if (!preview) return
    setPhase('importing')
    const decisionList: GedcomImportDecision[] = preview.persons.map(p => {
      const d = decisions.get(p.xref) ?? { action: 'create', mergeWithId: null }
      return { xref: p.xref, action: d.action, merge_with_id: d.mergeWithId }
    })
    try {
      const result = await api.project.confirmGedcomImport(preview.token, decisionList)
      setStats(result)
      setPhase('done')
      onDone()
    } catch (e) {
      setErrorMsg(String(e))
      setPhase('error')
    }
  }

  // ── Summary counts ─────────────────────────────────────────────────────────

  const decisionCounts = preview ? (() => {
    let creates = 0, merges = 0, skips = 0
    for (const [, d] of decisions) {
      if (d.action === 'create')     creates++
      else if (d.action === 'merge') merges++
      else                           skips++
    }
    return { creates, merges, skips }
  })() : null

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col"
        style={{ width: phase === 'preview' ? '820px' : '420px', maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >

        {/* ── Upload phase ─────────────────────────────────────────────── */}
        {phase === 'upload' && (
          <div className="p-6">
            <h2 className="text-sm font-semibold text-zinc-100 mb-1">GEDCOM importálás</h2>
            <p className="text-xs text-zinc-500 mb-5">Tölts fel egy <code>.ged</code> vagy <code>.zip</code> fájlt (pl. Mnemosyne GEDCOM export vagy más genealógia szoftver exportja).</p>

            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
                ${dragging ? 'border-brand-400 bg-brand-400/5' : 'border-zinc-700 hover:border-zinc-500'}`}
            >
              <div className="text-3xl mb-3">📂</div>
              <p className="text-sm text-zinc-300">Húzd ide a fájlt, vagy kattints a böngészéshez</p>
              <p className="text-xs text-zinc-600 mt-1">.ged · .zip</p>
              <input ref={inputRef} type="file" accept=".ged,.zip" className="hidden" onChange={onInputChange} />
            </div>

            <div className="flex justify-end mt-4">
              <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors">
                Mégse
              </button>
            </div>
          </div>
        )}

        {/* ── Importing / loading ───────────────────────────────────────── */}
        {phase === 'importing' && (
          <div className="p-10 flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-zinc-400">Feldolgozás…</p>
          </div>
        )}

        {/* ── Error ────────────────────────────────────────────────────── */}
        {phase === 'error' && (
          <div className="p-6">
            <h2 className="text-sm font-semibold text-red-400 mb-2">Hiba</h2>
            <p className="text-xs text-zinc-400 mb-4 font-mono whitespace-pre-wrap">{errorMsg}</p>
            <div className="flex gap-3">
              <button onClick={() => setPhase('upload')} className="flex-1 px-4 py-2 text-sm text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors">
                Vissza
              </button>
              <button onClick={onClose} className="flex-1 px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 rounded-lg transition-colors">
                Bezárás
              </button>
            </div>
          </div>
        )}

        {/* ── Done ─────────────────────────────────────────────────────── */}
        {phase === 'done' && stats && (
          <div className="p-6">
            <h2 className="text-sm font-semibold text-zinc-100 mb-4">Importálás kész</h2>
            <StatsSummary stats={stats} />
            <button
              onClick={onClose}
              className="mt-6 w-full px-4 py-2 text-sm font-medium text-white bg-brand-500 hover:bg-brand-400 rounded-lg transition-colors"
            >
              Bezárás
            </button>
          </div>
        )}

        {/* ── Preview phase ─────────────────────────────────────────────── */}
        {phase === 'preview' && preview && (
          <>
            {/* Header */}
            <div className="px-5 pt-5 pb-3 border-b border-zinc-800 shrink-0">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-100">Import előnézet</h2>
                <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg leading-none">×</button>
              </div>
              {/* Stats chips */}
              <div className="flex flex-wrap gap-2 mt-2">
                {([
                  `${preview.persons.length} személy`,
                  `${preview.relations_count} kapcsolat`,
                  preview.events_count    > 0 ? `${preview.events_count} esemény`       : null,
                  preview.sources_count   > 0 ? `${preview.sources_count} forrás`       : null,
                  preview.documents_count > 0 ? `${preview.documents_count} dokumentum` : null,
                ] as (string | null)[]).filter((x): x is string => x !== null).map(label => (
                  <span key={label} className="text-[11px] px-2 py-0.5 bg-zinc-800 text-zinc-400 rounded-full">{label}</span>
                ))}
              </div>
              {/* Quick-apply buttons */}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => applyAll('merge')}
                  className="text-[11px] px-2.5 py-1 bg-emerald-900/40 text-emerald-300 hover:bg-emerald-900/60 rounded-lg transition-colors"
                >
                  Összes egyezőt merge-elj
                </button>
                <button
                  onClick={() => applyAll('create')}
                  className="text-[11px] px-2.5 py-1 bg-zinc-800 text-zinc-400 hover:bg-zinc-700 rounded-lg transition-colors"
                >
                  Mindenkit újként
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-y-auto flex-1 min-h-0">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800 z-10">
                  <tr>
                    <th className="py-2 px-3 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">Importált személy</th>
                    <th className="py-2 px-2 text-[11px] font-medium text-zinc-500 uppercase tracking-wide text-center w-20">Egyezés</th>
                    <th className="py-2 px-3 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">Döntés</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.persons.map(p => {
                    const d = decisions.get(p.xref) ?? { action: p.action as GedcomImportAction, mergeWithId: p.merge_with_id }
                    return (
                      <PersonRow
                        key={p.xref}
                        person={p}
                        action={d.action}
                        mergeWithId={d.mergeWithId}
                        existingPersons={sortedPersons}
                        parentsOf={parentsOf}
                        spousesOf={spousesOf}
                        onChange={(action, mergeWithId) => setDecision(p.xref, action, mergeWithId)}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-zinc-800 shrink-0">
              {decisionCounts && (
                <p className="text-xs text-zinc-500 mb-3">
                  {decisionCounts.creates > 0 && <span className="mr-3 text-brand-300">{decisionCounts.creates} új</span>}
                  {decisionCounts.merges  > 0 && <span className="mr-3 text-emerald-300">{decisionCounts.merges} merge</span>}
                  {decisionCounts.skips   > 0 && <span className="text-zinc-600">{decisionCounts.skips} kihagyva</span>}
                </p>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setPhase('upload')}
                  className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                >
                  ← Vissza
                </button>
                <button
                  onClick={handleConfirm}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-brand-500 hover:bg-brand-400 rounded-lg transition-colors"
                >
                  Importálás megerősítése
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

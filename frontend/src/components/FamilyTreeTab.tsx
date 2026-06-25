import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { PersonFull, Relation } from '../types'
import TreeView from './TreeView'
import PersonPanel from './PersonPanel'

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string | null) {
  if (!name) return '?'
  return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function lifespan(p: PersonFull) {
  if (!p.birth_year && !p.death_year) return null
  const b = p.birth_year ?? '?'
  const d = p.death_year ?? ''
  return p.death_year ? `${b}–${d}` : `* ${b}`
}

// ── Connected components ──────────────────────────────────────────────────────

interface FamilyGroup {
  key: string
  persons: PersonFull[]
  autoName: string
}

function computeGroups(persons: PersonFull[], relations: Relation[]): FamilyGroup[] {
  if (!persons.length) return []
  const adj = new Map<number, Set<number>>()
  const byId = new Map(persons.map(p => [p.id, p]))
  for (const p of persons) adj.set(p.id, new Set())
  for (const r of relations) {
    adj.get(r.person_a_id)?.add(r.person_b_id)
    adj.get(r.person_b_id)?.add(r.person_a_id)
  }
  const visited = new Set<number>()
  const groups: FamilyGroup[] = []
  for (const p of persons) {
    if (visited.has(p.id)) continue
    const members: PersonFull[] = []
    const q = [p.id]
    while (q.length) {
      const id = q.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      const person = byId.get(id)
      if (person) members.push(person)
      for (const nid of adj.get(id) ?? []) {
        if (!visited.has(nid)) q.push(nid)
      }
    }
    if (!members.length) continue
    const key = String(Math.min(...members.map(m => m.id)))
    const top = [...members].sort((a, b) => b.face_count - a.face_count).slice(0, 2)
    const autoName = top.map(m => m.name?.split(' ')[0] ?? '?').join(' & ')
    groups.push({ key, persons: members, autoName })
  }
  // Skip single-person groups — they appear only in "All"
  return groups.filter(g => g.persons.length >= 2).sort((a, b) => b.persons.length - a.persons.length)
}

// ── FamilyDropdown ────────────────────────────────────────────────────────────

function FamilyDropdown({
  groups, groupNames, selectedKey, allCount,
  onSelect, onRename,
}: {
  groups: FamilyGroup[]
  groupNames: Record<string, string>
  selectedKey: string | null
  allCount: number
  onSelect: (key: string | null) => void
  onRename: (key: string, name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) { setOpen(false); setRenamingKey(null) }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  const selectedGroup = selectedKey ? groups.find(g => g.key === selectedKey) : null
  const currentLabel = selectedGroup
    ? (groupNames[selectedGroup.key] ?? selectedGroup.autoName)
    : 'All'

  if (!groups.length) return null

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className={`h-7 pl-3 pr-2 flex items-center gap-1.5 rounded-full text-xs font-medium border transition-colors ${open ? 'bg-zinc-700 border-zinc-600 text-zinc-100' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700'}`}
      >
        <span className="max-w-[140px] truncate">{currentLabel}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl z-30 overflow-hidden" style={{ minWidth: 200 }}>

          {/* All */}
          <button
            onClick={() => { onSelect(null); setOpen(false) }}
            className={`w-full flex items-center justify-between px-3.5 py-2 text-left text-sm hover:bg-zinc-700 transition-colors ${!selectedKey ? 'text-brand-300 font-medium' : 'text-zinc-200'}`}
          >
            <span>All</span>
            <span className="text-xs text-zinc-500 tabular-nums ml-3">{allCount}</span>
          </button>

          {groups.length > 0 && <div className="h-px bg-zinc-700/50 mx-2" />}

          {groups.map(g => {
            const name = groupNames[g.key] ?? g.autoName
            return (
              <div key={g.key} className="flex items-center group/row">
                {renamingKey === g.key ? (
                  <div className="flex-1 px-3 py-1.5">
                    <input
                      autoFocus
                      value={renameVal}
                      onChange={e => setRenameVal(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { onRename(g.key, renameVal.trim() || name); setRenamingKey(null) }
                        if (e.key === 'Escape') setRenamingKey(null)
                      }}
                      onBlur={() => { onRename(g.key, renameVal.trim() || name); setRenamingKey(null) }}
                      className="w-full bg-zinc-700 border border-brand-400/60 rounded-lg px-2.5 py-1 text-sm text-zinc-100 outline-none"
                    />
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => { onSelect(g.key); setOpen(false) }}
                      className={`flex-1 flex items-center justify-between px-3.5 py-2 text-left text-sm hover:bg-zinc-700 transition-colors ${selectedKey === g.key ? 'text-brand-300 font-medium' : 'text-zinc-200'}`}
                    >
                      <span className="truncate max-w-[130px]">{name}</span>
                      <span className="text-xs text-zinc-500 tabular-nums ml-3 shrink-0">{g.persons.length}</span>
                    </button>
                    <button
                      onClick={() => { setRenamingKey(g.key); setRenameVal(name) }}
                      className="pr-3 py-2 opacity-0 group-hover/row:opacity-100 text-zinc-500 hover:text-zinc-200 transition-opacity text-xs shrink-0"
                      title="Rename"
                    >✎</button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── PersonAvatar ──────────────────────────────────────────────────────────────

function PersonAvatar({ person, size = 36 }: { person: PersonFull; size?: number }) {
  const [err, setErr] = useState(false)
  if (person.thumbnail_face_id && !err) {
    return (
      <img
        src={api.faceThumbnailUrl(person.thumbnail_face_id, size * 2)}
        alt=""
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
        onError={() => setErr(true)}
      />
    )
  }
  return (
    <div
      className="rounded-full bg-zinc-700 flex items-center justify-center shrink-0 text-zinc-300 font-semibold"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials(person.name)}
    </div>
  )
}

// ── NewPersonModal ────────────────────────────────────────────────────────────

function NewPersonModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: PersonFull) => void }) {
  const [name, setName] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [deathYear, setDeathYear] = useState('')
  const qc = useQueryClient()
  const mut = useMutation({
    mutationFn: () => api.persons.create(name.trim(), birthYear ? parseInt(birthYear) : null, deathYear ? parseInt(deathYear) : null),
    onSuccess: p => { qc.invalidateQueries({ queryKey: ['persons'] }); onCreated(p) },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-80 p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-zinc-100 mb-4">Add new person</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Name *</label>
            <input autoFocus value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && name.trim() && mut.mutate()}
              placeholder="e.g. Jane Doe"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-zinc-400 mb-1">Birth year</label>
              <input type="number" value={birthYear} onChange={e => setBirthYear(e.target.value)} placeholder="1945"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-zinc-400 mb-1">Death year</label>
              <input type="number" value={deathYear} onChange={e => setDeathYear(e.target.value)} placeholder="2010"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400" />
            </div>
          </div>
        </div>
        {mut.error && <p className="mt-2 text-xs text-red-400">{String(mut.error)}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-800 rounded-lg transition-colors">Cancel</button>
          <button onClick={() => mut.mutate()} disabled={!name.trim() || mut.isPending}
            className="flex-1 px-3 py-2 text-sm font-medium bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white rounded-lg transition-colors">
            {mut.isPending ? 'Saving...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── FamilyTreeTab ─────────────────────────────────────────────────────────────

export default function FamilyTreeTab() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null)
  const [groupNames, setGroupNames] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('mnemosyne_group_names') ?? '{}') }
    catch { return {} }
  })
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [search, setSearch] = useState('')
  const [showOnlyUnlinked, setShowOnlyUnlinked] = useState(false)

  const { data: persons = [], isLoading } = useQuery({ queryKey: ['persons'], queryFn: api.persons.list })
  const { data: relations = [] } = useQuery({ queryKey: ['relations'], queryFn: api.relations.list })

  const groups = useMemo(() => computeGroups(persons, relations), [persons, relations])

  // IDs that have at least one relation
  const linkedIds = useMemo(() => {
    const ids = new Set<number>()
    for (const r of relations) { ids.add(r.person_a_id); ids.add(r.person_b_id) }
    return ids
  }, [relations])

  const activeGroup = selectedGroupKey ? groups.find(g => g.key === selectedGroupKey) ?? null : null
  const displayPersons = activeGroup ? activeGroup.persons : persons
  const displayRelations = useMemo(() => {
    if (!activeGroup) return relations
    const ids = new Set(activeGroup.persons.map(p => p.id))
    return relations.filter(r => ids.has(r.person_a_id) && ids.has(r.person_b_id))
  }, [activeGroup, relations])

  // Sidebar list: search + optional unlinked filter
  const sidebarPersons = (selectedGroupKey ? displayPersons : persons)
    .filter(p => !showOnlyUnlinked || !linkedIds.has(p.id))
    .filter(p => (p.name ?? '').toLowerCase().includes(search.toLowerCase()))

  const selected = persons.find(p => p.id === selectedId) ?? null

  function renameGroup(key: string, name: string) {
    const next = { ...groupNames, [key]: name }
    setGroupNames(next)
    localStorage.setItem('mnemosyne_group_names', JSON.stringify(next))
  }

  const unlinkedCount = persons.filter(p => !linkedIds.has(p.id)).length

  return (
    <div className="h-full flex flex-col bg-zinc-950">

      {/* ── Toolbar ── */}
      <div className="shrink-0 h-11 flex items-center gap-2 px-3 bg-zinc-900 border-b border-zinc-800">

        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(o => !o)}
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors shrink-0 ${sidebarOpen ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800'}`}
          title="Person list"
        >
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
            <rect x="0" y="0" width="16" height="2" rx="1" fill="currentColor"/>
            <rect x="0" y="5" width="16" height="2" rx="1" fill="currentColor"/>
            <rect x="0" y="10" width="16" height="2" rx="1" fill="currentColor"/>
          </svg>
        </button>

        {/* New person */}
        <button
          onClick={() => setShowNew(true)}
          className="h-7 px-3 text-xs font-medium bg-brand-500 hover:bg-brand-600 text-white rounded-full transition-colors shrink-0"
        >+ New person</button>

        {/* Family dropdown — only if there are multi-person groups */}
        {groups.length > 0 && (
          <>
            <div className="w-px h-5 bg-zinc-700 shrink-0" />
            <FamilyDropdown
              groups={groups}
              groupNames={groupNames}
              selectedKey={selectedGroupKey}
              allCount={persons.length}
              onSelect={key => { setSelectedGroupKey(key); setSelectedId(null) }}
              onRename={renameGroup}
            />
          </>
        )}

        {/* Stats */}
        <div className="ml-auto text-xs text-zinc-600 shrink-0 tabular-nums">
          {displayPersons.length} persons · {displayRelations.length} relations
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex flex-1 min-h-0">

        {/* Sidebar */}
        <div className={`bg-zinc-900 border-r border-zinc-800 flex flex-col overflow-hidden transition-all duration-300 shrink-0 ${sidebarOpen ? 'w-56' : 'w-0'}`}>
          <div className="p-2 border-b border-zinc-800 space-y-1.5">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400"
            />
            {/* Unlinked filter — always show if unlinked persons exist */}
            {!selectedGroupKey && unlinkedCount > 0 && (
              <button
                onClick={() => setShowOnlyUnlinked(o => !o)}
                className={`w-full flex items-center justify-between px-2.5 py-1 rounded-lg text-xs transition-colors ${showOnlyUnlinked ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300 border border-zinc-700'}`}
              >
                <span>No relations</span>
                <span className="tabular-nums">{unlinkedCount}</span>
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading && <p className="px-4 py-6 text-center text-zinc-500 text-sm">Loading...</p>}
            {!isLoading && sidebarPersons.length === 0 && (
              <p className="px-4 py-6 text-center text-zinc-500 text-sm">
                {search || showOnlyUnlinked ? 'No results' : 'No persons'}
              </p>
            )}
            {sidebarPersons.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${selectedId === p.id ? 'bg-zinc-700' : 'hover:bg-zinc-800'}`}
              >
                <PersonAvatar person={p} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-zinc-100 truncate font-medium">{p.name ?? '(unnamed)'}</div>
                  <div className="text-xs text-zinc-500 truncate">{lifespan(p) ?? (p.face_count > 0 ? `${p.face_count} photos` : 'No photos')}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Tree + panel */}
        <div className="flex-1 relative min-w-0 overflow-hidden">
          {displayPersons.length === 0 && !isLoading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
              <div className="text-5xl opacity-15">🌳</div>
              <p className="text-zinc-500 text-sm">No persons yet</p>
              <button onClick={() => setShowNew(true)}
                className="px-4 py-2 text-sm bg-brand-500 hover:bg-brand-600 text-white rounded-lg transition-colors">
                + Add new person
              </button>
            </div>
          ) : (
            <TreeView
              persons={displayPersons}
              relations={displayRelations}
              selectedId={selectedId}
              onSelect={id => setSelectedId(id)}
              panelOpen={!!selectedId}
            />
          )}

          {selectedId && selected && (
            <PersonPanel
              key={selectedId}
              person={selected}
              persons={persons}
              relations={relations}
              onClose={() => setSelectedId(null)}
              onNavigateTo={id => setSelectedId(id)}
            />
          )}
        </div>
      </div>

      {showNew && (
        <NewPersonModal
          onClose={() => setShowNew(false)}
          onCreated={p => { setShowNew(false); setSelectedId(p.id) }}
        />
      )}
    </div>
  )
}

import { useState, useRef, useEffect, forwardRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { PersonDocument, PersonFull, DocumentType, Relation } from '../types'
import DocumentViewer from './DocumentViewer'

// ── helpers ───────────────────────────────────────────────────────────────────

function isImage(mime: string | null) { return mime?.startsWith('image/') ?? false }
function isPdf(mime: string | null)   { return mime === 'application/pdf' }
function isAudio(mime: string | null) { return mime?.startsWith('audio/') ?? false }

// One-line biographical summary used in person pickers to help distinguish
// persons with identical names.
function personSummary(p: PersonFull): string | null {
  const by = p.birth_date ? p.birth_date.slice(0, 4) : p.birth_year != null ? String(p.birth_year) : null
  const dy = p.death_date ? p.death_date.slice(0, 4) : p.death_year != null ? String(p.death_year) : null
  const parts: string[] = []
  if (by && dy)   parts.push(`${by}–${dy}`)
  else if (by)    parts.push(`* ${by}`)
  else if (dy)    parts.push(`† ${dy}`)
  if (p.birth_place) parts.push(p.birth_place)
  if (p.occupation)  parts.push(p.occupation)
  return parts.length > 0 ? parts.join(' · ') : null
}

function fileIcon(mime: string | null) {
  if (isImage(mime)) return (
    <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 8.25V18a2.25 2.25 0 002.25 2.25h13.5A2.25 2.25 0 0021 18V8.25"/>
    </svg>
  )
  if (isPdf(mime)) return (
    <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
    </svg>
  )
  if (isAudio(mime)) return (
    <svg className="w-5 h-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z"/>
    </svg>
  )
  return (
    <svg className="w-5 h-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
    </svg>
  )
}

// ── PersonCombobox ────────────────────────────────────────────────────────────

function PersonCombobox({ persons, value, onChange }: {
  persons: PersonFull[]
  value: number | null
  onChange: (id: number | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const selected = persons.find(p => p.id === value)

  const filtered = !search.trim()
    ? persons
    : persons.filter(p => {
        const q = search.toLowerCase()
        return (p.name ?? '').toLowerCase().includes(q)
          || (p.first_name ?? '').toLowerCase().includes(q)
          || (p.last_name ?? '').toLowerCase().includes(q)
      })

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

  const select = (id: number | null) => {
    onChange(id)
    setOpen(false)
    setSearch('')
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs outline-none hover:border-zinc-600 focus:border-brand-400 min-w-[140px] max-w-[180px]"
      >
        <span className={selected ? 'text-zinc-100 truncate' : 'text-zinc-500'}>
          {selected ? (selected.name ?? '(unnamed)') : 'All persons'}
        </span>
        <svg className={`w-3 h-3 text-zinc-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-2 py-2 border-b border-zinc-800">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search persons…"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400"
            />
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            <button
              onClick={() => select(null)}
              className={`w-full px-3 py-1.5 text-xs text-left hover:bg-zinc-800 transition-colors ${value === null ? 'text-brand-300' : 'text-zinc-400'}`}
            >
              All persons
            </button>
            {filtered.map(p => {
              const sum = personSummary(p)
              return (
                <button key={p.id} onClick={() => select(p.id)}
                  className={`w-full px-3 py-1.5 text-xs text-left flex flex-col hover:bg-zinc-800 transition-colors ${value === p.id ? 'text-brand-300' : 'text-zinc-100'}`}
                >
                  <span>{p.name ?? '(unnamed)'}</span>
                  {sum && <span className="text-[10px] text-zinc-500 leading-tight">{sum}</span>}
                </button>
              )
            })}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-zinc-600 italic">No results</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── PersonChip ────────────────────────────────────────────────────────────────

function PersonChip({ person, onClick }: { person: { id: number; name: string | null }; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-700/60 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 text-[10px] transition-colors"
    >
      {person.name ?? '(unnamed)'}
    </button>
  )
}

// ── TypeManagerModal ──────────────────────────────────────────────────────────

function TypeManagerModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { data: types = [] } = useQuery<DocumentType[]>({ queryKey: ['doc-types'], queryFn: api.documentTypes.list })
  const [newKey, setNewKey] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editLabel, setEditLabel] = useState('')

  const createMut = useMutation({
    mutationFn: () => api.documentTypes.create(
      newKey.trim().toLowerCase().replace(/\s+/g, '_'),
      newLabel.trim()
    ),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['doc-types'] }); setNewKey(''); setNewLabel('') },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, label }: { id: number; label: string }) => api.documentTypes.update(id, { label }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['doc-types'] }); setEditingId(null) },
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.documentTypes.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doc-types'] }),
  })

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl overflow-hidden w-[420px] max-w-[92vw] max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-800 shrink-0">
          <div>
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-0.5">Documents</p>
            <h2 className="text-sm font-semibold text-zinc-100">Manage Types</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M6 6l12 12M6 18L18 6"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Existing types */}
          <ul className="divide-y divide-zinc-800">
            {types.map(t => (
              <li key={t.id} className="flex items-center gap-3 px-5 py-2.5 group">
                <code className="text-[10px] text-zinc-600 font-mono min-w-[100px] shrink-0">{t.key}</code>
                {editingId === t.id ? (
                  <input
                    autoFocus
                    value={editLabel}
                    onChange={e => setEditLabel(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') updateMut.mutate({ id: t.id, label: editLabel })
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="flex-1 bg-zinc-700 border border-zinc-500 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-brand-400"
                  />
                ) : (
                  <span className="flex-1 text-xs text-zinc-200">{t.label}</span>
                )}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  {editingId === t.id ? (
                    <>
                      <button onClick={() => updateMut.mutate({ id: t.id, label: editLabel })}
                        className="text-[10px] px-2 py-0.5 bg-brand-600 hover:bg-brand-500 text-white rounded transition-colors">Save</button>
                      <button onClick={() => setEditingId(null)}
                        className="text-[10px] px-2 py-0.5 bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded transition-colors">Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setEditingId(t.id); setEditLabel(t.label) }}
                        className="w-6 h-6 rounded flex items-center justify-center text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700 transition-colors">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2.25 2.25 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2.414a2 2 0 01.586-1.414z"/></svg>
                      </button>
                      <button onClick={() => { if (confirm(`Delete type "${t.label}"?`)) deleteMut.mutate(t.id) }}
                        className="w-6 h-6 rounded flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-zinc-700 transition-colors">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12"/></svg>
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {/* Add new type */}
          <div className="px-5 py-4 border-t border-zinc-800">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2.5">Add new type</p>
            <div className="flex gap-2">
              <input
                value={newKey}
                onChange={e => setNewKey(e.target.value)}
                placeholder="key (e.g. invoice)"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400 font-mono"
              />
              <input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="Label (e.g. Invoice)"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400"
                onKeyDown={e => { if (e.key === 'Enter' && newKey && newLabel) createMut.mutate() }}
              />
              <button
                onClick={() => createMut.mutate()}
                disabled={!newKey.trim() || !newLabel.trim() || createMut.isPending}
                className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors shrink-0"
              >Add</button>
            </div>
            {createMut.isError && (
              <p className="text-[10px] text-red-400 mt-1.5">{String(createMut.error)}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── UploadModal ───────────────────────────────────────────────────────────────

function UploadModal({ persons, types, onClose, onDone }: {
  persons: PersonFull[]
  types: DocumentType[]
  onClose: () => void
  onDone: () => void
}) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [docType, setDocType] = useState(types[0]?.key ?? 'other')
  const [year, setYear] = useState('')
  const [description, setDescription] = useState('')
  const [selectedPersonIds, setSelectedPersonIds] = useState<number[]>([])
  const [personSearch, setPersonSearch] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const filteredPersons = persons.filter(p =>
    !personSearch || (p.name ?? '').toLowerCase().includes(personSearch.toLowerCase())
  )

  const togglePerson = (id: number) =>
    setSelectedPersonIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])

  async function submit() {
    if (!file || selectedPersonIds.length === 0 || uploading) return
    setUploading(true); setErr(null)
    try {
      // Upload using first person as primary; link additional persons via junction
      const [firstId, ...restIds] = selectedPersonIds
      const doc = await api.documents.upload(firstId, file, {
        title: title.trim() || undefined,
        doc_type: docType || undefined,
        year: year ? parseInt(year) : undefined,
        description: description.trim() || undefined,
      })
      await Promise.all(restIds.map(pid => api.documents.linkPerson(doc.id, pid)))
      qc.invalidateQueries({ queryKey: ['docs-all'] })
      for (const pid of selectedPersonIds) qc.invalidateQueries({ queryKey: ['person-docs', pid] })
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed')
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl overflow-hidden w-[480px] max-w-[92vw] max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-800 shrink-0">
          <div>
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-0.5">Documents</p>
            <h2 className="text-sm font-semibold text-zinc-100">Upload document</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M6 6l12 12M6 18L18 6"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) setFile(f) }}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl px-4 py-5 text-center cursor-pointer transition-colors ${dragOver ? 'border-brand-400 bg-brand-500/10' : 'border-zinc-700 hover:border-zinc-500'}`}
          >
            <input ref={fileRef} type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            {file ? (
              <div className="flex items-center justify-center gap-2">
                {fileIcon(file.type)}
                <span className="text-xs text-zinc-200 truncate max-w-xs">{file.name}</span>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">Drag here or <span className="text-brand-400">click</span> to select a file</p>
            )}
          </div>

          {/* Metadata */}
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (optional)"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400" />

          <div className="flex gap-2">
            <select value={docType} onChange={e => setDocType(e.target.value)}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 outline-none focus:border-brand-400">
              {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              {types.length === 0 && <option value="other">Document</option>}
            </select>
            <input type="number" value={year} onChange={e => setYear(e.target.value)} placeholder="Year"
              className="w-24 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400" />
          </div>

          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)"
            rows={2}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400 resize-none" />

          {/* Person selection */}
          <div>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">Linked persons</p>
            {selectedPersonIds.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {selectedPersonIds.map(pid => {
                  const p = persons.find(x => x.id === pid)
                  return (
                    <span key={pid} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-800/60 border border-brand-600/50 text-brand-300 text-[10px]">
                      {p?.name ?? '(unnamed)'}
                      <button onClick={() => togglePerson(pid)} className="hover:text-white">×</button>
                    </span>
                  )
                })}
              </div>
            )}
            <input value={personSearch} onChange={e => setPersonSearch(e.target.value)} placeholder="Search persons…"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400 mb-1" />
            <div className="max-h-40 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800/40">
              {filteredPersons.slice(0, 50).map(p => {
                const selected = selectedPersonIds.includes(p.id)
                const bio = personSummary(p)
                return (
                  <button key={p.id} onClick={() => togglePerson(p.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left ${selected ? 'bg-brand-800/50 text-brand-200' : 'text-zinc-300 hover:bg-zinc-700/60'}`}>
                    <span className={`w-3 h-3 rounded-sm border shrink-0 flex items-center justify-center mt-0.5 ${selected ? 'bg-brand-500 border-brand-400' : 'border-zinc-600'}`}>
                      {selected && <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 12 12"><path d="M10 3L5 8.5 2 5.5"/></svg>}
                    </span>
                    <span className="flex flex-col min-w-0">
                      <span className="truncate">{p.name ?? '(unnamed)'}</span>
                      {bio && <span className={`text-[10px] truncate ${selected ? 'text-brand-400/70' : 'text-zinc-500'}`}>{bio}</span>}
                    </span>
                  </button>
                )
              })}
              {filteredPersons.length === 0 && <p className="px-3 py-2 text-xs text-zinc-600">No persons found</p>}
            </div>
            {selectedPersonIds.length === 0 && (
              <p className="text-[10px] text-zinc-600 mt-1">Select at least one person</p>
            )}
          </div>

          {err && <p className="text-xs text-red-400 bg-red-950/50 border border-red-900/50 rounded-lg px-3 py-2">{err}</p>}
        </div>

        <div className="shrink-0 px-5 py-4 border-t border-zinc-800 flex gap-2">
          <button onClick={submit} disabled={!file || selectedPersonIds.length === 0 || uploading}
            className="flex-1 h-9 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2">
            {uploading ? (
              <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>Uploading…</>
            ) : 'Upload'}
          </button>
          <button onClick={onClose} className="px-4 h-9 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── EditDocModal ──────────────────────────────────────────────────────────────

function EditDocModal({ doc, types, persons, onClose }: {
  doc: PersonDocument
  types: DocumentType[]
  persons: PersonFull[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [title, setTitle]           = useState(doc.title ?? '')
  const [docType, setDocType]       = useState(doc.doc_type ?? 'other')
  const [year, setYear]             = useState(doc.year ? String(doc.year) : '')
  const [description, setDescription] = useState(doc.description ?? '')
  const [personSearch, setPersonSearch] = useState('')
  const [linkedIds, setLinkedIds]   = useState(() => new Set(doc.persons.map(p => p.id)))
  const [saving, setSaving]         = useState(false)
  const [hoveredPid, setHoveredPid] = useState<{ pid: number; rect: DOMRect } | null>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const { data: relations = [] } = useQuery<Relation[]>({ queryKey: ['relations'], queryFn: api.relations.list })

  const familyMap = useMemo(() => {
    type FE = { spouses: string[]; parents: string[]; children: string[] }
    const map = new Map<number, FE>()
    const byId = new Map(persons.map(p => [p.id, p]))
    const name = (id: number) => byId.get(id)?.name ?? null
    const entry = (id: number): FE => { if (!map.has(id)) map.set(id, { spouses: [], parents: [], children: [] }); return map.get(id)! }
    for (const r of relations) {
      if (r.type === 'spouse') {
        const nB = name(r.person_b_id); const nA = name(r.person_a_id)
        if (nB) entry(r.person_a_id).spouses.push(nB)
        if (nA) entry(r.person_b_id).spouses.push(nA)
      } else if (r.type === 'parent') {
        const nP = name(r.person_a_id); const nC = name(r.person_b_id)
        if (nP) entry(r.person_b_id).parents.push(nP)
        if (nC) entry(r.person_a_id).children.push(nC)
      }
    }
    return map
  }, [relations, persons])

  async function togglePerson(personId: number) {
    const wasLinked = linkedIds.has(personId)
    setLinkedIds(prev => { const s = new Set(prev); wasLinked ? s.delete(personId) : s.add(personId); return s })
    try {
      if (wasLinked) await api.documents.unlinkPerson(doc.id, personId)
      else           await api.documents.linkPerson(doc.id, personId)
      qc.invalidateQueries({ queryKey: ['docs-all'] })
      qc.invalidateQueries({ queryKey: ['person-docs', personId] })
    } catch {
      // revert on failure
      setLinkedIds(prev => { const s = new Set(prev); wasLinked ? s.add(personId) : s.delete(personId); return s })
    }
  }

  async function save() {
    setSaving(true)
    try {
      await api.documents.update(doc.id, {
        title: title.trim() || null,
        doc_type: docType,
        year: year ? parseInt(year) : null,
        description: description.trim() || null,
      })
      qc.invalidateQueries({ queryKey: ['docs-all'] })
      for (const pid of linkedIds) qc.invalidateQueries({ queryKey: ['person-docs', pid] })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const filteredPersons = personSearch
    ? persons.filter(p => (p.name ?? '').toLowerCase().includes(personSearch.toLowerCase()))
    : persons

  const familyTooltip = hoveredPid && (() => {
    const fam = familyMap.get(hoveredPid.pid)
    if (!fam || (!fam.spouses.length && !fam.parents.length && !fam.children.length)) return null
    const r = hoveredPid.rect
    const tooltipW = 208
    const left = r.right + 10 + tooltipW > window.innerWidth ? r.left - tooltipW - 10 : r.right + 10
    const top = Math.min(r.top, window.innerHeight - 140)
    return createPortal(
      <div style={{ position: 'fixed', top, left, zIndex: 800, width: tooltipW }}
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-3 pointer-events-none">
        {fam.spouses.length > 0 && (
          <p className="text-[10px] text-brand-400 truncate mb-0.5">♥ {fam.spouses.join(', ')}</p>
        )}
        {fam.parents.length > 0 && (
          <p className="text-[10px] text-zinc-500 truncate mb-0.5">↑ {fam.parents.join(', ')}</p>
        )}
        {fam.children.length > 0 && (
          <p className="text-[10px] text-zinc-500 truncate">
            ↓ {fam.children.length <= 3 ? fam.children.join(', ') : `${fam.children[0]}, ${fam.children[1]} +${fam.children.length - 2}`}
          </p>
        )}
      </div>,
      document.body
    )
  })()

  return (
    <>
    <div className="fixed inset-0 z-[650] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl w-[480px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-zinc-800 shrink-0">
          <div className="min-w-0 flex-1 pr-3">
            <h2 className="text-sm font-semibold text-zinc-100">Edit document</h2>
            <p className="text-[10px] text-zinc-500 mt-0.5 truncate">{doc.title || doc.filename}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M6 6l12 12M6 18L18 6"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (optional)"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400" />

          <div className="flex gap-2">
            <select value={docType} onChange={e => setDocType(e.target.value)}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 outline-none focus:border-brand-400">
              {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              {types.length === 0 && <option value="other">Document</option>}
            </select>
            <input type="number" value={year} onChange={e => setYear(e.target.value)} placeholder="Year"
              className="w-24 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400" />
          </div>

          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" rows={2}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400 resize-none" />

          <div>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">Linked persons</p>
            <input value={personSearch} onChange={e => setPersonSearch(e.target.value)} placeholder="Search persons…"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400 mb-1" />
            <div className="max-h-44 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800/40">
              {filteredPersons.slice(0, 100).map(p => {
                const linked = linkedIds.has(p.id)
                const bio = personSummary(p)
                return (
                  <button key={p.id} onClick={() => togglePerson(p.id)}
                    onMouseEnter={e => setHoveredPid({ pid: p.id, rect: e.currentTarget.getBoundingClientRect() })}
                    onMouseLeave={() => setHoveredPid(null)}
                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-xs transition-colors text-left ${linked ? 'bg-brand-900/40 text-brand-200' : 'text-zinc-300 hover:bg-zinc-800'}`}>
                    <span className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center mt-0.5 ${linked ? 'bg-brand-500 border-brand-400' : 'border-zinc-600'}`}>
                      {linked && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 10" stroke="currentColor" strokeWidth={2}><path d="M1 5l3 3 7-7"/></svg>}
                    </span>
                    <span className="flex flex-col min-w-0">
                      <span className="truncate">{p.name ?? '(unnamed)'}</span>
                      {bio && <span className={`text-[10px] truncate ${linked ? 'text-brand-400/70' : 'text-zinc-500'}`}>{bio}</span>}
                    </span>
                  </button>
                )
              })}
              {filteredPersons.length === 0 && <p className="px-3 py-2 text-xs text-zinc-600">No persons found</p>}
            </div>
          </div>
        </div>

        <div className="shrink-0 px-5 py-3 border-t border-zinc-800 flex gap-2">
          <button onClick={save} disabled={saving}
            className="flex-1 h-9 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm font-medium transition-colors">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose} className="px-4 h-9 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
    {familyTooltip}
    </>
  )
}

// ── DocRow ────────────────────────────────────────────────────────────────────

const DocRow = forwardRef<HTMLTableRowElement, {
  doc: PersonDocument
  typeMap: Map<string, string>
  persons: PersonFull[]
  onNavToGenealogy: (id: number) => void
  onEdit: () => void
  highlighted?: boolean
  selected?: boolean
  onToggleSelect?: () => void
}>(function DocRow({ doc, typeMap, persons: _persons, onNavToGenealogy, onEdit, highlighted, selected, onToggleSelect }, ref) {
  const qc = useQueryClient()
  const [previewing, setPreviewing] = useState(false)
  const displayName = doc.title || doc.filename
  const typeLabel = typeMap.get(doc.doc_type ?? '') ?? doc.doc_type ?? 'Document'
  const canPreview = isImage(doc.mime_type) || isPdf(doc.mime_type) || isAudio(doc.mime_type)

  const deleteMut = useMutation({
    mutationFn: () => api.documents.delete(doc.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['docs-all'] })
      for (const p of doc.persons) qc.invalidateQueries({ queryKey: ['person-docs', p.id] })
    },
  })

  return (
    <>
      {previewing && (
        <DocumentViewer
          doc={doc}
          onClose={() => setPreviewing(false)}
          onNavToPerson={id => { setPreviewing(false); onNavToGenealogy(id) }}
          onNavToDocument={() => { setPreviewing(false); onEdit() }}
        />
      )}
      <tr
        ref={ref}
        className={`group border-b border-zinc-800/60 hover:bg-zinc-800/30 transition-colors cursor-pointer ${highlighted ? 'ring-2 ring-inset ring-brand-400/50' : ''} ${selected ? 'bg-brand-900/20' : ''}`}
        onClick={() => canPreview ? setPreviewing(true) : undefined}
      >
        {/* Checkbox */}
        <td className="pl-3 pr-1 py-2.5 w-8 shrink-0" onClick={e => { e.stopPropagation(); onToggleSelect?.() }}>
          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer
            ${selected
              ? 'bg-brand-500 border-brand-400'
              : 'border-zinc-600 opacity-0 group-hover:opacity-100'}`}>
            {selected && (
              <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 10" stroke="currentColor" strokeWidth={2}>
                <path d="M1 5l3 3 7-7"/>
              </svg>
            )}
          </div>
        </td>
        {/* Icon / thumbnail */}
        <td className="pl-1 pr-2 py-2.5 w-11 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700/60 flex items-center justify-center overflow-hidden">
            {isImage(doc.mime_type)
              ? <img src={api.documents.fileUrl(doc.id)} alt="" className="w-full h-full object-cover" />
              : fileIcon(doc.mime_type)}
          </div>
        </td>
        {/* Title + description */}
        <td className="py-2.5 pr-4">
          <p className="text-xs font-medium text-zinc-100 truncate max-w-[260px]">{displayName}</p>
          {doc.description && (
            <p className="text-[10px] text-zinc-600 truncate max-w-[260px]">{doc.description}</p>
          )}
        </td>
        {/* Type */}
        <td className="py-2.5 pr-4 whitespace-nowrap">
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-zinc-800 text-zinc-400 font-medium">{typeLabel}</span>
        </td>
        {/* Year */}
        <td className="py-2.5 pr-4 text-xs text-zinc-500 tabular-nums whitespace-nowrap w-14">
          {doc.year ?? <span className="text-zinc-700">—</span>}
        </td>
        {/* Persons */}
        <td className="py-2.5 pr-4" onClick={e => e.stopPropagation()}>
          <div className="flex flex-wrap gap-1">
            {doc.persons.slice(0, 3).map(p => (
              <PersonChip key={p.id} person={p} onClick={() => onNavToGenealogy(p.id)} />
            ))}
            {doc.persons.length > 3 && (
              <span className="text-[10px] text-zinc-500 self-center">+{doc.persons.length - 3}</span>
            )}
          </div>
        </td>
        {/* Actions */}
        <td className="py-2.5 pr-4 w-24" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
            <button onClick={onEdit} title="Edit"
              className="w-7 h-7 rounded flex items-center justify-center text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2.25 2.25 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2.414a2 2 0 01.586-1.414z"/></svg>
            </button>
            <a href={api.documents.fileUrl(doc.id, true)} title="Download" onClick={e => e.stopPropagation()}
              className="w-7 h-7 rounded flex items-center justify-center text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            </a>
            <button onClick={() => { if (confirm('Delete this document?')) deleteMut.mutate() }} title="Delete"
              className="w-7 h-7 rounded flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-zinc-700 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </td>
      </tr>
    </>
  )
})

// ── DocumentsTab ──────────────────────────────────────────────────────────────

export default function DocumentsTab({
  onNavToGenealogy,
  navTarget,
  onNavConsumed,
}: {
  onNavToGenealogy: (id: number) => void
  navTarget?: { docId: number; editMode?: boolean; key: number } | null
  onNavConsumed?: () => void
}) {
  const { data: docs = [] }    = useQuery<PersonDocument[]>({ queryKey: ['docs-all'], queryFn: api.documents.listAll })
  const { data: persons = [] } = useQuery<PersonFull[]>({ queryKey: ['persons'],   queryFn: api.persons.list })
  const { data: types = [] }   = useQuery<DocumentType[]>({ queryKey: ['doc-types'], queryFn: api.documentTypes.list })

  const [search, setSearch]           = useState('')
  const [filterType, setFilterType]   = useState<string>('__all__')
  const [filterPerson, setFilterPerson] = useState<number | null>(null)
  const [selectedIds, setSelectedIds]  = useState<Set<number>>(new Set())
  const [includeNotes, setIncludeNotes] = useState(true)
  const [downloading, setDownloading]  = useState(false)
  const [showUpload, setShowUpload]   = useState(false)
  const [showTypeManager, setShowTypeManager] = useState(false)
  const [editingDocId, setEditingDocId] = useState<number | null>(null)
  const [highlightedId, setHighlightedId] = useState<number | null>(null)
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map())

  const typeMap = new Map(types.map(t => [t.key, t.label]))

  useEffect(() => {
    if (!navTarget) return
    setSearch('')
    setFilterType('__all__')
    setFilterPerson(null)
    const { docId, editMode } = navTarget
    const timer = setTimeout(() => {
      const el = rowRefs.current.get(docId)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightedId(docId)
      setTimeout(() => setHighlightedId(null), 2000)
      if (editMode) setEditingDocId(docId)
      onNavConsumed?.()
    }, 80)
    return () => clearTimeout(timer)
  }, [navTarget?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const editingDoc = editingDocId != null ? docs.find(d => d.id === editingDocId) ?? null : null

  const filtered = docs.filter(d => {
    if (filterType !== '__all__' && d.doc_type !== filterType) return false
    if (filterPerson != null && !d.persons.some(p => p.id === filterPerson)) return false
    if (search) {
      const q = search.toLowerCase()
      const haystack = [d.title, d.filename, d.description, ...(d.persons.map(p => p.name))].filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  const personOptions = persons.filter(p => docs.some(d => d.persons.some(dp => dp.id === p.id)))

  const allFilteredSelected = filtered.length > 0 && filtered.every(d => selectedIds.has(d.id))
  const someSelected = selectedIds.size > 0

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }
  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds(prev => { const s = new Set(prev); filtered.forEach(d => s.delete(d.id)); return s })
    } else {
      setSelectedIds(prev => { const s = new Set(prev); filtered.forEach(d => s.add(d.id)); return s })
    }
  }
  async function handleBulkDownload() {
    setDownloading(true)
    try {
      await api.documents.bulkDownload([...selectedIds], includeNotes)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {showUpload && (
        <UploadModal
          persons={persons}
          types={types}
          onClose={() => setShowUpload(false)}
          onDone={() => setShowUpload(false)}
        />
      )}
      {showTypeManager && (
        <TypeManagerModal onClose={() => setShowTypeManager(false)} />
      )}
      {editingDoc && (
        <EditDocModal
          doc={editingDoc}
          types={types}
          persons={persons}
          onClose={() => setEditingDocId(null)}
        />
      )}

      {/* Header */}
      <div className="shrink-0 bg-zinc-900 border-b border-zinc-800 px-6 py-3 flex items-center gap-3">
        <h1 className="text-sm font-semibold text-zinc-100">Documents</h1>
        <span className="text-xs text-zinc-600 tabular-nums">{docs.length} total</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowTypeManager(true)}
            className="h-7 px-2.5 rounded-lg border border-zinc-700 bg-zinc-800/60 hover:bg-zinc-700 text-xs text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1.5">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
            Types
          </button>
          <button onClick={() => setShowUpload(true)}
            className="h-7 px-3 rounded-lg bg-brand-600 hover:bg-brand-500 text-xs font-medium text-white transition-colors flex items-center gap-1.5">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
            New
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="shrink-0 bg-zinc-900/60 border-b border-zinc-800 px-6 py-2.5 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <svg className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="7"/><path strokeLinecap="round" d="M20 20l-3.5-3.5"/>
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400"
          />
        </div>

        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-300 outline-none focus:border-brand-400 max-w-[160px]">
          <option value="__all__">All types</option>
          {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>

        <PersonCombobox
          persons={personOptions}
          value={filterPerson}
          onChange={setFilterPerson}
        />

        {(search || filterType !== '__all__' || filterPerson != null) && (
          <button onClick={() => { setSearch(''); setFilterType('__all__'); setFilterPerson(null) }}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors shrink-0">
            Clear
          </button>
        )}

        <span className="ml-auto text-[10px] text-zinc-600 tabular-nums shrink-0">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-zinc-600">
            <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>
            <p className="text-sm">{docs.length === 0 ? 'No documents yet' : 'No results'}</p>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-zinc-900/95 backdrop-blur-sm z-10">
              <tr className="border-b border-zinc-800 text-left">
                {/* Select-all checkbox */}
                <th className="pl-3 pr-1 py-2.5 w-8" onClick={toggleSelectAll}>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition-colors
                    ${allFilteredSelected
                      ? 'bg-brand-500 border-brand-400'
                      : someSelected
                        ? 'bg-brand-500/40 border-brand-400/60'
                        : 'border-zinc-600 hover:border-zinc-400'}`}>
                    {allFilteredSelected
                      ? <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 10" stroke="currentColor" strokeWidth={2}><path d="M1 5l3 3 7-7"/></svg>
                      : someSelected
                        ? <span className="w-1.5 h-0.5 bg-brand-300 rounded-full block" />
                        : null}
                  </div>
                </th>
                <th className="pl-1 pr-2 py-2.5 w-11"></th>
                <th className="py-2.5 pr-4 text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Title</th>
                <th className="py-2.5 pr-4 text-[10px] text-zinc-500 font-semibold uppercase tracking-wider whitespace-nowrap">Type</th>
                <th className="py-2.5 pr-4 text-[10px] text-zinc-500 font-semibold uppercase tracking-wider w-14">Year</th>
                <th className="py-2.5 pr-4 text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Persons</th>
                <th className="py-2.5 pr-4 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <DocRow
                  key={d.id}
                  ref={el => { if (el) rowRefs.current.set(d.id, el); else rowRefs.current.delete(d.id) }}
                  doc={d}
                  typeMap={typeMap}
                  persons={persons}
                  onNavToGenealogy={id => onNavToGenealogy(id)}
                  onEdit={() => setEditingDocId(d.id)}
                  highlighted={highlightedId === d.id}
                  selected={selectedIds.has(d.id)}
                  onToggleSelect={() => toggleSelect(d.id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Floating action bar — appears when documents are selected */}
      {someSelected && (
        <div className="shrink-0 bg-zinc-900 border-t border-zinc-800 px-6 py-3 flex items-center gap-4">
          <span className="text-xs font-medium text-zinc-300">
            {selectedIds.size} selected
          </span>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Clear
          </button>
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setIncludeNotes(v => !v)}
                className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${includeNotes ? 'bg-brand-500 border-brand-400' : 'border-zinc-600 hover:border-zinc-400'}`}
              >
                {includeNotes && (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 10" stroke="currentColor" strokeWidth={2}><path d="M1 5l3 3 7-7"/></svg>
                )}
              </div>
              <span className="text-xs text-zinc-400">Include notes</span>
            </label>
            <button
              onClick={handleBulkDownload}
              disabled={downloading}
              className="flex items-center gap-2 h-8 px-4 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
              </svg>
              {downloading ? 'Building ZIP…' : 'Download ZIP'}
            </button>
          </div>
        </div>
      )}

      {downloading && createPortal(
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[900] flex items-center gap-3 px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl text-sm text-zinc-300 pointer-events-none">
          <svg className="w-4 h-4 animate-spin text-brand-400 shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Building ZIP…
        </div>,
        document.body
      )}
    </div>
  )
}

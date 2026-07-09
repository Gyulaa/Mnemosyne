import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { PersonNote, DocumentNote, NoteCitation, Source, PersonEvent, PersonFull, Relation } from '../types'
import { api } from '../api'

// ── NoteOps — injectable API operations (supports person notes & document notes) ─

export interface NoteOps {
  update: (id: number, fields: { title?: string | null; content?: string }) => Promise<{ id: number; title: string | null; content: string; updated_at: string | null }>
  delete: (id: number) => Promise<unknown>
  addCitation: (noteId: number, fields: { source_id?: number; marker: number; detail?: string; custom_label?: string }) => Promise<NoteCitation>
  deleteCitation: (id: number) => Promise<unknown>
}
import { useSettings, displayPersonName } from '../SettingsContext'

// ── Markdown renderer ─────────────────────────────────────────────────────────

marked.setOptions({ breaks: true, gfm: true })

function renderMarkdown(content: string, citations: NoteCitation[]): string {
  // Replace @[Name](#pid-ID) person mentions before markdown parse
  let processed = content.replace(/@\[([^\]]+)\]\(#pid-(\d+)\)/g, (_, name, id) =>
    `<a href="#person-ref-${id}" class="note-person-ref">@${name}</a>`
  )
  // Replace [n] citation markers with superscript anchors
  processed = processed.replace(/\[(\d+)\]/g, (_, n) => {
    const nc = citations.find(c => c.marker === parseInt(n))
    if (!nc) return `[${n}]`
    const label = nc.custom_label ?? nc.source_title ?? `Source ${n}`
    return `<sup><a href="#note-ref-${nc.id}" class="note-ref" title="${label.replace(/"/g, '&quot;')}">[${n}]</a></sup>`
  })
  const html = marked.parse(processed) as string
  return DOMPurify.sanitize(html, { ADD_ATTR: ['title', 'href', 'class'] })
}

// ── @ mention helper ──────────────────────────────────────────────────────────

function getAtMentionContext(text: string, cursorPos: number): { query: string; atStart: number } | null {
  const before = text.slice(0, cursorPos)
  const idx = before.lastIndexOf('@')
  if (idx === -1) return null
  // If the @ is already inside a completed mention syntax [@...], skip
  const afterAt = before.slice(idx)
  if (afterAt.includes('[')) return null
  // No newline between @ and cursor
  if (afterAt.includes('\n')) return null
  return { query: before.slice(idx + 1), atStart: idx }
}

// ── Toolbar button ────────────────────────────────────────────────────────────

function ToolbarBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" onMouseDown={e => { e.preventDefault(); onClick() }} title={title}
      className="px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 rounded transition-colors font-mono">
      {children}
    </button>
  )
}

// ── NoteEditor ────────────────────────────────────────────────────────────────

interface Props {
  note: PersonNote | DocumentNote
  sources: Source[]
  persons?: PersonFull[]
  relations?: Relation[]
  ops?: NoteOps
  onNavToPerson?: (id: number) => void
  onSaved: (updated: PersonNote | DocumentNote) => void
  onDeleted: () => void
  onCancel: () => void
  autoFocusContent?: boolean
}

export default function NoteEditor({ note, sources, persons = [], relations = [], ops, onNavToPerson, onSaved, onDeleted, onCancel, autoFocusContent }: Props) {
  const noteOps: NoteOps = ops ?? api.notes
  const { nameOrder } = useSettings()
  const [title, setTitle] = useState(note.title ?? '')
  const [content, setContent] = useState(note.content)
  const [citations, setCitations] = useState<NoteCitation[]>(note.citations)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Cite picker state
  const [showCitePicker, setShowCitePicker] = useState(false)
  const [citeTab, setCiteTab] = useState<'source' | 'custom'>('source')
  const [citeSearch, setCiteSearch] = useState('')
  const [customCiteText, setCustomCiteText] = useState('')

  // @ mention state
  const [mentionCtx, setMentionCtx] = useState<{ query: string; atStart: number } | null>(null)
  const [mentionCursor, setMentionCursor] = useState(0)
  const [mentionPos, setMentionPos] = useState<{ top: number; left: number } | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mentionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoFocusContent) textareaRef.current?.focus()
  }, [autoFocusContent])

  // Auto-remove citations whose [n] marker has been deleted from the text
  useEffect(() => {
    setCitations(prev => prev.filter(c => content.includes(`[${c.marker}]`)))
  }, [content])

  // ── Family context lookup from relations ──────────────────────────────────

  const familyMap = useMemo(() => {
    type FamilyEntry = { spouses: string[]; parents: string[]; children: string[]; siblings: string[] }
    const map = new Map<number, FamilyEntry>()
    const personById = new Map(persons.map(p => [p.id, p]))
    const getName = (id: number) => {
      const p = personById.get(id)
      return p ? (displayPersonName(p, nameOrder) || p.name || null) : null
    }
    const entry = (id: number): FamilyEntry => {
      if (!map.has(id)) map.set(id, { spouses: [], parents: [], children: [], siblings: [] })
      return map.get(id)!
    }
    for (const r of relations) {
      if (r.type === 'spouse') {
        const nB = getName(r.person_b_id); const nA = getName(r.person_a_id)
        if (nB) entry(r.person_a_id).spouses.push(nB)
        if (nA) entry(r.person_b_id).spouses.push(nA)
      } else if (r.type === 'parent') {
        // person_a is parent of person_b
        const nParent = getName(r.person_a_id); const nChild = getName(r.person_b_id)
        if (nParent) entry(r.person_b_id).parents.push(nParent)
        if (nChild) entry(r.person_a_id).children.push(nChild)
      } else if (r.type === 'sibling') {
        const nA = getName(r.person_a_id); const nB = getName(r.person_b_id)
        if (nB) entry(r.person_a_id).siblings.push(nB)
        if (nA) entry(r.person_b_id).siblings.push(nA)
      }
    }
    return map
  }, [relations, persons, nameOrder])

  // ── @ mention filtering ───────────────────────────────────────────────────

  const mentionMatches = useMemo(() => {
    if (!mentionCtx) return []
    const q = mentionCtx.query.trim().toLowerCase()
    return persons
      .filter(p => p.name && (q === '' || p.name.toLowerCase().includes(q) || (p.nickname ?? '').toLowerCase().includes(q)))
      .slice(0, 8)
  }, [mentionCtx, persons])

  useEffect(() => { setMentionCursor(0) }, [mentionMatches])

  // ── Content change handler ────────────────────────────────────────────────

  function handleContentChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setContent(val)
    const pos = e.target.selectionStart ?? val.length
    const ctx = getAtMentionContext(val, pos)
    setMentionCtx(ctx)
    if (ctx && textareaRef.current) {
      const rect = textareaRef.current.getBoundingClientRect()
      setMentionPos({ top: rect.top, left: rect.left })
    } else if (!ctx) {
      setMentionPos(null)
    }
  }

  // ── @ mention insertion ───────────────────────────────────────────────────

  function insertMention(person: PersonFull) {
    const ta = textareaRef.current
    if (!ta || !mentionCtx) return
    const cursorPos = ta.selectionStart
    const name = displayPersonName(person, nameOrder) || person.name || `Person ${person.id}`
    const link = `@[${name}](#pid-${person.id})`
    const newContent = content.slice(0, mentionCtx.atStart) + link + content.slice(cursorPos)
    setContent(newContent)
    setMentionCtx(null)
    requestAnimationFrame(() => {
      const newPos = mentionCtx.atStart + link.length
      ta.selectionStart = ta.selectionEnd = newPos
      ta.focus()
    })
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!mentionCtx || mentionMatches.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setMentionCursor(c => Math.min(c + 1, mentionMatches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMentionCursor(c => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionMatches[mentionCursor]) }
    else if (e.key === 'Escape') { e.preventDefault(); setMentionCtx(null) }
  }

  // ── Cite insertion ────────────────────────────────────────────────────────

  function insertCiteAtCursor(source: Source) {
    const ta = textareaRef.current
    if (!ta) return
    const nextMarker = citations.length > 0 ? Math.max(...citations.map(c => c.marker)) + 1 : 1
    const marker = `[${nextMarker}]`
    const start = ta.selectionStart
    const newContent = content.slice(0, start) + marker + content.slice(ta.selectionEnd)
    setContent(newContent)
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + marker.length
      ta.focus()
    })
    const optimistic: NoteCitation = {
      id: -(Date.now()), note_id: note.id, source_id: source.id, marker: nextMarker,
      detail: null, custom_label: null, source_title: source.title,
      source_type: source.source_type, source_document_id: source.document_id,
      source_event_id: source.event_id, source_year: source.year, source_author: source.author,
    }
    setCitations(prev => [...prev, optimistic])
    setShowCitePicker(false)
    setCiteSearch('')
  }

  function insertCustomCite() {
    const label = customCiteText.trim()
    if (!label) return
    const ta = textareaRef.current
    if (!ta) return
    const nextMarker = citations.length > 0 ? Math.max(...citations.map(c => c.marker)) + 1 : 1
    const marker = `[${nextMarker}]`
    const start = ta.selectionStart
    const newContent = content.slice(0, start) + marker + content.slice(ta.selectionEnd)
    setContent(newContent)
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + marker.length
      ta.focus()
    })
    const optimistic: NoteCitation = {
      id: -(Date.now()), note_id: note.id, source_id: null, marker: nextMarker,
      detail: null, custom_label: label, source_title: null,
      source_type: null, source_document_id: null, source_event_id: null,
      source_year: null, source_author: null,
    }
    setCitations(prev => [...prev, optimistic])
    setShowCitePicker(false)
    setCustomCiteText('')
    setCiteTab('source')
  }

  // ── Toolbar helpers ───────────────────────────────────────────────────────

  function wrapSelection(before: string, after: string) {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart, end = ta.selectionEnd
    const selected = content.slice(start, end)
    const newContent = content.slice(0, start) + before + selected + after + content.slice(end)
    setContent(newContent)
    requestAnimationFrame(() => {
      ta.selectionStart = start + before.length
      ta.selectionEnd = start + before.length + selected.length
      ta.focus()
    })
  }

  function insertLinePrefix(prefix: string) {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const lineStart = content.lastIndexOf('\n', start - 1) + 1
    const newContent = content.slice(0, lineStart) + prefix + content.slice(lineStart)
    setContent(newContent)
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + prefix.length
      ta.focus()
    })
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  const save = useCallback(async () => {
    setSaving(true)
    try {
      const updated = await noteOps.update(note.id, { title: title.trim() || null, content })

      const existingIds = new Set(note.citations.map(c => c.id))
      const currentIds = new Set(citations.filter(c => c.id > 0).map(c => c.id))

      for (const c of note.citations) {
        if (!currentIds.has(c.id)) await noteOps.deleteCitation(c.id)
      }

      const finalCitations: NoteCitation[] = []
      for (const c of citations) {
        if (c.id < 0) {
          const saved = await noteOps.addCitation(note.id, {
            source_id: c.source_id ?? undefined,
            marker: c.marker,
            detail: c.detail ?? undefined,
            custom_label: c.custom_label ?? undefined,
          })
          finalCitations.push(saved)
        } else if (existingIds.has(c.id)) {
          finalCitations.push(c)
        }
      }

      onSaved({ ...updated, citations: finalCitations } as PersonNote | DocumentNote)
    } finally {
      setSaving(false)
    }
  }, [note, title, content, citations, onSaved, noteOps])

  async function doDelete() {
    setDeleting(true)
    try { await noteOps.delete(note.id); onDeleted() }
    finally { setDeleting(false) }
  }

  function removeCitation(markerId: number) {
    setCitations(prev => prev.filter(c => c.marker !== markerId))
    setContent(prev => prev.replace(new RegExp(`\\[${markerId}\\]`, 'g'), ''))
  }

  const filteredSources = sources.filter(s =>
    (s.citation_count > 0 || s.document_id !== null || s.event_id !== null) &&
    s.title.toLowerCase().includes(citeSearch.toLowerCase())
  )

  return (
    <div className="bg-zinc-800/40 border border-zinc-700/60 rounded-xl overflow-hidden">
      {/* Title */}
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="w-full bg-transparent px-4 pt-3 pb-1 text-sm font-semibold text-zinc-100 placeholder-zinc-600 outline-none border-b border-zinc-800"
      />

      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/40">
        <ToolbarBtn onClick={() => wrapSelection('**', '**')} title="Bold"><strong>B</strong></ToolbarBtn>
        <ToolbarBtn onClick={() => wrapSelection('*', '*')} title="Italic"><em>I</em></ToolbarBtn>
        <ToolbarBtn onClick={() => wrapSelection('~~', '~~')} title="Strikethrough"><span className="line-through">S</span></ToolbarBtn>
        <span className="w-px h-4 bg-zinc-700 mx-1" />
        <ToolbarBtn onClick={() => insertLinePrefix('## ')} title="Heading">H</ToolbarBtn>
        <ToolbarBtn onClick={() => insertLinePrefix('- ')} title="List">• —</ToolbarBtn>
        <ToolbarBtn onClick={() => insertLinePrefix('> ')} title="Quote">"</ToolbarBtn>
        <span className="w-px h-4 bg-zinc-700 mx-1" />

        {/* Cite button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => { setShowCitePicker(p => !p); setCiteSearch(''); setCiteTab('source'); setCustomCiteText('') }}
            className="flex items-center gap-1 px-2 py-0.5 text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-900/30 rounded transition-colors font-medium"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
            Cite
          </button>

          {showCitePicker && (
            <div className="absolute left-0 top-full mt-1 w-68 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 overflow-hidden" style={{ width: 272 }}>
              {/* Tabs */}
              <div className="flex border-b border-zinc-800">
                <button
                  type="button"
                  onClick={() => setCiteTab('source')}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${citeTab === 'source' ? 'text-amber-400 border-b-2 border-amber-500' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  Sources
                </button>
                <button
                  type="button"
                  onClick={() => setCiteTab('custom')}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${citeTab === 'custom' ? 'text-amber-400 border-b-2 border-amber-500' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  Custom text
                </button>
              </div>

              {citeTab === 'source' ? (
                <>
                  <div className="p-2 border-b border-zinc-800">
                    <input
                      autoFocus
                      type="search"
                      value={citeSearch}
                      onChange={e => setCiteSearch(e.target.value)}
                      placeholder="Search sources…"
                      className="w-full bg-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none"
                    />
                  </div>
                  <div className="max-h-44 overflow-y-auto">
                    {filteredSources.length === 0 ? (
                      <p className="text-xs text-zinc-600 px-3 py-3 italic">
                        {sources.length === 0 ? 'No sources yet — add via a document first' : 'No matches'}
                      </p>
                    ) : (
                      filteredSources.map(s => (
                        <button key={s.id} type="button" onClick={() => insertCiteAtCursor(s)}
                          className="w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors">
                          <p className="text-xs text-zinc-100 truncate">{s.title}</p>
                          <p className="text-[10px] text-zinc-500">
                            {[s.source_type, s.year, s.author].filter(Boolean).join(' · ')}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <div className="p-3 space-y-2">
                  <p className="text-[10px] text-zinc-500">Type any reference text — a URL, book title, oral source, etc.</p>
                  <input
                    autoFocus
                    value={customCiteText}
                    onChange={e => setCustomCiteText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); insertCustomCite() } }}
                    placeholder="e.g. Parish register, 1872"
                    className="w-full bg-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none border border-zinc-700 focus:border-amber-600"
                  />
                  <button
                    type="button"
                    onClick={insertCustomCite}
                    disabled={!customCiteText.trim()}
                    className="w-full py-1.5 text-xs font-medium bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 disabled:opacity-40 rounded-lg transition-colors"
                  >
                    Insert citation
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Textarea + @ mention popup */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleContentChange}
          onKeyDown={handleTextareaKeyDown}
          placeholder={`Write in Markdown… use **bold**, *italic*, - lists, ## headings${persons.length > 0 ? ', @name to mention a person' : ''}`}
          rows={6}
          className="w-full bg-transparent px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 outline-none resize-y leading-relaxed font-mono"
        />

      </div>

      {/* @ mention dropdown — rendered via portal so overflow:hidden parents don't clip it */}
      {mentionCtx !== null && mentionMatches.length > 0 && mentionPos !== null && createPortal(
        <div
          ref={mentionRef}
          style={{
            position: 'fixed',
            top: mentionPos.top,
            left: mentionPos.left + 16,
            zIndex: 9999,
            width: 272,
            transform: 'translateY(calc(-100% - 6px))',
          }}
          className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
        >
          <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Mention person</p>
          <div className="max-h-56 overflow-y-auto">
            {mentionMatches.map((p, i) => {
              const active = i === mentionCursor
              const years = p.birth_year
                ? p.death_year ? `*${p.birth_year} †${p.death_year}` : `*${p.birth_year}`
                : null
              const bio = [years, p.occupation, p.birth_place].filter(Boolean).join(' · ')
              const fam = familyMap.get(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); insertMention(p) }}
                  onMouseEnter={() => setMentionCursor(i)}
                  className={`w-full text-left px-3 py-2 transition-all ${active ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'}`}
                >
                  <p className={`text-xs font-medium ${active ? 'text-zinc-100' : 'text-zinc-200'}`}>
                    {displayPersonName(p, nameOrder)}
                  </p>
                  {bio && (
                    <p className="text-[10px] text-zinc-500 mt-0.5 truncate">{bio}</p>
                  )}
                  {active && fam && (
                    <div className="mt-1 space-y-0.5">
                      {fam.spouses.length > 0 && (
                        <p className="text-[10px] text-brand-400 truncate">
                          ♥ {fam.spouses.join(', ')}
                        </p>
                      )}
                      {fam.parents.length > 0 && (
                        <p className="text-[10px] text-zinc-500 truncate">
                          ↑ {fam.parents.join(', ')}
                        </p>
                      )}
                      {fam.children.length > 0 && (
                        <p className="text-[10px] text-zinc-500 truncate">
                          ↓ {fam.children.length <= 3
                            ? fam.children.join(', ')
                            : `${fam.children[0]}, ${fam.children[1]} +${fam.children.length - 2}`}
                        </p>
                      )}
                      {fam.spouses.length === 0 && fam.parents.length === 0 && fam.children.length > 0 && fam.siblings.length > 0 && (
                        <p className="text-[10px] text-zinc-600 truncate">
                          ~ {fam.siblings.slice(0, 2).join(', ')}{fam.siblings.length > 2 ? ` +${fam.siblings.length - 2}` : ''}
                        </p>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>,
        document.body
      )}

      {/* References panel */}
      {citations.length > 0 && (
        <div className="border-t border-zinc-800 px-4 py-2.5 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">References</p>
          {[...citations].sort((a, b) => a.marker - b.marker).map(c => (
            <div key={c.id} className="flex items-start gap-2 group/ref">
              <span className="text-[10px] text-zinc-600 font-mono shrink-0 mt-0.5 w-5 text-right">[{c.marker}]</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-amber-300 leading-snug truncate">
                  {c.custom_label ?? c.source_title ?? '—'}
                </p>
                {c.detail && <p className="text-[10px] text-zinc-500">{c.detail}</p>}
              </div>
              <button
                type="button"
                onClick={() => removeCitation(c.marker)}
                className="shrink-0 opacity-0 group-hover/ref:opacity-100 text-zinc-600 hover:text-red-400 transition-all mt-0.5"
                title="Remove reference"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-zinc-800 bg-zinc-900/30">
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={saving}
            className="px-3 py-1 text-xs font-medium bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-white rounded-lg transition-colors">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onCancel}
            className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
            Cancel
          </button>
        </div>
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500">Delete this note?</span>
            <button onClick={doDelete} disabled={deleting}
              className="text-[10px] text-red-400 hover:text-red-300 font-medium transition-colors">
              {deleting ? '…' : 'Yes, delete'}
            </button>
            <button onClick={() => setConfirmDelete(false)}
              className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)}
            className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors">
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

// ── NoteCard (display mode) ───────────────────────────────────────────────────

interface CardProps {
  note: PersonNote | DocumentNote
  sources: Source[]
  persons?: PersonFull[]
  relations?: Relation[]
  ops?: NoteOps
  onUpdated: (n: PersonNote | DocumentNote) => void
  onDeleted: () => void
  onNavToEvent?: (eventId: number) => void
  onNavToPerson?: (id: number) => void
  personId?: number
}

export function NoteCard({ note, sources, persons, relations, ops, onUpdated, onDeleted, onNavToEvent, onNavToPerson, personId }: CardProps) {
  const [editing, setEditing] = useState(false)
  const qc = useQueryClient()

  const html = renderMarkdown(note.content, note.citations)

  function navigateCitation(citation: NoteCitation) {
    if (citation.source_event_id != null && onNavToEvent) {
      onNavToEvent(citation.source_event_id)
      return
    }
    if (citation.source_type === 'event' && onNavToEvent && personId != null) {
      const cached = qc.getQueryData<PersonEvent[]>(['person-events', personId])
      const find = (events: PersonEvent[]) => events.find(e => e.title === citation.source_title)
      if (cached) {
        const match = find(cached)
        if (match) { onNavToEvent(match.id); return }
      }
      api.events.listForPerson(personId).then(events => {
        const match = find(events)
        if (match) onNavToEvent(match.id)
      })
      return
    }
    if (citation.source_document_id != null) {
      window.open(api.documents.fileUrl(citation.source_document_id, false), '_blank')
    }
  }

  function handleContentClick(e: React.MouseEvent<HTMLDivElement>) {
    const anchor = (e.target as Element).closest('a.note-ref, a.note-person-ref')
    if (!anchor) return
    e.preventDefault()
    e.stopPropagation()

    if (anchor.classList.contains('note-person-ref')) {
      const href = (anchor as HTMLAnchorElement).getAttribute('href') ?? ''
      const match = href.match(/person-ref-(\d+)$/)
      if (match && onNavToPerson) onNavToPerson(parseInt(match[1]))
      return
    }

    const href = (anchor as HTMLAnchorElement).getAttribute('href') ?? ''
    const match = href.match(/note-ref-(\d+)$/)
    if (!match) return
    const citationId = parseInt(match[1])
    const citation = note.citations.find(c => c.id === citationId)
    if (citation) navigateCitation(citation)
  }

  if (editing) {
    return (
      <NoteEditor
        note={note}
        sources={sources}
        persons={persons}
        relations={relations}
        ops={ops}
        onNavToPerson={onNavToPerson}
        onSaved={updated => { onUpdated(updated); setEditing(false) }}
        onDeleted={onDeleted}
        onCancel={() => setEditing(false)}
        autoFocusContent
      />
    )
  }

  const editedAt = note.updated_at
    ? new Date(note.updated_at).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })
    : null

  return (
    <div
      className="group bg-zinc-800/30 border border-zinc-700/40 hover:border-zinc-600/60 rounded-xl overflow-hidden cursor-pointer transition-colors"
      onClick={() => setEditing(true)}
    >
      <div className="flex items-start justify-between gap-2 px-5 pt-4 pb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-2">
            {note.title && (
              <p className="text-sm font-semibold text-zinc-200 truncate">{note.title}</p>
            )}
            {editedAt && (
              <span className="text-xs text-zinc-600 shrink-0 ml-auto">{editedAt}</span>
            )}
          </div>
          {note.content ? (
            <div
              className="note-preview text-sm text-zinc-400 leading-relaxed line-clamp-4"
              dangerouslySetInnerHTML={{ __html: html }}
              onClick={handleContentClick}
            />
          ) : (
            <p className="text-sm text-zinc-600 italic">Empty note</p>
          )}
        </div>
        <button
          onClick={e => { e.stopPropagation(); setEditing(true) }}
          className="shrink-0 opacity-0 group-hover:opacity-100 p-1.5 rounded text-zinc-600 hover:text-zinc-200 hover:bg-zinc-700 transition-all"
          title="Edit"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2.25 2.25 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2.414a2 2 0 01.586-1.414z" />
          </svg>
        </button>
      </div>

      {/* Citations panel */}
      {note.citations.length > 0 && (
        <div
          className="border-t border-zinc-800 bg-zinc-900/40 px-4 py-2 space-y-0.5"
          onClick={e => e.stopPropagation()}
        >
          {[...note.citations].sort((a, b) => a.marker - b.marker).map(c => {
            const isEvent = (c.source_event_id != null || c.source_type === 'event') && !!onNavToEvent
            const isDoc = c.source_document_id != null
            const isCustom = c.source_id === null
            const canNav = isEvent || isDoc
            const label = c.custom_label ?? c.source_title ?? '—'
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => !isCustom && canNav && navigateCitation(c)}
                disabled={isCustom || !canNav}
                className={[
                  'flex items-center gap-2 w-full text-left rounded-lg px-2 py-2 transition-colors text-xs',
                  canNav && !isCustom
                    ? 'text-amber-500 hover:text-amber-300 hover:bg-zinc-800/70 cursor-pointer'
                    : 'text-amber-900 cursor-default',
                ].join(' ')}
              >
                <span className="font-mono shrink-0 w-6 text-right text-zinc-600">[{c.marker}]</span>
                {isEvent ? (
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                ) : isDoc ? (
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                  </svg>
                )}
                <span className="truncate">{label}</span>
                {canNav && !isCustom && (
                  <svg className="w-3 h-3 shrink-0 ml-auto opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

import { useState, useRef, useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { PersonNote, NoteCitation, Source, PersonEvent } from '../types'
import { api } from '../api'

// ── Markdown renderer ─────────────────────────────────────────────────────────

marked.setOptions({ breaks: true, gfm: true })

function renderMarkdown(content: string, citations: NoteCitation[]): string {
  // Replace [n] with superscript anchor before rendering
  let processed = content.replace(/\[(\d+)\]/g, (_, n) => {
    const nc = citations.find(c => c.marker === parseInt(n))
    if (!nc) return `[${n}]`
    const label = nc.source_title ? `${nc.source_title}${nc.detail ? ', ' + nc.detail : ''}` : `Source ${n}`
    return `<sup><a href="#note-ref-${nc.id}" class="note-ref" title="${label.replace(/"/g, '&quot;')}">[${n}]</a></sup>`
  })
  const html = marked.parse(processed) as string
  return DOMPurify.sanitize(html, { ADD_ATTR: ['title', 'href', 'class'] })
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
  note: PersonNote
  sources: Source[]
  onSaved: (updated: PersonNote) => void
  onDeleted: () => void
  onCancel: () => void
  autoFocusContent?: boolean
}

export default function NoteEditor({ note, sources, onSaved, onDeleted, onCancel, autoFocusContent }: Props) {
  const [title, setTitle] = useState(note.title ?? '')
  const [content, setContent] = useState(note.content)
  const [citations, setCitations] = useState<NoteCitation[]>(note.citations)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showCitePicker, setShowCitePicker] = useState(false)
  const [citeSearch, setCiteSearch] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocusContent) textareaRef.current?.focus()
  }, [autoFocusContent])

  // ── Cursor-based cite insertion ───────────────────────────────────────────

  function insertCiteAtCursor(source: Source) {
    const ta = textareaRef.current
    if (!ta) return

    // assign next marker number (max existing + 1, or 1)
    const nextMarker = citations.length > 0 ? Math.max(...citations.map(c => c.marker)) + 1 : 1
    const marker = `[${nextMarker}]`

    const start = ta.selectionStart
    const end = ta.selectionEnd
    const newContent = content.slice(0, start) + marker + content.slice(end)
    setContent(newContent)

    // restore cursor after the inserted marker
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + marker.length
      ta.focus()
    })

    // optimistically add citation to list (save happens with the note)
    const optimistic: NoteCitation = {
      id: -(Date.now()),  // temp negative id
      note_id: note.id,
      source_id: source.id,
      marker: nextMarker,
      detail: null,
      source_title: source.title,
      source_type: source.source_type,
      source_document_id: source.document_id,
      source_event_id: source.event_id,
      source_year: source.year,
      source_author: source.author,
    }
    setCitations(prev => [...prev, optimistic])
    setShowCitePicker(false)
    setCiteSearch('')
  }

  // ── Toolbar wrap helper ───────────────────────────────────────────────────

  function wrapSelection(before: string, after: string) {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
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
      // 1. Save note content + title
      const updated = await api.notes.update(note.id, {
        title: title.trim() || null,
        content,
      })

      // 2. Sync citations: delete removed ones, add new ones
      const existingIds = new Set(note.citations.map(c => c.id))
      const currentIds = new Set(citations.filter(c => c.id > 0).map(c => c.id))

      // delete removed
      for (const c of note.citations) {
        if (!currentIds.has(c.id)) {
          await api.notes.deleteCitation(c.id)
        }
      }

      // add new (negative temp ids)
      const finalCitations: NoteCitation[] = []
      for (const c of citations) {
        if (c.id < 0) {
          const saved = await api.notes.addCitation(note.id, {
            source_id: c.source_id,
            marker: c.marker,
            detail: c.detail ?? undefined,
          })
          finalCitations.push(saved)
        } else if (existingIds.has(c.id)) {
          finalCitations.push(c)
        }
      }

      onSaved({ ...updated, citations: finalCitations })
    } finally {
      setSaving(false)
    }
  }, [note, title, content, citations, onSaved])

  async function doDelete() {
    setDeleting(true)
    try {
      await api.notes.delete(note.id)
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  function removeCitation(markerId: number) {
    setCitations(prev => prev.filter(c => c.marker !== markerId))
    // Remove the [n] marker from text
    setContent(prev => prev.replace(new RegExp(`\\[${markerId}\\]`, 'g'), ''))
  }

  const filteredSources = sources.filter(s =>
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
            onClick={() => { setShowCitePicker(p => !p); setCiteSearch('') }}
            className="flex items-center gap-1 px-2 py-0.5 text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-900/30 rounded transition-colors font-medium"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
            Cite
          </button>
          {showCitePicker && (
            <div className="absolute left-0 top-full mt-1 w-64 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 overflow-hidden">
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
              <div className="max-h-48 overflow-y-auto">
                {filteredSources.length === 0 ? (
                  <p className="text-xs text-zinc-600 px-3 py-3 italic">
                    {sources.length === 0
                      ? 'No sources yet — add via a document first'
                      : 'No matches'}
                  </p>
                ) : (
                  filteredSources.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => insertCiteAtCursor(s)}
                      className="w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors"
                    >
                      <p className="text-xs text-zinc-100 truncate">{s.title}</p>
                      <p className="text-[10px] text-zinc-500">
                        {[s.source_type, s.year, s.author].filter(Boolean).join(' · ')}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Write in Markdown… use **bold**, *italic*, - lists, ## headings"
        rows={6}
        className="w-full bg-transparent px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 outline-none resize-y leading-relaxed font-mono"
      />

      {/* References panel */}
      {citations.length > 0 && (
        <div className="border-t border-zinc-800 px-4 py-2.5 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">References</p>
          {[...citations].sort((a, b) => a.marker - b.marker).map(c => (
            <div key={c.id} className="flex items-start gap-2 group/ref">
              <span className="text-[10px] text-zinc-600 font-mono shrink-0 mt-0.5 w-5 text-right">[{c.marker}]</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-amber-300 leading-snug truncate">{c.source_title ?? '—'}</p>
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
  note: PersonNote
  sources: Source[]
  onUpdated: (n: PersonNote) => void
  onDeleted: () => void
  onNavToEvent?: (eventId: number) => void
  personId?: number
}

export function NoteCard({ note, sources, onUpdated, onDeleted, onNavToEvent, personId }: CardProps) {
  const [editing, setEditing] = useState(false)
  const qc = useQueryClient()

  const html = renderMarkdown(note.content, note.citations)

  function navigateCitation(citation: NoteCitation) {
    if (citation.source_event_id != null && onNavToEvent) {
      onNavToEvent(citation.source_event_id)
      return
    }
    if (citation.source_type === 'event' && onNavToEvent && personId != null) {
      // try cache first, then fetch — match by title for sources created before event_id was stored
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
    const anchor = (e.target as Element).closest('a.note-ref')
    if (!anchor) return
    e.preventDefault()
    e.stopPropagation()
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
      {/* Header + content */}
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
            const canNav = isEvent || isDoc
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => navigateCitation(c)}
                disabled={!canNav}
                className={[
                  'flex items-center gap-2 w-full text-left rounded-lg px-2 py-2 transition-colors text-xs',
                  canNav
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
                <span className="truncate">{c.source_title ?? '—'}</span>
                {canNav && (
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

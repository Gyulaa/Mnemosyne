/**
 * The rich editing surface for a document's `description`: Markdown formatting,
 * `@` mentions and `[n]` citations against a source, another document or free
 * text.
 *
 * Deliberately *controlled and save-less*. Two screens edit a description — the
 * carousel's side panel, where the description is the only thing being edited
 * and gets its own Save button, and the document edit modal, where it is one
 * field among several under the modal's single Save. A component that saved
 * itself could only serve the first, so the surface holds no draft state and
 * persisting is the caller's job via `persistDescriptionCitations()` and
 * `linkMentionedPersons()` below.
 */
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { PersonDocument, PersonFull, NoteCitation, Source } from '../types'
import { useT, useSettings, displayPersonName } from '../SettingsContext'
import { docTypeLabel } from '../docTypes'
import { useAtMention } from '../mentions'
import { plainMentions } from '../markdown'

function ToolbarBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" onMouseDown={e => { e.preventDefault(); onClick() }} title={title}
      className="px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 rounded transition-colors font-mono">
      {children}
    </button>
  )
}

/**
 * Write a description's citation set to the server, as a diff against what it
 * held when editing started. A diff rather than a replace because `marker` is
 * the id the rendered `[n]` text points at — re-creating every row would
 * renumber citations the reader was already looking at.
 */
export async function persistDescriptionCitations(
  docId: number, before: NoteCitation[], after: NoteCitation[],
): Promise<void> {
  // Rows still carrying a real (positive) id survived the edit; negative ids
  // are optimistic rows added in this session and not on the server yet.
  const kept = new Set(after.filter(c => c.id > 0).map(c => c.id))
  for (const c of before) if (!kept.has(c.id)) await api.documents.deleteDescriptionCitation(c.id)
  for (const c of after) {
    if (c.id < 0) {
      await api.documents.addDescriptionCitation(docId, {
        source_id: c.source_id ?? undefined,
        marker: c.marker,
        detail: c.detail ?? undefined,
        custom_label: c.custom_label ?? undefined,
      })
    }
  }
}

/**
 * Link everyone newly mentioned. One-way on purpose, matching the text-document
 * body: mentioning someone links them, deleting the mention later does not
 * unlink them — the person picker is how a link is removed.
 */
export async function linkMentionedPersons(
  docId: number, before: Set<number>, after: Set<number>,
): Promise<void> {
  for (const pid of after) if (!before.has(pid)) await api.documents.linkPerson(docId, pid)
}

export function DescriptionField({
  docId, value, onChange, citations, onCitationsChange, onMentionPerson, autoFocus, className,
}: {
  /**
   * The document being described, or `null` while it is still being created —
   * the upload modal edits a description before the row exists. Citations added
   * against `null` stay optimistic until the caller saves them with the new id.
   */
  docId: number | null
  value: string
  onChange: (next: string) => void
  citations: NoteCitation[]
  onCitationsChange: (next: NoteCitation[]) => void
  /** Called when a mention is accepted, so the caller can track the link. */
  onMentionPerson: (person: PersonFull) => void
  autoFocus?: boolean
  /** Sizing for the textarea — the panel fills its column, the modal does not. */
  className?: string
}) {
  const t = useT()
  const { nameOrder } = useSettings()
  const { data: sources = [] } = useQuery<Source[]>({ queryKey: ['sources'], queryFn: api.sources.list })
  const { data: allDocs = [] } = useQuery<PersonDocument[]>({ queryKey: ['docs-all'], queryFn: api.documents.listAll })

  const [showCitePicker, setShowCitePicker] = useState(false)
  const [citeTab, setCiteTab] = useState<'document' | 'source' | 'custom'>('document')
  const [citeSearch, setCiteSearch] = useState('')
  const [customCiteText, setCustomCiteText] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Drop citations whose [n] marker has been deleted from the text.
  useEffect(() => {
    const live = citations.filter(c => value.includes(`[${c.marker}]`))
    if (live.length !== citations.length) onCitationsChange(live)
  }, [value, citations, onCitationsChange])

  const mention = useAtMention((person, ctx) => {
    const ta = textareaRef.current
    if (!ta) return
    const name = displayPersonName(person, nameOrder) || `Person ${person.id}`
    const link = `@[${name}](#pid-${person.id})`
    const next = value.slice(0, ctx.atStart) + link + value.slice(ta.selectionStart)
    onChange(next)
    onMentionPerson(person)
    mention.close()
    requestAnimationFrame(() => {
      const pos = ctx.atStart + link.length
      ta.selectionStart = ta.selectionEnd = pos
      ta.focus()
    })
  })

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    onChange(val)
    mention.sync(e.target, val, e.target.selectionStart ?? val.length)
  }

  function wrapSelection(before: string, after: string) {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart, end = ta.selectionEnd
    const selected = value.slice(start, end)
    onChange(value.slice(0, start) + before + selected + after + value.slice(end))
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
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    onChange(value.slice(0, lineStart) + prefix + value.slice(lineStart))
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + prefix.length
      ta.focus()
    })
  }

  function nextMarker() {
    return citations.length > 0 ? Math.max(...citations.map(c => c.marker)) + 1 : 1
  }
  function insertMarkerAtCursor(marker: number) {
    const ta = textareaRef.current
    if (!ta) return
    const token = `[${marker}]`
    const start = ta.selectionStart
    onChange(value.slice(0, start) + token + value.slice(ta.selectionEnd))
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + token.length
      ta.focus()
    })
  }
  function addOptimisticCitation(c: Omit<NoteCitation, 'id' | 'note_id'>) {
    onCitationsChange([...citations, { ...c, id: -Date.now(), note_id: docId ?? 0 } as NoteCitation])
    setShowCitePicker(false)
    setCiteSearch('')
    setCustomCiteText('')
  }
  function citeSource(s: Source) {
    const marker = nextMarker()
    insertMarkerAtCursor(marker)
    addOptimisticCitation({
      source_id: s.id, marker, detail: null, custom_label: null,
      source_title: s.title, source_type: s.source_type,
      source_document_id: s.document_id, source_event_id: s.event_id,
      source_year: s.year, source_author: s.author,
    })
  }
  async function citeDocument(d: PersonDocument) {
    try {
      const src = await api.documents.promoteToSource(d.id, d.title || d.filename)
      citeSource(src)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to cite document')
    }
  }
  function citeCustom() {
    const label = customCiteText.trim()
    if (!label) return
    const marker = nextMarker()
    insertMarkerAtCursor(marker)
    addOptimisticCitation({
      source_id: null, marker, detail: null, custom_label: label,
      source_title: null, source_type: null, source_document_id: null,
      source_event_id: null, source_year: null, source_author: null,
    })
  }

  const citeableDocs = allDocs
    .filter(d => d.id !== docId)
    .filter(d => plainMentions(d.title || d.filename).toLowerCase().includes(citeSearch.toLowerCase()))
    .slice(0, 40)
  const citeableSources = sources
    .filter(s => s.title.toLowerCase().includes(citeSearch.toLowerCase()))
    .slice(0, 40)

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-2">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 pb-1.5 border-b border-zinc-800 shrink-0">
        <ToolbarBtn onClick={() => wrapSelection('**', '**')} title={t('textDoc.bold')}><strong>B</strong></ToolbarBtn>
        <ToolbarBtn onClick={() => wrapSelection('*', '*')} title={t('textDoc.italic')}><em>I</em></ToolbarBtn>
        <ToolbarBtn onClick={() => wrapSelection('~~', '~~')} title={t('textDoc.strike')}><span className="line-through">S</span></ToolbarBtn>
        <span className="w-px h-4 bg-zinc-700 mx-1" />
        <ToolbarBtn onClick={() => insertLinePrefix('- ')} title={t('textDoc.list')}>• —</ToolbarBtn>
        <ToolbarBtn onClick={() => insertLinePrefix('> ')} title={t('textDoc.quote')}>"</ToolbarBtn>
        <span className="w-px h-4 bg-zinc-700 mx-1" />
        <div className="relative">
          <button type="button"
            onClick={() => { setShowCitePicker(p => !p); setCiteSearch(''); setCiteTab('document'); setCustomCiteText('') }}
            className="flex items-center gap-1 px-2 py-0.5 text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-900/30 rounded transition-colors font-medium">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
            {t('textDoc.cite')}
          </button>
          {showCitePicker && (
            /* Drops leftward: this editor also lives in the carousel's
               right-docked panel, where a left-anchored menu runs off-screen. */
            <div className="absolute right-0 top-full mt-1 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 overflow-hidden" style={{ width: 280 }}>
              <div className="flex border-b border-zinc-800">
                {(['document', 'source', 'custom'] as const).map(k => (
                  <button key={k} type="button" onClick={() => setCiteTab(k)}
                    className={`flex-1 px-2 py-2 text-xs font-medium transition-colors ${citeTab === k ? 'text-amber-400 border-b-2 border-amber-500' : 'text-zinc-500 hover:text-zinc-300'}`}>
                    {t(k === 'document' ? 'textDoc.citeDocuments' : k === 'source' ? 'textDoc.citeSources' : 'textDoc.citeCustom')}
                  </button>
                ))}
              </div>
              {citeTab !== 'custom' ? (
                <>
                  <div className="p-2 border-b border-zinc-800">
                    <input autoFocus type="search" value={citeSearch} onChange={e => setCiteSearch(e.target.value)}
                      placeholder={t('docs.search')}
                      className="w-full bg-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none" />
                  </div>
                  <div className="max-h-52 overflow-y-auto">
                    {citeTab === 'document' ? (
                      citeableDocs.length === 0 ? (
                        <p className="text-xs text-zinc-600 px-3 py-3 italic">{t('docs.noResults')}</p>
                      ) : citeableDocs.map(d => (
                        <button key={d.id} type="button" onClick={() => citeDocument(d)}
                          className="w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors">
                          <p className="text-xs text-zinc-100 truncate">{plainMentions(d.title || d.filename)}</p>
                          <p className="text-xs text-zinc-500">
                            {[docTypeLabel(t, d.doc_type, undefined), d.year].filter(Boolean).join(' · ')}
                          </p>
                        </button>
                      ))
                    ) : (
                      citeableSources.length === 0 ? (
                        <p className="text-xs text-zinc-600 px-3 py-3 italic">{t('docs.noResults')}</p>
                      ) : citeableSources.map(s => (
                        <button key={s.id} type="button" onClick={() => citeSource(s)}
                          className="w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors">
                          <p className="text-xs text-zinc-100 truncate">{s.title}</p>
                          <p className="text-xs text-zinc-500">{[s.source_type, s.year, s.author].filter(Boolean).join(' · ')}</p>
                        </button>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <div className="p-3 space-y-2">
                  <p className="text-xs text-zinc-500">{t('textDoc.citeCustomHint')}</p>
                  <input autoFocus value={customCiteText} onChange={e => setCustomCiteText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); citeCustom() } }}
                    placeholder={t('textDoc.citeCustomPh')}
                    className="w-full bg-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none border border-zinc-700 focus:border-amber-600" />
                  <button type="button" onClick={citeCustom} disabled={!customCiteText.trim()}
                    className="w-full py-1.5 text-xs font-medium bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 disabled:opacity-40 rounded-lg transition-colors">
                    {t('textDoc.insertCite')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <textarea ref={textareaRef} autoFocus={autoFocus} value={value} onChange={handleChange}
        onKeyDown={e => { mention.handleKeyDown(e) }}
        placeholder={t('docs.descPh')}
        className={className ?? 'flex-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-400 resize-none leading-relaxed'} />

      {citations.length > 0 && (
        <div className="shrink-0 max-h-16 overflow-y-auto space-y-0.5">
          {[...citations].sort((a, b) => a.marker - b.marker).map(c => (
            <div key={c.id} className="flex items-center gap-2">
              <span className="text-xs text-zinc-600 font-mono shrink-0 w-5 text-right">[{c.marker}]</span>
              <p className="text-xs text-amber-300 truncate flex-1">{c.custom_label ?? c.source_title ?? '—'}</p>
            </div>
          ))}
        </div>
      )}

      {err && <p className="text-xs text-red-400 shrink-0">{err}</p>}

      {mention.popup}
    </div>
  )
}

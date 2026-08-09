/**
 * Editor for documents written inside the app — a family chronicle, a
 * transcription, a research memo.
 *
 * The body is Markdown, with the same two constructs the note editor uses:
 * `@name` mentions a person, and the Cite button drops a `[n]` marker backed by
 * a source (an existing document, a source record, or free text). Photos from
 * the library can be attached alongside.
 *
 * Creating and editing share this component: on create nothing is written until
 * Save, so an abandoned draft leaves nothing behind.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type {
  PersonDocument, PersonFull, DocumentType, Source, NoteCitation, ImageItem, ImagesPage,
} from '../types'
import { useT, useSettings, displayPersonName } from '../SettingsContext'
import { personMatches, FamilyContextLines, personLifeSummary } from '../familyContext'
import { usePersonDirectory, PersonMultiSelect } from './PersonSelect'
import { renderMarkdown } from '../markdown'
import { docTypeLabel } from '../docTypes'

// ── @ mention helper ──────────────────────────────────────────────────────────

function getAtMentionContext(text: string, cursorPos: number): { query: string; atStart: number } | null {
  const before = text.slice(0, cursorPos)
  const idx = before.lastIndexOf('@')
  if (idx === -1) return null
  const afterAt = before.slice(idx)
  if (afterAt.includes('[') || afterAt.includes('\n')) return null
  return { query: before.slice(idx + 1), atStart: idx }
}

function ToolbarBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" onMouseDown={e => { e.preventDefault(); onClick() }} title={title}
      className="px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 rounded transition-colors font-mono">
      {children}
    </button>
  )
}

// ── PhotoPickerModal ──────────────────────────────────────────────────────────

function PhotoPickerModal({ attachedIds, onPick, onClose }: {
  attachedIds: Set<number>
  onPick: (imageId: number) => void
  onClose: () => void
}) {
  const t = useT()
  const [sort, setSort] = useState<'exif_date_desc' | 'exif_date_asc' | 'id_desc' | 'filename_asc'>('exif_date_desc')
  const [search, setSearch] = useState('')
  const { data: page } = useQuery<ImagesPage>({
    queryKey: ['textdoc-images', sort, search],
    queryFn: () => api.images.list(1, 120, 'all', search, sort),
    staleTime: 60_000,
  })
  const images: ImageItem[] = page?.items ?? []

  return createPortal(
    <div className="fixed inset-0 z-[800] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ width: 520, maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 shrink-0">
          <p className="text-sm font-semibold text-zinc-100 mr-auto">{t('textDoc.pickPhoto')}</p>
          <select value={sort} onChange={e => setSort(e.target.value as typeof sort)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-400 outline-none focus:border-brand-400 cursor-pointer">
            <option value="exif_date_desc">{t('timeline.sortNewest')}</option>
            <option value="exif_date_asc">{t('timeline.sortOldest')}</option>
            <option value="id_desc">{t('timeline.sortRecent')}</option>
            <option value="filename_asc">{t('timeline.sortByName')}</option>
          </select>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-4 py-2 border-b border-zinc-800 shrink-0">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('docs.search')}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400" />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {images.length === 0 ? (
            <p className="text-sm text-zinc-500 italic text-center py-6">{t('timeline.noPhotos')}</p>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {images.map(img => {
                const attached = attachedIds.has(img.id)
                return (
                  <div key={img.id} className="relative aspect-square">
                    <button
                      onClick={() => !attached && onPick(img.id)}
                      disabled={attached}
                      title={attached ? t('timeline.alreadyAdded') : undefined}
                      className={`w-full h-full rounded-lg overflow-hidden bg-zinc-800 transition-all ${
                        attached ? 'ring-2 ring-brand-500 cursor-default' : 'hover:ring-2 hover:ring-brand-400 cursor-pointer'
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
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── TextDocumentEditor ────────────────────────────────────────────────────────

interface Props {
  /** Existing text document to edit; omit to create a new one. */
  doc?: PersonDocument
  types: DocumentType[]
  /** Pre-select these persons when creating. */
  initialPersonIds?: number[]
  onClose: () => void
  onSaved?: (doc: PersonDocument) => void
}

export default function TextDocumentEditor({ doc, types, initialPersonIds = [], onClose, onSaved }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const { nameOrder } = useSettings()
  const { persons, familyMap } = usePersonDirectory()

  const isNew = !doc
  const [title, setTitle]             = useState(doc?.title ?? '')
  const [docType, setDocType]         = useState(doc?.doc_type ?? 'other')
  const [year, setYear]               = useState(doc?.year ? String(doc.year) : '')
  const [description, setDescription] = useState(doc?.description ?? '')
  const [content, setContent]         = useState('')
  const [personIds, setPersonIds]     = useState<Set<number>>(
    () => new Set(doc ? doc.persons.map(p => p.id) : initialPersonIds),
  )
  const [citations, setCitations]     = useState<NoteCitation[]>(doc?.citations ?? [])
  const [images, setImages]           = useState(doc?.images ?? [])
  const [tab, setTab]                 = useState<'write' | 'preview'>('write')
  const [saving, setSaving]           = useState(false)
  const [err, setErr]                 = useState<string | null>(null)
  const [showPhotoPicker, setShowPhotoPicker] = useState(false)

  const { data: sources = [] } = useQuery<Source[]>({ queryKey: ['sources'], queryFn: api.sources.list })
  const { data: allDocs = [] } = useQuery<PersonDocument[]>({ queryKey: ['docs-all'], queryFn: api.documents.listAll })

  // Cite picker
  const [showCitePicker, setShowCitePicker] = useState(false)
  const [citeTab, setCiteTab]   = useState<'document' | 'source' | 'custom'>('document')
  const [citeSearch, setCiteSearch] = useState('')
  const [customCiteText, setCustomCiteText] = useState('')

  // @ mention
  const [mentionCtx, setMentionCtx] = useState<{ query: string; atStart: number } | null>(null)
  const [mentionCursor, setMentionCursor] = useState(0)
  const [mentionPos, setMentionPos] = useState<{ top: number; left: number } | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load the existing body once.
  useEffect(() => {
    if (!doc) return
    let cancelled = false
    api.documents.getText(doc.id)
      .then(r => { if (!cancelled) setContent(r.content) })
      .catch(() => { if (!cancelled) setErr(t('textDoc.loadFailed')) })
    return () => { cancelled = true }
  }, [doc?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !showPhotoPicker) onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose, showPhotoPicker])

  // Drop citations whose [n] marker has been deleted from the text.
  useEffect(() => {
    setCitations(prev => prev.filter(c => content.includes(`[${c.marker}]`)))
  }, [content])

  const mentionMatches = useMemo(() => {
    if (!mentionCtx) return []
    return persons.filter(p => personMatches(p, mentionCtx.query, nameOrder)).slice(0, 8)
  }, [mentionCtx, persons, nameOrder])

  useEffect(() => { setMentionCursor(0) }, [mentionMatches])

  // ── editing helpers ────────────────────────────────────────────────────────

  function handleContentChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setContent(val)
    const ctx = getAtMentionContext(val, e.target.selectionStart ?? val.length)
    setMentionCtx(ctx)
    if (ctx && textareaRef.current) {
      const rect = textareaRef.current.getBoundingClientRect()
      setMentionPos({ top: rect.top, left: rect.left })
    } else if (!ctx) {
      setMentionPos(null)
    }
  }

  function insertMention(person: PersonFull) {
    const ta = textareaRef.current
    if (!ta || !mentionCtx) return
    const name = displayPersonName(person, nameOrder) || `Person ${person.id}`
    const link = `@[${name}](#pid-${person.id})`
    const next = content.slice(0, mentionCtx.atStart) + link + content.slice(ta.selectionStart)
    setContent(next)
    setMentionCtx(null)
    requestAnimationFrame(() => {
      const pos = mentionCtx.atStart + link.length
      ta.selectionStart = ta.selectionEnd = pos
      ta.focus()
    })
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!mentionCtx || mentionMatches.length === 0) return
    if (e.key === 'ArrowDown')      { e.preventDefault(); setMentionCursor(c => Math.min(c + 1, mentionMatches.length - 1)) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionCursor(c => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionMatches[mentionCursor]) }
    else if (e.key === 'Escape')    { e.preventDefault(); setMentionCtx(null) }
  }

  function nextMarker() {
    return citations.length > 0 ? Math.max(...citations.map(c => c.marker)) + 1 : 1
  }

  function insertMarkerAtCursor(marker: number) {
    const ta = textareaRef.current
    if (!ta) return
    const token = `[${marker}]`
    const start = ta.selectionStart
    setContent(content.slice(0, start) + token + content.slice(ta.selectionEnd))
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + token.length
      ta.focus()
    })
  }

  function addOptimisticCitation(c: Omit<NoteCitation, 'id' | 'note_id'>) {
    setCitations(prev => [...prev, { ...c, id: -Date.now(), note_id: doc?.id ?? 0 } as NoteCitation])
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

  /**
   * Cite another document. Citations point at sources, so the document is
   * promoted to one first — the endpoint returns the existing source if it
   * already has one, so citing the same document twice makes no duplicates.
   */
  async function citeDocument(d: PersonDocument) {
    try {
      const src = await api.documents.promoteToSource(d.id, d.title || d.filename)
      qc.invalidateQueries({ queryKey: ['sources'] })
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

  function wrapSelection(before: string, after: string) {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart, end = ta.selectionEnd
    const selected = content.slice(start, end)
    setContent(content.slice(0, start) + before + selected + after + content.slice(end))
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
    setContent(content.slice(0, lineStart) + prefix + content.slice(lineStart))
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + prefix.length
      ta.focus()
    })
  }

  // ── photos ─────────────────────────────────────────────────────────────────

  const attachedIds = useMemo(() => new Set(images.map(i => i.image_id)), [images])

  async function attachPhoto(imageId: number) {
    if (doc) {
      const updated = await api.documents.addImage(doc.id, imageId)
      setImages(updated.images)
    } else {
      // No document row yet — remember the pick and attach it on save.
      setImages(prev => prev.some(i => i.image_id === imageId) ? prev : [
        ...prev,
        { id: -imageId, image_id: imageId, image_path: null, caption: null, sort_order: prev.length },
      ])
    }
    setShowPhotoPicker(false)
  }

  async function detachPhoto(imageId: number) {
    if (doc) {
      const updated = await api.documents.removeImage(doc.id, imageId)
      setImages(updated.images)
    } else {
      setImages(prev => prev.filter(i => i.image_id !== imageId))
    }
  }

  // ── save ───────────────────────────────────────────────────────────────────

  const canSave = personIds.size > 0 && !saving

  async function save() {
    if (!canSave) return
    setSaving(true); setErr(null)
    try {
      const meta = {
        title: title.trim() || undefined,
        doc_type: docType || 'other',
        year: year ? parseInt(year) : undefined,
        description: description.trim() || undefined,
      }

      let saved: PersonDocument
      if (doc) {
        await api.documents.update(doc.id, {
          title: meta.title ?? null,
          doc_type: meta.doc_type,
          year: meta.year ?? null,
          description: meta.description ?? null,
        })
        await api.documents.saveText(doc.id, content)

        // Person links: diff against what the document had.
        const before = new Set(doc.persons.map(p => p.id))
        for (const id of personIds) if (!before.has(id)) await api.documents.linkPerson(doc.id, id)
        for (const id of before) if (!personIds.has(id)) await api.documents.unlinkPerson(doc.id, id)

        // Citations: drop the removed ones, persist the new ones.
        const kept = new Set(citations.filter(c => c.id > 0).map(c => c.id))
        for (const c of doc.citations) if (!kept.has(c.id)) await api.documents.deleteCitation(c.id)
        for (const c of citations) {
          if (c.id < 0) {
            await api.documents.addCitation(doc.id, {
              source_id: c.source_id ?? undefined,
              marker: c.marker,
              detail: c.detail ?? undefined,
              custom_label: c.custom_label ?? undefined,
            })
          }
        }
        saved = { ...doc, ...meta } as PersonDocument
      } else {
        saved = await api.documents.createText({
          ...meta,
          content,
          person_ids: [...personIds],
        })
        for (const c of citations) {
          await api.documents.addCitation(saved.id, {
            source_id: c.source_id ?? undefined,
            marker: c.marker,
            detail: c.detail ?? undefined,
            custom_label: c.custom_label ?? undefined,
          })
        }
        for (const img of images) await api.documents.addImage(saved.id, img.image_id)
      }

      qc.invalidateQueries({ queryKey: ['docs-all'] })
      for (const pid of personIds) qc.invalidateQueries({ queryKey: ['person-docs', pid] })
      if (doc) for (const p of doc.persons) qc.invalidateQueries({ queryKey: ['person-docs', p.id] })
      onSaved?.(saved)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── cite picker data ───────────────────────────────────────────────────────

  const citeableDocs = allDocs
    .filter(d => d.id !== doc?.id)
    .filter(d => (d.title || d.filename).toLowerCase().includes(citeSearch.toLowerCase()))
    .slice(0, 40)

  const citeableSources = sources
    .filter(s => s.title.toLowerCase().includes(citeSearch.toLowerCase()))
    .slice(0, 40)

  const previewHtml = useMemo(() => renderMarkdown(content, citations), [content, citations])

  return (
    <>
      <div className="fixed inset-0 z-[650] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{ width: 900, maxWidth: '95vw', height: '88vh' }}
          onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-zinc-800 shrink-0">
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold mb-0.5">{t('docs.heading')}</p>
              <h2 className="text-sm font-semibold text-zinc-100">
                {isNew ? t('textDoc.newTitle') : t('textDoc.editTitle')}
              </h2>
            </div>
            <button onClick={onClose}
              className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
              </svg>
            </button>
          </div>

          <div className="flex-1 flex min-h-0">
            {/* ── Left: the document body ── */}
            <div className="flex-1 flex flex-col min-w-0 border-r border-zinc-800">
              <div className="px-5 pt-4 pb-3 space-y-2 shrink-0">
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('textDoc.titlePh')}
                  className="w-full bg-transparent text-base font-semibold text-zinc-100 placeholder-zinc-600 outline-none" />
                <div className="flex gap-2">
                  <select value={docType} onChange={e => setDocType(e.target.value)}
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-brand-400">
                    {types.map(dt => <option key={dt.key} value={dt.key}>{docTypeLabel(t, dt.key, dt.label)}</option>)}
                    {types.length === 0 && <option value="other">{t('person.docFallback')}</option>}
                  </select>
                  <input type="number" value={year} onChange={e => setYear(e.target.value)} placeholder={t('docs.yearPh')}
                    className="w-24 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400" />
                </div>
              </div>

              {/* Toolbar */}
              <div className="flex items-center gap-0.5 px-4 py-1.5 border-y border-zinc-800 bg-zinc-900/60 shrink-0">
                <ToolbarBtn onClick={() => wrapSelection('**', '**')} title={t('textDoc.bold')}><strong>B</strong></ToolbarBtn>
                <ToolbarBtn onClick={() => wrapSelection('*', '*')} title={t('textDoc.italic')}><em>I</em></ToolbarBtn>
                <ToolbarBtn onClick={() => wrapSelection('~~', '~~')} title={t('textDoc.strike')}><span className="line-through">S</span></ToolbarBtn>
                <span className="w-px h-4 bg-zinc-700 mx-1" />
                <ToolbarBtn onClick={() => insertLinePrefix('## ')} title={t('textDoc.heading')}>H</ToolbarBtn>
                <ToolbarBtn onClick={() => insertLinePrefix('- ')} title={t('textDoc.list')}>• —</ToolbarBtn>
                <ToolbarBtn onClick={() => insertLinePrefix('> ')} title={t('textDoc.quote')}>"</ToolbarBtn>
                <span className="w-px h-4 bg-zinc-700 mx-1" />

                {/* Cite */}
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
                    <div className="absolute left-0 top-full mt-1 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 overflow-hidden"
                      style={{ width: 320 }}>
                      <div className="flex border-b border-zinc-800">
                        {(['document', 'source', 'custom'] as const).map(k => (
                          <button key={k} type="button" onClick={() => setCiteTab(k)}
                            className={`flex-1 px-2 py-2 text-xs font-medium transition-colors ${
                              citeTab === k ? 'text-amber-400 border-b-2 border-amber-500' : 'text-zinc-500 hover:text-zinc-300'
                            }`}>
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
                                  <p className="text-xs text-zinc-100 truncate">{d.title || d.filename}</p>
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
                                  <p className="text-xs text-zinc-500">
                                    {[s.source_type, s.year, s.author].filter(Boolean).join(' · ')}
                                  </p>
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

                {/* Write / Preview */}
                <div className="ml-auto flex items-center gap-0.5 bg-zinc-800/80 rounded-lg p-0.5">
                  {(['write', 'preview'] as const).map(k => (
                    <button key={k} type="button" onClick={() => setTab(k)}
                      className={`px-2.5 py-0.5 text-xs rounded-md transition-colors ${
                        tab === k ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                      }`}>
                      {t(k === 'write' ? 'textDoc.write' : 'textDoc.preview')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {tab === 'write' ? (
                  <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={handleContentChange}
                    onKeyDown={handleTextareaKeyDown}
                    placeholder={t('textDoc.bodyPh')}
                    className="w-full h-full min-h-full bg-transparent px-5 py-4 text-sm text-zinc-200 placeholder-zinc-600 outline-none resize-none leading-relaxed font-mono"
                  />
                ) : (
                  <div className="px-5 py-4">
                    {content.trim() ? (
                      <div className="note-content text-sm text-zinc-300 leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: previewHtml }} />
                    ) : (
                      <p className="text-sm text-zinc-600 italic">{t('textDoc.emptyPreview')}</p>
                    )}
                  </div>
                )}
              </div>

              {/* References strip */}
              {citations.length > 0 && (
                <div className="shrink-0 border-t border-zinc-800 px-5 py-2 max-h-28 overflow-y-auto">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-600 mb-1">{t('textDoc.references')}</p>
                  {[...citations].sort((a, b) => a.marker - b.marker).map(c => (
                    <div key={c.id} className="flex items-start gap-2 group/ref">
                      <span className="text-xs text-zinc-600 font-mono shrink-0 w-5 text-right">[{c.marker}]</span>
                      <p className="text-xs text-amber-300 truncate flex-1">{c.custom_label ?? c.source_title ?? '—'}</p>
                      <button type="button"
                        onClick={() => {
                          setCitations(prev => prev.filter(x => x.marker !== c.marker))
                          setContent(prev => prev.replace(new RegExp(`\\[${c.marker}\\]`, 'g'), ''))
                        }}
                        className="shrink-0 opacity-0 group-hover/ref:opacity-100 text-zinc-600 hover:text-red-400 transition-all">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Right: metadata sidebar ── */}
            <div className="w-80 shrink-0 overflow-y-auto px-4 py-4 space-y-5 bg-zinc-950/30">
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-2">{t('docs.linkedPersons')}</p>
                <PersonMultiSelect
                  persons={persons}
                  familyMap={familyMap}
                  selectedIds={personIds}
                  onToggle={id => setPersonIds(prev => {
                    const next = new Set(prev)
                    next.has(id) ? next.delete(id) : next.add(id)
                    return next
                  })}
                  maxHeight={240}
                />
                {personIds.size === 0 && (
                  <p className="text-xs text-amber-500/80 mt-1.5">{t('docs.selectPerson')}</p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">
                    {t('textDoc.photos')} {images.length > 0 ? `(${images.length})` : ''}
                  </p>
                  <button onClick={() => setShowPhotoPicker(true)}
                    className="text-xs text-zinc-500 hover:text-brand-400 transition-colors">
                    {t('textDoc.attachPhoto')}
                  </button>
                </div>
                {images.length > 0 ? (
                  <div className="grid grid-cols-3 gap-1.5">
                    {images.map(img => (
                      <div key={img.image_id} className="relative aspect-square group/img">
                        <img src={api.imageViewUrl(img.image_id, 200)} alt=""
                          className="w-full h-full object-cover rounded-lg" />
                        <button onClick={() => detachPhoto(img.image_id)}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-zinc-300 hover:text-red-400 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-600 italic">{t('textDoc.noPhotos')}</p>
                )}
              </div>

              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-2">{t('docs.descPh')}</p>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
                  placeholder={t('textDoc.descHint')}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400 resize-none" />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 px-5 py-3 border-t border-zinc-800 flex items-center gap-2">
            {err && <p className="text-xs text-red-400 truncate flex-1">{err}</p>}
            <button onClick={save} disabled={!canSave}
              className="ml-auto px-5 h-9 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm font-medium transition-colors">
              {saving ? t('docs.saving') : t('docs.save')}
            </button>
            <button onClick={onClose}
              className="px-4 h-9 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors">
              {t('docs.cancel')}
            </button>
          </div>
        </div>
      </div>

      {/* @ mention dropdown */}
      {mentionCtx !== null && mentionMatches.length > 0 && mentionPos !== null && createPortal(
        <div
          style={{
            position: 'fixed', top: mentionPos.top, left: mentionPos.left + 16,
            zIndex: 9999, width: 288, transform: 'translateY(calc(-100% - 6px))',
          }}
          className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
        >
          <p className="px-3 pt-2 pb-1 text-xs font-semibold text-zinc-600 uppercase tracking-wider">
            {t('textDoc.mentionPerson')}
          </p>
          <div className="max-h-64 overflow-y-auto">
            {mentionMatches.map((p, i) => {
              const active = i === mentionCursor
              const bio = personLifeSummary(p)
              return (
                <button key={p.id} type="button"
                  onMouseDown={e => { e.preventDefault(); insertMention(p) }}
                  onMouseEnter={() => setMentionCursor(i)}
                  className={`w-full text-left px-3 py-2 transition-all ${active ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'}`}>
                  <p className={`text-xs font-medium ${active ? 'text-zinc-100' : 'text-zinc-200'}`}>
                    {displayPersonName(p, nameOrder)}
                  </p>
                  {bio && <p className="text-xs text-zinc-500 mt-0.5 truncate">{bio}</p>}
                  {active && <FamilyContextLines fam={familyMap.get(p.id)} />}
                </button>
              )
            })}
          </div>
        </div>,
        document.body,
      )}

      {showPhotoPicker && (
        <PhotoPickerModal
          attachedIds={attachedIds}
          onPick={attachPhoto}
          onClose={() => setShowPhotoPicker(false)}
        />
      )}
    </>
  )
}

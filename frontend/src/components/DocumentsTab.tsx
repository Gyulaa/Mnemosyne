import { useState, useRef, useEffect, useMemo, forwardRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { PersonDocument, PersonFull, DocumentType, DocumentPersonRef, NoteCitation } from '../types'
import DocumentViewer from './DocumentViewer'
import TextDocumentEditor from './TextDocumentEditor'
import { PersonMultiSelect, PersonFilterCombobox, usePersonDirectory } from './PersonSelect'
import { DatePartPicker } from './EventTimeline'
import { useT, useSettings, displayPersonName } from '../SettingsContext'
import { type useFamilyContext } from '../familyContext'
import { docTypeLabel } from '../docTypes'
import { MentionInput } from '../mentions'
import { plainMentions, plainMarkdown, renderTitleMentions } from '../markdown'
import { DescriptionField, persistDescriptionCitations } from './DescriptionField'
import ScanReadModal from './ScanReadModal'
import DocumentReadButton, { appendReading } from './DocumentReadButton'
import { useBackdropClose } from '../modalBackdrop'

// ── helpers ───────────────────────────────────────────────────────────────────

function isImage(mime: string | null) { return mime?.startsWith('image/') ?? false }
function isPdf(mime: string | null)   { return mime === 'application/pdf' }
function isAudio(mime: string | null) { return mime?.startsWith('audio/') ?? false }
function isVideo(mime: string | null) { return mime?.startsWith('video/') ?? false }

type SortMode = 'recent' | 'title_asc' | 'title_desc' | 'date_newest' | 'date_oldest'

/** Best available date for sorting: the document's own partial date, else its year. */
function docSortYear(d: PersonDocument): number {
  if (d.date) { const y = parseInt(d.date.split('-')[0]); if (Number.isFinite(y)) return y }
  return d.year ?? Number.NaN
}

/** Display name for a linked-person stub, in the user's configured name order. */
function refName(p: DocumentPersonRef, order: 'en' | 'hu', fallback = '(unnamed)') {
  return displayPersonName(p, order, fallback)
}

function fileIcon(mime: string | null, isText = false) {
  if (isText) return (
    <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z"/>
    </svg>
  )
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
  if (isVideo(mime)) return (
    <svg className="w-5 h-5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-2.36a.75.75 0 011.03.671v10.378a.75.75 0 01-1.03.671L15.75 17.5M4.5 6.75h9a1.5 1.5 0 011.5 1.5v9a1.5 1.5 0 01-1.5 1.5h-9a1.5 1.5 0 01-1.5-1.5v-9a1.5 1.5 0 011.5-1.5z"/>
    </svg>
  )
  return (
    <svg className="w-5 h-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
    </svg>
  )
}

// ── PersonChip ────────────────────────────────────────────────────────────────

function PersonChip({ person, onClick }: { person: DocumentPersonRef; onClick?: () => void }) {
  const { nameOrder } = useSettings()
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-700/60 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 text-xs transition-colors"
    >
      {refName(person, nameOrder)}
    </button>
  )
}

// ── CreateChooserModal ────────────────────────────────────────────────────────

/** First step of "New": write something here, or bring in a file. */
function CreateChooserModal({ onPick, onClose }: {
  onPick: (mode: 'text' | 'upload') => void
  onClose: () => void
}) {
  const t = useT()
  const backdrop = useBackdropClose(onClose)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const options = [
    {
      mode: 'text' as const,
      title: t('docs.chooseWriteTitle'),
      desc: t('docs.chooseWriteDesc'),
      icon: (
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
      ),
    },
    {
      mode: 'upload' as const,
      title: t('docs.chooseUploadTitle'),
      desc: t('docs.chooseUploadDesc'),
      icon: (
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 7.5 7.5 12M12 7.5v12" />
      ),
    },
  ]

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" {...backdrop}>
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl overflow-hidden w-[520px] max-w-[92vw]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-800">
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold mb-0.5">{t('docs.heading')}</p>
            <h2 className="text-sm font-semibold text-zinc-100">{t('docs.chooseTitle')}</h2>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          {options.map(o => (
            <button key={o.mode} onClick={() => onPick(o.mode)}
              className="group flex flex-col items-start gap-2 p-4 rounded-xl bg-zinc-800/50 border border-zinc-700/70 hover:border-brand-500 hover:bg-zinc-800 transition-colors text-left">
              <span className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-700 group-hover:border-brand-500/60 flex items-center justify-center transition-colors">
                <svg className="w-5 h-5 text-zinc-400 group-hover:text-brand-400 transition-colors"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  {o.icon}
                </svg>
              </span>
              <span className="text-sm font-semibold text-zinc-100">{o.title}</span>
              <span className="text-xs text-zinc-500 leading-relaxed">{o.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── TypeManagerModal ──────────────────────────────────────────────────────────

function TypeManagerModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { data: types = [] } = useQuery<DocumentType[]>({ queryKey: ['doc-types'], queryFn: api.documentTypes.list })
  const t = useT()
  const backdrop = useBackdropClose(onClose)
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
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" {...backdrop}>
      {/* 560px, not 420: the add-type row packs two inputs and a button on one
          line, and at 420 the longer localised placeholders were clipped. */}
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl overflow-hidden w-[560px] max-w-[92vw] max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-800 shrink-0">
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold mb-0.5">{t('docs.heading')}</p>
            <h2 className="text-sm font-semibold text-zinc-100">{t('docs.manageTypesTitle')}</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M6 6l12 12M6 18L18 6"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Existing types */}
          <ul className="divide-y divide-zinc-800">
            {types.map(dt => (
              <li key={dt.id} className="flex items-center gap-3 px-5 py-2.5 group">
                <code className="text-xs text-zinc-600 font-mono min-w-[100px] shrink-0">{dt.key}</code>
                {editingId === dt.id ? (
                  <input
                    autoFocus
                    value={editLabel}
                    onChange={e => setEditLabel(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') updateMut.mutate({ id: dt.id, label: editLabel })
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="flex-1 bg-zinc-700 border border-zinc-500 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-brand-400"
                  />
                ) : (
                  <span className="flex-1 text-xs text-zinc-200">{docTypeLabel(t, dt.key, dt.label)}</span>
                )}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  {editingId === dt.id ? (
                    <>
                      <button onClick={() => updateMut.mutate({ id: dt.id, label: editLabel })}
                        className="text-xs px-2 py-0.5 bg-brand-600 hover:bg-brand-500 text-white rounded transition-colors">{t('docs.save')}</button>
                      <button onClick={() => setEditingId(null)}
                        className="text-xs px-2 py-0.5 bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded transition-colors">{t('docs.cancel')}</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setEditingId(dt.id); setEditLabel(dt.label) }}
                        className="w-6 h-6 rounded flex items-center justify-center text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700 transition-colors">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2.25 2.25 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2.414a2 2 0 01.586-1.414z"/></svg>
                      </button>
                      <button onClick={() => { if (confirm(t('docs.deleteTypeConfirm', { label: dt.label }))) deleteMut.mutate(dt.id) }}
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
            <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-2.5">{t('docs.addNewType')}</p>
            <div className="flex gap-2">
              <input
                value={newKey}
                onChange={e => setNewKey(e.target.value)}
                placeholder={t('docs.typeKeyPh')}
                className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400 font-mono"
              />
              <input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder={t('docs.typeLabelPh')}
                className="flex-[1.3] min-w-0 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400"
                onKeyDown={e => { if (e.key === 'Enter' && newKey && newLabel) createMut.mutate() }}
              />
              <button
                onClick={() => createMut.mutate()}
                disabled={!newKey.trim() || !newLabel.trim() || createMut.isPending}
                className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors shrink-0"
              >{t('docs.addTypeBtn')}</button>
            </div>
            {createMut.isError && (
              <p className="text-xs text-red-400 mt-1.5">{String(createMut.error)}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── TitleField ───────────────────────────────────────────────────────────────

/**
 * A document title with the same inline `@` mention picker every other text
 * field has — type `@`, pick a person, and `@[Name](#pid-N)` replaces the `@…`
 * while they are linked to the document.
 *
 * The wiring itself is `MentionInput` in `mentions.tsx`, shared with the event
 * title field; this only supplies the document's wording and styling. The
 * stored markup is identical to a Markdown body's, so the mention stays a real
 * reference to a person rather than a name that merely looks like one: it
 * survives a rename, renders as a clickable link, and tells the assistant who
 * the document is about. Everywhere a title has to be flat text — a filename,
 * an `alt`, a GEDCOM `TITL` — it goes through `plainMentions()`. Linking stays
 * one-way, as everywhere else: deleting the mention again does not unlink the
 * person.
 */
function TitleField({ value, onChange, onMentionPerson }: {
  value: string
  onChange: (next: string) => void
  onMentionPerson: (person: PersonFull) => void
}) {
  const t = useT()
  return (
    <MentionInput
      value={value} onChange={onChange} onMentionPerson={onMentionPerson}
      placeholder={t('docs.titlePh')}
      title={t('docs.mentionPersonInTitle')}
      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400"
    />
  )
}

// ── UploadModal ───────────────────────────────────────────────────────────────

function UploadModal({ persons, familyMap, types, onClose, onDone }: {
  persons: PersonFull[]
  familyMap: ReturnType<typeof useFamilyContext>
  types: DocumentType[]
  onClose: () => void
  onDone: () => void
}) {
  const t = useT()
  const qc = useQueryClient()
  const { nameOrder } = useSettings()
  const backdrop = useBackdropClose(onClose)
  const fileRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [title, setTitle] = useState('')
  const [docType, setDocType] = useState(types[0]?.key ?? 'other')
  const [date, setDate] = useState('')
  const [description, setDescription] = useState('')
  const [descCitations, setDescCitations] = useState<NoteCitation[]>([])
  const [selectedPersonIds, setSelectedPersonIds] = useState<number[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const togglePerson = (id: number) =>
    setSelectedPersonIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
  const selectedPersonIdSet = useMemo(() => new Set(selectedPersonIds), [selectedPersonIds])

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list)
    setFiles(prev => [...prev, ...incoming.filter(f => !prev.some(p => p.name === f.name && p.size === f.size))])
  }
  function removeFile(idx: number) {
    setFiles(prev => prev.filter((_, i) => i !== idx))
  }

  async function submit() {
    if (files.length === 0 || uploading) return
    setUploading(true); setErr(null)
    try {
      // Every selected file becomes one document — the first is its primary
      // file, the rest are attached alongside it (e.g. each page of a
      // scanned letter uploaded together).
      const created = await api.documents.upload(selectedPersonIds, files, {
        title: title.trim() || undefined,
        doc_type: docType || undefined,
        date: date || undefined,
        description: description.trim() || undefined,
      })
      // Citations can only be written once the document has an id, so the ones
      // added while composing are held optimistically and flushed here.
      if (descCitations.length > 0) await persistDescriptionCitations({ kind: 'document', id: created.id }, [], descCitations)
      qc.invalidateQueries({ queryKey: ['docs-all'] })
      for (const pid of selectedPersonIds) qc.invalidateQueries({ queryKey: ['person-docs', pid] })
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed')
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" {...backdrop}>
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl overflow-hidden w-[480px] max-w-[92vw] max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-800 shrink-0">
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold mb-0.5">{t('docs.heading')}</p>
            <h2 className="text-sm font-semibold text-zinc-100">{t('docs.uploadTitle')}</h2>
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
            onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files) }}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl px-4 py-5 text-center cursor-pointer transition-colors ${dragOver ? 'border-brand-400 bg-brand-500/10' : 'border-zinc-700 hover:border-zinc-500'}`}
          >
            <input ref={fileRef} type="file" multiple className="hidden"
              onChange={e => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = '' }} />
            {files.length > 0 ? (
              <p className="text-xs text-zinc-300">{t('docs.filesSelected', { n: files.length })} <span className="text-zinc-500">— {t('docs.addMoreFiles')}</span></p>
            ) : (
              <p className="text-xs text-zinc-500">{t('docs.dropHint')}</p>
            )}
          </div>

          {files.length > 0 && (
            <ul className="space-y-1 max-h-32 overflow-y-auto">
              {files.map((f, i) => (
                <li key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg px-2.5 py-1.5">
                  {fileIcon(f.type)}
                  <span className="text-xs text-zinc-200 truncate flex-1">{f.name}</span>
                  <button onClick={e => { e.stopPropagation(); removeFile(i) }} title={t('docs.removeFile')}
                    className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-zinc-700 transition-colors">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M6 6l12 12M6 18L18 6"/></svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Metadata */}
          <TitleField value={title} onChange={setTitle}
            onMentionPerson={p => setSelectedPersonIds(ids => ids.includes(p.id) ? ids : [...ids, p.id])} />

          <div className="flex flex-wrap gap-2 items-center">
            <select value={docType} onChange={e => setDocType(e.target.value)}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 outline-none focus:border-brand-400">
              {types.map(dt => <option key={dt.key} value={dt.key}>{docTypeLabel(t, dt.key, dt.label)}</option>)}
              {types.length === 0 && <option value="other">{t('person.docFallback')}</option>}
            </select>
            <DatePartPicker value={date} onChange={setDate} />
          </div>

          <DescriptionField
            owner={{ kind: 'document', id: null }}
            value={description} onChange={setDescription}
            citations={descCitations} onCitationsChange={setDescCitations}
            onMentionPerson={p => setSelectedPersonIds(ids => ids.includes(p.id) ? ids : [...ids, p.id])}
            className="w-full min-h-[96px] max-h-[40vh] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400 resize-y leading-relaxed"
          />

          {/* Person selection */}
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-2">{t('docs.linkedPersons')}</p>
            <PersonMultiSelect
              persons={persons}
              familyMap={familyMap}
              selectedIds={selectedPersonIdSet}
              onToggle={togglePerson}
              maxHeight={200}
            />
            {selectedPersonIds.length === 0 && (
              <p className="text-xs text-zinc-600 mt-1">{t('docs.noPersonHint')}</p>
            )}
          </div>

          {err && <p className="text-xs text-red-400 bg-red-950/50 border border-red-900/50 rounded-lg px-3 py-2">{err}</p>}
        </div>

        <div className="shrink-0 px-5 py-4 border-t border-zinc-800 flex gap-2">
          <button onClick={submit} disabled={files.length === 0 || uploading}
            className="flex-1 h-9 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2">
            {uploading ? (
              <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>{t('docs.uploading')}</>
            ) : t('docs.upload')}
          </button>
          <button onClick={onClose} className="px-4 h-9 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors">{t('docs.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── EditDocModal ──────────────────────────────────────────────────────────────

function EditDocModal({ doc, types, persons, familyMap, onClose }: {
  doc: PersonDocument
  types: DocumentType[]
  persons: PersonFull[]
  familyMap: ReturnType<typeof useFamilyContext>
  onClose: () => void
}) {
  const t = useT()
  const qc = useQueryClient()
  const { nameOrder } = useSettings()
  const backdrop = useBackdropClose(onClose)
  const [title, setTitle]           = useState(doc.title ?? '')
  const [docType, setDocType]       = useState(doc.doc_type ?? 'other')
  const [date, setDate]             = useState(doc.date ?? (doc.year ? String(doc.year) : ''))
  const [description, setDescription] = useState(doc.description ?? '')
  const [descCitations, setDescCitations] = useState(doc.description_citations ?? [])
  const [linkedIds, setLinkedIds]   = useState(() => new Set(doc.persons.map(p => p.id)))
  const [extraFiles, setExtraFiles] = useState(doc.files)
  // The primary file is a column on the document row, not a list entry, so it
  // needs its own state: removing it promotes the next file into that slot.
  const [primaryFile, setPrimaryFile] = useState({ filename: doc.filename, mime_type: doc.mime_type })
  const [saving, setSaving]         = useState(false)

  // What the description's citations were when the modal opened — the save
  // below writes the difference, not the whole set. Person links need no such
  // baseline here: `togglePerson` already persists each one as it happens.
  const initialCitations = useRef(doc.description_citations ?? []).current

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  async function removeExtraFile(fileId: number) {
    const updated = await api.documents.removeFile(doc.id, fileId)
    setExtraFiles(updated.files)
    qc.invalidateQueries({ queryKey: ['docs-all'] })
  }

  // Removing the primary file promotes the first extra one into its place, so
  // it is confirmed: it changes which file the document shows everywhere.
  async function removePrimaryFile() {
    if (!confirm(t('docs.removePrimaryConfirm'))) return
    const updated = await api.documents.removePrimaryFile(doc.id)
    setPrimaryFile({ filename: updated.filename, mime_type: updated.mime_type })
    setExtraFiles(updated.files)
    qc.invalidateQueries({ queryKey: ['docs-all'] })
    for (const pid of linkedIds) qc.invalidateQueries({ queryKey: ['person-docs', pid] })
  }

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
        date: date || null,
        // Omitted when a date is set — the backend derives year from it, as events do.
        year: date ? undefined : null,
        description: description.trim() || null,
      })
      await persistDescriptionCitations({ kind: 'document', id: doc.id }, initialCitations, descCitations)
      qc.invalidateQueries({ queryKey: ['docs-all'] })
      for (const pid of linkedIds) qc.invalidateQueries({ queryKey: ['person-docs', pid] })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[650] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" {...backdrop}>
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl w-[480px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-zinc-800 shrink-0">
          <div className="min-w-0 flex-1 pr-3">
            <h2 className="text-sm font-semibold text-zinc-100">{t('docs.editDocTitle')}</h2>
            <p className="text-xs text-zinc-500 mt-0.5 truncate">{plainMentions(doc.title || doc.filename)}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M6 6l12 12M6 18L18 6"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <TitleField value={title} onChange={setTitle}
            onMentionPerson={p => { if (!linkedIds.has(p.id)) togglePerson(p.id) }} />

          <div className="flex flex-wrap gap-2 items-center">
            <select value={docType} onChange={e => setDocType(e.target.value)}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 outline-none focus:border-brand-400">
              {types.map(dt => <option key={dt.key} value={dt.key}>{docTypeLabel(t, dt.key, dt.label)}</option>)}
              {types.length === 0 && <option value="other">{t('person.docFallback')}</option>}
            </select>
            <DatePartPicker value={date} onChange={setDate} />
          </div>

          <DescriptionField
            owner={{ kind: 'document', id: doc.id }}
            value={description} onChange={setDescription}
            citations={descCitations} onCitationsChange={setDescCitations}
            onMentionPerson={p => { if (!linkedIds.has(p.id)) togglePerson(p.id) }}
            className="w-full min-h-[96px] max-h-[40vh] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400 resize-y leading-relaxed"
          />

          {/* Directly under the field it writes into, because that is the whole
              behaviour: the reading is appended to the description. The server
              has already appended it to the saved description by the time this
              returns, so the draft is advanced by the same rule rather than
              replaced — whatever was being typed here survives. */}
          <DocumentReadButton
            doc={doc}
            onRead={text => {
              setDescription(prev => appendReading(prev, text))
              qc.invalidateQueries({ queryKey: ['docs-all'] })
              for (const pid of linkedIds) qc.invalidateQueries({ queryKey: ['person-docs', pid] })
            }}
          />

          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-2">{t('docs.attachedFiles')}</p>
            <ul className="space-y-1">
              <li className="flex items-center gap-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg px-2.5 py-1.5">
                {fileIcon(primaryFile.mime_type)}
                <span className="text-xs text-zinc-200 truncate flex-1">{primaryFile.filename}</span>
                <span className="text-xs text-zinc-600 shrink-0">{t('docs.primaryFile')}</span>
                <button onClick={removePrimaryFile} disabled={extraFiles.length === 0}
                  title={extraFiles.length === 0 ? t('docs.removePrimaryOnly') : t('docs.removeFile')}
                  className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-zinc-700 disabled:opacity-30 disabled:hover:text-zinc-500 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M6 6l12 12M6 18L18 6"/></svg>
                </button>
              </li>
              {extraFiles.map(f => (
                <li key={f.id} className="flex items-center gap-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg px-2.5 py-1.5">
                  {fileIcon(f.mime_type)}
                  <span className="text-xs text-zinc-200 truncate flex-1">{f.filename}</span>
                  <button onClick={() => removeExtraFile(f.id)} title={t('docs.removeFile')}
                    className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-zinc-700 transition-colors">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M6 6l12 12M6 18L18 6"/></svg>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-2">{t('docs.linkedPersons')}</p>
            <PersonMultiSelect
              persons={persons}
              familyMap={familyMap}
              selectedIds={linkedIds}
              onToggle={togglePerson}
              maxHeight={220}
            />
          </div>
        </div>

        <div className="shrink-0 px-5 py-3 border-t border-zinc-800 flex gap-2">
          <button onClick={save} disabled={saving}
            className="flex-1 h-9 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm font-medium transition-colors">
            {saving ? t('docs.saving') : t('docs.save')}
          </button>
          <button onClick={onClose} className="px-4 h-9 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors">
            {t('docs.cancel')}
          </button>
        </div>
      </div>
    </div>
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
  const t = useT()
  const qc = useQueryClient()
  const [previewing, setPreviewing] = useState(false)
  const displayName = doc.title || doc.filename
  const typeLabel = docTypeLabel(t, doc.doc_type, typeMap.get(doc.doc_type ?? ''))
  // Text documents open in the viewer too — it renders their Markdown body.
  const canPreview = doc.is_text || isImage(doc.mime_type) || isPdf(doc.mime_type) || isAudio(doc.mime_type) || isVideo(doc.mime_type) || doc.files.length > 0

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
        className={`group transition-colors cursor-pointer ${highlighted ? 'ring-2 ring-inset ring-brand-400/50' : ''} ${selected ? 'bg-brand-900/20' : ''}`}
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
        onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)' }}
        onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLElement).style.background = '' }}
        onClick={() => canPreview ? setPreviewing(true) : undefined}
      >
        {/* Checkbox */}
        <td className="pl-4 pr-1 py-2.5 w-10 shrink-0" onClick={e => { e.stopPropagation(); onToggleSelect?.() }}>
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
            {isImage(doc.mime_type) && !doc.is_text
              ? <img src={api.documents.fileUrl(doc.id)} alt="" className="w-full h-full object-cover" />
              : fileIcon(doc.mime_type, doc.is_text)}
          </div>
        </td>
        {/* Title + description */}
        <td className="py-2.5 pr-4">
          {/* Mentioned people are links here too; the row itself opens the
              document, so a click on a name must not also do that. */}
          <p className="text-xs font-medium text-zinc-100 truncate max-w-[260px]"
            onClick={e => {
              const anchor = (e.target as Element).closest('a.note-person-ref')
              if (!anchor) return
              e.preventDefault(); e.stopPropagation()
              const m = anchor.getAttribute('href')?.match(/person-ref-(\d+)$/)
              if (m) onNavToGenealogy(parseInt(m[1]))
            }}
            dangerouslySetInnerHTML={{ __html: renderTitleMentions(doc.title || doc.filename) }} />
          {doc.description && (
            <p className="text-xs text-zinc-600 truncate max-w-[260px]">{plainMarkdown(doc.description)}</p>
          )}
        </td>
        {/* Type */}
        <td className="py-2.5 pr-4 whitespace-nowrap">
          <span className="text-xs px-1.5 py-0.5 rounded-md bg-zinc-800 text-zinc-400 font-medium">{typeLabel}</span>
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
              <span className="text-xs text-zinc-500 self-center">+{doc.persons.length - 3}</span>
            )}
          </div>
        </td>
        {/* Actions */}
        <td className="py-2.5 pr-4 w-24" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
            <button onClick={onEdit} title={t('docs.edit')}
              className="w-7 h-7 rounded flex items-center justify-center text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2.25 2.25 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2.414a2 2 0 01.586-1.414z"/></svg>
            </button>
            <a href={api.documents.fileUrl(doc.id, true)} title={t('docs.download')} onClick={e => e.stopPropagation()}
              className="w-7 h-7 rounded flex items-center justify-center text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            </a>
            <button onClick={() => { if (confirm(t('docs.deleteConfirm'))) deleteMut.mutate() }} title={t('docs.delete')}
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
  const t = useT()
  const qc = useQueryClient()
  const { nameOrder } = useSettings()
  const { data: docs = [] }    = useQuery<PersonDocument[]>({ queryKey: ['docs-all'], queryFn: api.documents.listAll })
  const { data: types = [] }   = useQuery<DocumentType[]>({ queryKey: ['doc-types'], queryFn: api.documentTypes.list })
  const { persons, familyMap } = usePersonDirectory()

  const [search, setSearch]           = useState('')
  const [filterType, setFilterType]   = useState<string>('__all__')
  const [filterPerson, setFilterPerson] = useState<number | null>(null)
  const [sortBy, setSortBy]           = useState<SortMode>('recent')
  const [selectedIds, setSelectedIds]  = useState<Set<number>>(new Set())
  const [includeNotes, setIncludeNotes] = useState(true)
  const [downloading, setDownloading]  = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [showChooser, setShowChooser] = useState(false)
  const [showUpload, setShowUpload]   = useState(false)
  const [creatingText, setCreatingText] = useState(false)
  const [showTypeManager, setShowTypeManager] = useState(false)
  const [showScanRead, setShowScanRead] = useState(false)
  const [editingDocId, setEditingDocId] = useState<number | null>(null)
  const [highlightedId, setHighlightedId] = useState<number | null>(null)
  /** A row asked for before the list contained it — see `openImportedDoc`. */
  const [pendingDocId, setPendingDocId] = useState<number | null>(null)
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map())

  const typeMap = new Map(types.map(dt => [dt.key, dt.label]))

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

  /** Scroll to and flash a document row — same path navTarget uses. */
  const openImportedDoc = (docId: number) => {
    // The reading modal sits over this table. Leaving it open made "open the
    // document" look like it did nothing at all.
    setShowScanRead(false)
    setSearch(''); setFilterType('__all__'); setFilterPerson(null)
    // And the row cannot be scrolled to until the document list that was just
    // invalidated has come back carrying it. That is a refetch, not a fixed
    // number of milliseconds — the effect below waits for the row itself.
    setPendingDocId(docId)
  }

  useEffect(() => {
    if (pendingDocId == null) return
    const el = rowRefs.current.get(pendingDocId)
    if (!el) return                      // not in the list yet; `docs` will re-run this
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedId(pendingDocId)
    setPendingDocId(null)
    const timer = setTimeout(() => setHighlightedId(null), 2000)
    return () => clearTimeout(timer)
  }, [pendingDocId, docs])

  const editingDoc = editingDocId != null ? docs.find(d => d.id === editingDocId) ?? null : null

  const filtered = docs.filter(d => {
    if (filterType !== '__all__' && d.doc_type !== filterType) return false
    if (filterPerson != null && !d.persons.some(p => p.id === filterPerson)) return false
    if (search) {
      const q = search.toLowerCase()
      const haystack = [
        // Titles hold mention markup; searching must not have to match `](#pid-`.
        d.title ? plainMentions(d.title) : null, d.filename,
        d.description ? plainMarkdown(d.description) : null,
        // Both orders, so searching "Anna Miklós" or "Miklós Anna" finds the same row.
        ...d.persons.flatMap(p => [p.name, refName(p, nameOrder, '')]),
      ].filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  }).sort((a, b) => {
    // Sorting is on the visible text, so a leading `@[` never decides the order.
    const titleOf = (d: PersonDocument) => plainMentions(d.title || d.filename)
    switch (sortBy) {
      case 'title_asc':  return titleOf(a).localeCompare(titleOf(b))
      case 'title_desc': return titleOf(b).localeCompare(titleOf(a))
      case 'date_newest':
      case 'date_oldest': {
        const ay = docSortYear(a), by = docSortYear(b)
        if (Number.isNaN(ay) && Number.isNaN(by)) return 0
        if (Number.isNaN(ay)) return 1   // undated documents sort last either way
        if (Number.isNaN(by)) return -1
        return sortBy === 'date_newest' ? by - ay : ay - by
      }
      default: return 0   // 'recent' — keep the API's created_at-desc order
    }
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
  async function handleBulkDelete() {
    if (selectedIds.size === 0 || bulkDeleting) return
    if (!confirm(t('docs.deleteNConfirm', { n: selectedIds.size }))) return
    setBulkDeleting(true)
    try {
      await api.documents.bulkDelete([...selectedIds])
      setSelectedIds(new Set())
      qc.invalidateQueries({ queryKey: ['docs-all'] })
    } catch (e) {
      alert(t('docs.deleteFailed', { e: String(e) }))
    } finally {
      setBulkDeleting(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {showChooser && (
        <CreateChooserModal
          onClose={() => setShowChooser(false)}
          onPick={mode => {
            setShowChooser(false)
            if (mode === 'text') setCreatingText(true)
            else setShowUpload(true)
          }}
        />
      )}
      {showUpload && (
        <UploadModal
          persons={persons}
          familyMap={familyMap}
          types={types}
          onClose={() => setShowUpload(false)}
          onDone={() => setShowUpload(false)}
        />
      )}
      {creatingText && (
        <TextDocumentEditor
          types={types}
          onClose={() => setCreatingText(false)}
        />
      )}
      {showTypeManager && (
        <TypeManagerModal onClose={() => setShowTypeManager(false)} />
      )}
      {editingDoc && (
        editingDoc.is_text ? (
          <TextDocumentEditor
            doc={editingDoc}
            types={types}
            onClose={() => setEditingDocId(null)}
          />
        ) : (
          <EditDocModal
            doc={editingDoc}
            types={types}
            persons={persons}
            familyMap={familyMap}
            onClose={() => setEditingDocId(null)}
          />
        )
      )}

      {showScanRead && (
        <ScanReadModal
          onClose={() => setShowScanRead(false)}
          onOpenDocument={openImportedDoc}
          onOpenPerson={onNavToGenealogy}
        />
      )}

      {/* Header */}
      <div className="shrink-0 border-b" style={{ background: '#111117', borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-3">
          <h1 className="text-sm font-semibold text-zinc-100">{t('docs.heading')}</h1>
          <span className="text-xs text-zinc-600 tabular-nums">{t('docs.totalCount', { n: docs.length })}</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setShowScanRead(true)}
              className="h-7 px-2.5 rounded-lg border border-zinc-700 bg-zinc-800/60 hover:bg-zinc-700 text-xs text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1.5">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12"/></svg>
              {t('scanread.open')}
            </button>
            <button onClick={() => setShowTypeManager(true)}
              className="h-7 px-2.5 rounded-lg border border-zinc-700 bg-zinc-800/60 hover:bg-zinc-700 text-xs text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1.5">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              {t('docs.manageTypes')}
            </button>
            <button onClick={() => setShowChooser(true)}
              className="h-7 px-3 rounded-lg bg-brand-600 hover:bg-brand-500 text-xs font-medium text-white transition-colors flex items-center gap-1.5">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
              {t('docs.newDoc')}
            </button>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="shrink-0 border-b" style={{ background: 'rgba(17,17,23,0.7)', backdropFilter: 'blur(8px)', borderColor: 'rgba(255,255,255,0.04)' }}>
        <div className="max-w-6xl mx-auto px-6 py-2.5 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <svg className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="7"/><path strokeLinecap="round" d="M20 20l-3.5-3.5"/>
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('docs.search')}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400"
            />
          </div>

          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-300 outline-none focus:border-brand-400 max-w-[160px]">
            <option value="__all__">{t('docs.allTypes')}</option>
            {types.map(dt => <option key={dt.key} value={dt.key}>{docTypeLabel(t, dt.key, dt.label)}</option>)}
          </select>

          <PersonFilterCombobox
            persons={personOptions}
            familyMap={familyMap}
            value={filterPerson}
            onChange={setFilterPerson}
          />

          <select value={sortBy} onChange={e => setSortBy(e.target.value as SortMode)}
            title={t('docs.sortBy')}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-300 outline-none focus:border-brand-400 max-w-[160px]">
            <option value="recent">{t('docs.sortRecent')}</option>
            <option value="title_asc">{t('docs.sortTitleAsc')}</option>
            <option value="title_desc">{t('docs.sortTitleDesc')}</option>
            <option value="date_newest">{t('docs.sortDateNewest')}</option>
            <option value="date_oldest">{t('docs.sortDateOldest')}</option>
          </select>

          {(search || filterType !== '__all__' || filterPerson != null) && (
            <button onClick={() => { setSearch(''); setFilterType('__all__'); setFilterPerson(null) }}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors shrink-0">
              {t('docs.clear')}
            </button>
          )}

          <span className="ml-auto text-xs text-zinc-600 tabular-nums shrink-0">{t('docs.resultCount', { n: filtered.length })}</span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-5">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-zinc-600">
              <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>
              <p className="text-sm">{docs.length === 0 ? t('docs.noDocuments') : t('docs.noResults')}</p>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ background: '#111117', border: '1px solid rgba(255,255,255,0.07)' }}>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b text-left" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                    {/* Select-all checkbox */}
                    <th className="pl-4 pr-1 py-2.5 w-10" onClick={toggleSelectAll}>
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
                    <th className="py-2.5 pr-4 text-xs text-zinc-500 font-semibold uppercase tracking-wider">{t('docs.colTitle')}</th>
                    <th className="py-2.5 pr-4 text-xs text-zinc-500 font-semibold uppercase tracking-wider whitespace-nowrap">{t('docs.colType')}</th>
                    <th className="py-2.5 pr-4 text-xs text-zinc-500 font-semibold uppercase tracking-wider w-14">{t('docs.colYear')}</th>
                    <th className="py-2.5 pr-4 text-xs text-zinc-500 font-semibold uppercase tracking-wider">{t('docs.colPersons')}</th>
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
            </div>
          )}
        </div>
      </div>

      {/* Floating bulk toolbar — matches the Images tab's centered pill for a coherent selection UX */}
      {someSelected && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-6 py-3.5 bg-zinc-900/90 backdrop-blur-xl border border-zinc-700/60 rounded-2xl shadow-2xl">
          <span className="text-sm text-zinc-200 font-semibold tabular-nums">{t('docs.selectedCount', { n: selectedIds.size })}</span>
          <div className="w-px h-5 bg-zinc-700 shrink-0" />
          <label className="flex items-center gap-2 cursor-pointer select-none whitespace-nowrap">
            <div
              onClick={() => setIncludeNotes(v => !v)}
              className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${includeNotes ? 'bg-brand-500 border-brand-400' : 'border-zinc-600 hover:border-zinc-400'}`}
            >
              {includeNotes && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 10" stroke="currentColor" strokeWidth={2}><path d="M1 5l3 3 7-7"/></svg>
              )}
            </div>
            <span className="text-xs text-zinc-400">{t('docs.includeNotes')}</span>
          </label>
          <button
            onClick={handleBulkDownload}
            disabled={downloading || bulkDeleting}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-brand-500 hover:bg-brand-400 disabled:opacity-50 disabled:cursor-wait text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
            {downloading ? t('docs.buildingZip') : t('docs.downloadZip')}
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={bulkDeleting || downloading}
            className="px-4 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            {bulkDeleting ? t('docs.deleting') : t('docs.deleteN', { n: selectedIds.size })}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="px-3 py-1.5 text-zinc-500 hover:text-zinc-300 text-sm transition-colors whitespace-nowrap"
          >
            {t('docs.clear')}
          </button>
        </div>
      )}

    </div>
  )
}

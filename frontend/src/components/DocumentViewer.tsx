import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { PersonDocument, PersonFull, DocumentNote, Source } from '../types'
import { useSettings, displayPersonName, displayInitials, useT } from '../SettingsContext'
import { NoteCard } from './NoteEditor'
import NoteEditorComponent from './NoteEditor'
import { renderMarkdown } from '../markdown'
import { docTypeLabel } from '../docTypes'

function isImage(mime: string | null) { return mime?.startsWith('image/') ?? false }
function isPdf(mime: string | null)   { return mime === 'application/pdf' }
function isAudio(mime: string | null) { return mime?.startsWith('audio/') ?? false }

function PersonAvatar({ person }: { person: PersonFull }) {
  const [err, setErr] = useState(false)
  const init = displayInitials(person)
  if (person.thumbnail_face_id && !err) {
    return (
      <img
        src={api.faceThumbnailUrl(person.thumbnail_face_id, 80)}
        className="w-full h-full object-cover"
        onError={() => setErr(true)}
      />
    )
  }
  return <span className="text-sm font-bold text-zinc-300">{init}</span>
}


interface Props {
  doc: PersonDocument
  onClose: () => void
  onNavToPerson: (personId: number) => void
  onNavToDocument?: (docId: number, editMode?: boolean) => void
}

export default function DocumentViewer({ doc, onClose, onNavToPerson, onNavToDocument }: Props) {
  const t = useT()
  const { nameOrder } = useSettings()
  const { data: persons = [] }   = useQuery<PersonFull[]>({ queryKey: ['persons'], queryFn: api.persons.list })
  const { data: types = [] }     = useQuery({ queryKey: ['doc-types'], queryFn: api.documentTypes.list })
  const { data: sources = [] }   = useQuery<Source[]>({ queryKey: ['sources'], queryFn: api.sources.list })
  const {
    data: docNotes = [],
    refetch: refetchNotes,
  } = useQuery<DocumentNote[]>({
    queryKey: ['document-notes', doc.id],
    queryFn: () => api.documentNotes.list(doc.id),
  })

  const [creatingNote, setCreatingNote] = useState(false)
  const [newNoteShell, setNewNoteShell] = useState<DocumentNote | null>(null)

  // Text documents keep their Markdown body in a .md file — fetch and render it.
  const { data: textBody } = useQuery({
    queryKey: ['document-text', doc.id],
    queryFn: () => api.documents.getText(doc.id),
    enabled: doc.is_text,
  })
  const bodyHtml = useMemo(
    () => (textBody ? renderMarkdown(textBody.content, doc.citations ?? []) : ''),
    [textBody, doc.citations],
  )

  const typeMap = new Map(types.map(dt => [dt.key, dt.label]))
  const fileUrl = api.documents.fileUrl(doc.id)
  const displayName = doc.title || doc.filename
  const typeLabel = docTypeLabel(t, doc.doc_type, typeMap.get(doc.doc_type ?? ''))
  const linkedPersons = (doc.persons ?? []).map(lp => persons.find(p => p.id === lp.id)).filter(Boolean) as PersonFull[]

  function handleBodyClick(e: React.MouseEvent<HTMLDivElement>) {
    const anchor = (e.target as Element).closest('a.note-person-ref')
    if (!anchor) return
    e.preventDefault()
    const match = (anchor as HTMLAnchorElement).getAttribute('href')?.match(/person-ref-(\d+)$/)
    if (match) { onClose(); onNavToPerson(parseInt(match[1])) }
  }

  async function startNewNote() {
    const created = await api.documentNotes.create(doc.id, { content: '' })
    setNewNoteShell(created)
    setCreatingNote(true)
  }

  const docNoteOps = api.documentNotes

  return (
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ width: doc.is_text ? 680 : 520, maxWidth: '92vw', maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-zinc-800 shrink-0">
          <div className="min-w-0 flex-1 pr-3">
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold mb-1">{typeLabel}</p>
            <h2 className="text-sm font-semibold text-zinc-100 leading-snug">{displayName}</h2>
            {doc.year && <p className="text-xs text-zinc-500 mt-0.5">{doc.year}</p>}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* Text-document body */}
          {doc.is_text && (
            <div className="px-5 pt-4">
              {textBody === undefined ? (
                <p className="text-xs text-zinc-600 italic">{t('textDoc.loading')}</p>
              ) : textBody.content.trim() ? (
                <div className="note-content text-sm text-zinc-300 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: bodyHtml }}
                  onClick={handleBodyClick} />
              ) : (
                <p className="text-sm text-zinc-600 italic">{t('textDoc.emptyBody')}</p>
              )}

              {(doc.citations?.length ?? 0) > 0 && (
                <div className="mt-4 border-t border-zinc-800 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-600 mb-1.5">
                    {t('textDoc.references')}
                  </p>
                  {[...doc.citations].sort((a, b) => a.marker - b.marker).map(c => (
                    <div key={c.id} className="flex items-start gap-2 py-0.5">
                      <span className="text-xs text-zinc-600 font-mono shrink-0 w-5 text-right">[{c.marker}]</span>
                      {c.source_document_id != null ? (
                        <button
                          onClick={() => onNavToDocument?.(c.source_document_id!)}
                          className="text-xs text-amber-400 hover:text-amber-200 truncate text-left transition-colors">
                          {c.custom_label ?? c.source_title ?? '—'}
                        </button>
                      ) : (
                        <span className="text-xs text-amber-300/90 truncate">{c.custom_label ?? c.source_title ?? '—'}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {(doc.images?.length ?? 0) > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-600 mb-2">
                    {t('textDoc.photos')} ({doc.images.length})
                  </p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {doc.images.map(img => (
                      <a key={img.image_id} href={api.imageViewUrl(img.image_id, 1600)} target="_blank" rel="noreferrer"
                        className="aspect-square rounded-lg overflow-hidden bg-zinc-800 hover:ring-2 hover:ring-brand-400 transition-all">
                        <img src={api.imageViewUrl(img.image_id, 240)} alt="" className="w-full h-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Preview */}
          {isImage(doc.mime_type) && !doc.is_text && (
            <div className="bg-zinc-950 flex items-center justify-center" style={{ maxHeight: 280, minHeight: 120 }}>
              <img src={fileUrl} alt={displayName} className="max-w-full max-h-[280px] object-contain" />
            </div>
          )}

          {isPdf(doc.mime_type) && (
            <div className="bg-zinc-950 flex items-center justify-center py-8">
              <div className="flex flex-col items-center gap-3 text-zinc-500">
                <svg className="w-12 h-12 text-red-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <a href={fileUrl} target="_blank" rel="noreferrer"
                  className="text-xs text-brand-400 hover:text-brand-300 underline underline-offset-2 transition-colors">
                  {t('docViewer.openPdf')}
                </a>
              </div>
            </div>
          )}

          {isAudio(doc.mime_type) && (
            <div className="bg-zinc-950 px-5 py-6">
              <audio controls src={fileUrl} className="w-full" />
            </div>
          )}

          {/* Metadata + notes */}
          <div className="px-5 py-4 space-y-5">

            {/* Description */}
            {doc.description && (
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-1">{t('docViewer.description')}</p>
                <p className="text-xs text-zinc-300 leading-relaxed">{doc.description}</p>
              </div>
            )}

            {/* Linked persons */}
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-2">
                {t('docViewer.linkedPersons')} {linkedPersons.length > 1 ? `(${linkedPersons.length})` : ''}
              </p>
              {linkedPersons.length > 0 ? (
                <div className="space-y-1.5">
                  {linkedPersons.map(person => {
                    const by = person.birth_date ? person.birth_date.slice(0, 4) : person.birth_year != null ? String(person.birth_year) : null
                    const dy = person.death_date ? person.death_date.slice(0, 4) : person.death_year != null ? String(person.death_year) : null
                    const years = [by, dy].filter(Boolean).join('–')
                    return (
                      <button
                        key={person.id}
                        onClick={() => { onClose(); onNavToPerson(person.id) }}
                        className="w-full flex items-center gap-3 px-3 py-2 bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/60 hover:border-zinc-600 rounded-xl transition-colors text-left group"
                      >
                        <div className="w-9 h-9 rounded-full bg-zinc-700 border border-zinc-600 shrink-0 overflow-hidden flex items-center justify-center">
                          <PersonAvatar person={person} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-zinc-100 truncate">{displayPersonName(person, nameOrder)}</p>
                          {years && <p className="text-xs text-zinc-500 tabular-nums">{years}</p>}
                        </div>
                        <svg className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-zinc-500 italic">{t('docViewer.noPersons')}</p>
              )}
            </div>

            {/* Notes */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">
                  {t('docViewer.notes')} {docNotes.length > 0 ? `(${docNotes.length})` : ''}
                </p>
                <button onClick={startNewNote} className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors">
                  {t('docViewer.addNote')}
                </button>
              </div>

              <div className="space-y-3">
                {docNotes.map(note => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    sources={sources}
                    persons={persons}
                    ops={docNoteOps}
                    onUpdated={() => refetchNotes()}
                    onDeleted={() => refetchNotes()}
                    onNavToPerson={id => { onClose(); onNavToPerson(id) }}
                  />
                ))}

                {creatingNote && newNoteShell && (
                  <NoteEditorComponent
                    note={newNoteShell}
                    sources={sources}
                    persons={persons}
                    ops={docNoteOps}
                    onNavToPerson={id => { onClose(); onNavToPerson(id) }}
                    onSaved={() => { refetchNotes(); setCreatingNote(false); setNewNoteShell(null) }}
                    onDeleted={() => { refetchNotes(); setCreatingNote(false); setNewNoteShell(null) }}
                    onCancel={async () => {
                      await api.documentNotes.delete(newNoteShell.id)
                      setCreatingNote(false)
                      setNewNoteShell(null)
                    }}
                    autoFocusContent
                  />
                )}

                {docNotes.length === 0 && !creatingNote && (
                  <p className="text-xs text-zinc-600 italic">{t('docViewer.noNotes')}</p>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-3 border-t border-zinc-800 flex items-center gap-3">
          {onNavToDocument && (
            <button
              onClick={() => { onClose(); onNavToDocument(doc.id, true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-lg text-xs text-zinc-300 hover:text-white transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2.25 2.25 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2.414a2 2 0 01.586-1.414z" />
              </svg>
              {t('docViewer.edit')}
            </button>
          )}
          <a
            href={api.documents.fileUrl(doc.id, true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-lg text-xs text-zinc-300 hover:text-white transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {t('docViewer.download')}
          </a>
          {(isImage(doc.mime_type) || isPdf(doc.mime_type) || isAudio(doc.mime_type)) && (
            <a href={fileUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-lg text-xs text-zinc-300 hover:text-white transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              {t('docViewer.open')}
            </a>
          )}
          <span className="ml-auto text-xs text-zinc-600 truncate">{doc.filename}</span>
        </div>
      </div>
    </div>
  )
}

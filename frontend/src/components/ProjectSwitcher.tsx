import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, downloadViaBrowser } from '../api'
import { useT } from '../SettingsContext'
import ExportModal from './ExportModal'
import MergeModal from './MergeModal'
import ShareModal from './ShareModal'

export default function ProjectSwitcher({
  onExportStart,
  onExportEnd,
}: {
  onExportStart?: (cancelFn: () => void) => void
  onExportEnd?: (error?: string) => void
}) {
  const t = useT()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importDedup, setImportDedup] = useState<{ reused: number; added: number } | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const ref = useRef<HTMLDivElement>(null)

  const { data: sharePersons = [] } = useQuery({
    queryKey: ['persons'], queryFn: api.persons.list, enabled: showShareModal,
  })
  const { data: shareRelations = [] } = useQuery({
    queryKey: ['relations'], queryFn: api.relations.list, enabled: showShareModal,
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: api.project.list,
    staleTime: 10_000,
  })
  const active = projects.find(p => p.is_active)

  // Close dropdown on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setCreating(false)
        setRenamingId(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // A quiet background pass prunes images whose files vanished from disk —
  // it starts on backend startup (loading the last-active project) and again
  // on every explicit switch below. Watch briefly and refresh once it's
  // done, but only if it actually removed something.
  const [watchingMaintenance, setWatchingMaintenance] = useState(true)
  const { data: maintenanceStatus } = useQuery({
    queryKey: ['maintenance-status'],
    queryFn: api.scan.maintenanceStatus,
    enabled: watchingMaintenance,
    refetchInterval: 2_000,
  })
  useEffect(() => {
    if (watchingMaintenance && maintenanceStatus && !maintenanceStatus.running) {
      setWatchingMaintenance(false)
      if (maintenanceStatus.removed_images > 0) qc.invalidateQueries()
    }
  }, [watchingMaintenance, maintenanceStatus, qc])

  const switchMut = useMutation({
    mutationFn: (id: string) => api.project.activate(id),
    onSuccess: () => {
      setOpen(false)
      qc.invalidateQueries()
      setWatchingMaintenance(true)
    },
  })

  const createMut = useMutation({
    mutationFn: (name: string) => api.project.create(name),
    onSuccess: () => {
      setCreating(false)
      setNewName('')
      setOpen(false)
      qc.invalidateQueries()
    },
  })

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.project.rename(id, name),
    onSuccess: () => {
      setRenamingId(null)
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.project.delete(id),
    onSuccess: (data) => {
      setOpen(false)
      if (data.new_active) {
        // Active project changed — invalidate everything (clusters, images, etc.)
        qc.invalidateQueries()
      } else {
        // Inactive project deleted — only the list needs refreshing
        qc.invalidateQueries({ queryKey: ['projects'] })
      }
    },
    onError: (e) => alert(t('projects.deleteFailed', { e: String(e) })),
  })

  async function handleExport({ name, includeGenealogy, includeFaceless, includeNotes, includeSources, includeEvents, includeDocuments, includeImages, includeScans }: { name: string; includeGenealogy: boolean; includeFaceless: boolean; includeNotes: boolean; includeSources: boolean; includeEvents: boolean; includeDocuments: boolean; includeImages: boolean; includeScans: boolean }) {
    if (exporting) return
    setShowExportModal(false)
    // Native download: the browser streams the archive to disk and shows its own
    // progress/cancel UI, so there is nothing here to await or abort.
    downloadViaBrowser(
      api.project.exportUrl(undefined, name, includeGenealogy, undefined, includeFaceless, includeNotes, includeSources, includeEvents, includeDocuments, includeImages, includeScans),
    )
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportDedup(null)
    try {
      const result = await api.project.importZip(file)
      setOpen(false)
      qc.invalidateQueries()
      if (result.images_reused > 0 || result.images_new > 0) {
        setImportDedup({ reused: result.images_reused, added: result.images_new })
      }
    } catch (e) {
      alert(t('projects.importFailed', { e: String(e) }))
    } finally {
      setImporting(false)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (newName.trim()) createMut.mutate(newName.trim())
  }

  function handleRename(e: React.FormEvent) {
    e.preventDefault()
    if (renamingId && renameVal.trim()) {
      renameMut.mutate({ id: renamingId, name: renameVal.trim() })
    }
  }

  function startRename(id: string, currentName: string) {
    setRenamingId(id)
    setRenameVal(currentName)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(o => !o); setCreating(false); setRenamingId(null) }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors text-sm text-zinc-200"
      >
        <svg className="w-3.5 h-3.5 text-zinc-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
        </svg>
        <span className="max-w-32 truncate">{active?.name ?? 'Collections'}</span>
        <svg className="w-3 h-3 text-zinc-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Image dedup toast — shown after successful project import */}
      {importDedup && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700 shadow-2xl text-sm text-zinc-200 animate-fade-in">
          <svg className="w-4 h-4 text-brand-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            {importDedup.reused > 0 && (
              <><span className="text-brand-300 font-medium">{importDedup.reused}</span> {importDedup.reused === 1 ? 'photo' : 'photos'} already on your machine — no duplicate saved.{' '}</>
            )}
            {importDedup.added > 0 && (
              <><span className="text-zinc-100 font-medium">{importDedup.added}</span> new {importDedup.added === 1 ? 'photo' : 'photos'} imported.</>
            )}
          </span>
          <button onClick={() => setImportDedup(null)} className="ml-1 text-zinc-500 hover:text-zinc-300 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {showShareModal && (
        <ShareModal
          persons={sharePersons}
          relations={shareRelations}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {showMergeModal && (
        <MergeModal
          onClose={() => setShowMergeModal(false)}
          onDone={() => qc.invalidateQueries()}
        />
      )}

      {showExportModal && (
        <ExportModal
          defaultName={active?.name ?? 'project'}
          showFacelessOption
          showScansOption
          onExport={handleExport}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-72 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Project list */}
          <div className="p-1.5 max-h-72 overflow-y-auto">
            {projects.length === 0 && (
              <p className="px-3 py-2 text-xs text-zinc-500">{t('projects.noCollections')}</p>
            )}
            {projects.map(p => (
              <div key={p.id}>
                {renamingId === p.id ? (
                  <form onSubmit={handleRename} className="flex gap-1.5 px-2 py-1.5">
                    <input
                      autoFocus
                      value={renameVal}
                      onChange={e => setRenameVal(e.target.value)}
                      className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-brand-400"
                    />
                    <button
                      type="submit"
                      disabled={!renameVal.trim() || renameMut.isPending}
                      className="px-2 py-1 bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-white text-xs rounded"
                    >
                      {t('projects.ok')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                      className="px-2 py-1 text-zinc-500 hover:text-zinc-300 text-xs"
                    >
                      ✕
                    </button>
                  </form>
                ) : (
                  <div className={`group flex items-center gap-1 px-2 py-1.5 rounded-lg ${
                    p.is_active ? 'bg-brand-400/15' : 'hover:bg-zinc-800'
                  }`}>
                    <button
                      className="flex-1 flex items-center gap-2 text-left text-sm min-w-0"
                      onClick={() => !p.is_active && switchMut.mutate(p.id)}
                      disabled={p.is_active || switchMut.isPending}
                    >
                      <span className={`truncate ${p.is_active ? 'text-brand-300 font-medium' : 'text-zinc-300'}`}>
                        {p.name}
                      </span>
                      {p.is_active && (
                        <span className="shrink-0 text-xs text-brand-400 font-medium">{t('projects.active')}</span>
                      )}
                    </button>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => startRename(p.id, p.name)}
                        title={t('projects.rename')}
                        className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors rounded"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2.414a2 2 0 01.586-1.414z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => {
                          const msg = p.is_active
                            ? t('projects.deleteActiveConfirm', { name: p.name })
                            : t('projects.deleteConfirm', { name: p.name })
                          if (confirm(msg)) deleteMut.mutate(p.id)
                        }}
                        title={t('projects.delete')}
                        className="p-1 text-zinc-600 hover:text-red-400 transition-colors rounded"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0a2 2 0 012-2h4a2 2 0 012 2M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Create project */}
          <div className="border-t border-zinc-800 p-2">
            {creating ? (
              <form onSubmit={handleCreate} className="flex gap-1.5">
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder={t('projects.namePh')}
                  autoFocus
                  className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-brand-400"
                />
                <button
                  type="submit"
                  disabled={!newName.trim() || createMut.isPending}
                  className="px-2.5 py-1.5 bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-white text-xs rounded-lg transition-colors"
                >
                  {createMut.isPending ? '…' : t('projects.create')}
                </button>
              </form>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="w-full px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors text-left flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                {t('projects.newCollection')}
              </button>
            )}
          </div>

          {/* Collection actions — one 2x2 grid rather than two independent
              rows, so the columns line up and a longer label cannot shift its
              neighbour. Labels are left-aligned for the same reason: centring
              puts each one at a position that depends on its own width. */}
          <div className="border-t border-zinc-800 p-2 flex flex-col gap-1.5">
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => setShowExportModal(true)}
                disabled={exporting || importing}
                title={t('projects.exportTooltip')}
                className="px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors flex items-center gap-1.5 min-w-0 disabled:opacity-50 disabled:cursor-wait"
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span className="truncate">{exporting ? t('projects.building') : t('projects.export')}</span>
              </button>
              <button
                onClick={() => importInputRef.current?.click()}
                disabled={importing || exporting}
                title={t('projects.importTooltip')}
                className="px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors flex items-center gap-1.5 min-w-0 disabled:opacity-50 disabled:cursor-wait"
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 14V4m-4 4l4-4 4 4" />
                </svg>
                <span className="truncate">{importing ? t('projects.importing') : t('projects.import')}</span>
              </button>
              <button
                onClick={() => { setOpen(false); setShowShareModal(true) }}
                disabled={exporting || importing}
                title={t('share.title')}
                className="px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors flex items-center gap-1.5 min-w-0 disabled:opacity-50 disabled:cursor-wait"
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.7 10.7a3 3 0 100 2.6m0-2.6l6.6-3.4m-6.6 6l6.6 3.4M18 7.5a3 3 0 11-6 0 3 3 0 016 0zm0 9a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="truncate">{t('share.button')}</span>
              </button>
              <button
                onClick={() => { setOpen(false); setShowMergeModal(true) }}
                disabled={importing || exporting}
                title={t('projects.mergeTooltip')}
                className="px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors flex items-center gap-1.5 min-w-0 disabled:opacity-50 disabled:cursor-wait"
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span className="truncate">{t('projects.mergeBtn')}</span>
              </button>
            </div>
            <input
              ref={importInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={handleImport}
            />
            {(exporting || importing) && (
              <div className="h-0.5 rounded-full bg-zinc-800 overflow-hidden mx-0.5">
                <div
                  className="h-full bg-brand-500 rounded-full"
                  style={{ width: '40%', animation: 'indeterminate 1.4s ease-in-out infinite' }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

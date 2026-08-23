import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type {
  TranscriptBatch, TranscriptBatchDetail, TranscriptPage, TranscriptPageFull,
  TranscriptStatus, TranscriptRelevance, DocumentAiSettings, TranscriptAnalysisStep,
  TranscriptQuestion,
} from '../types'
import { useT, useSettings } from '../SettingsContext'
import { renderMarkdown } from '../markdown'
import { PersonMultiSelect, usePersonDirectory } from './PersonSelect'
import FolderPicker from './FolderPicker'
import { useBackdropClose } from '../modalBackdrop'

/**
 * Triage for a folder of scans.
 *
 * The workflow this screen exists for: a folder arrives with two hundred
 * register photographs in it, four of which concern this family. Importing all
 * two hundred to find those four is the work being removed — so the files stay
 * where they are, only the transcript is stored, and a page becomes a Document
 * only when the user says so.
 *
 * Progress is polled rather than streamed, matching `ScanTab` — the job is a
 * daemon thread on the server with a status endpoint, and there is nothing to
 * show between two whole pages.
 */

const RELEVANCE_STYLES: Record<TranscriptRelevance, string> = {
  high: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  low: 'bg-zinc-500/15 text-zinc-400 border-zinc-600/40',
  none: 'bg-zinc-800 text-zinc-500 border-zinc-700',
}

const RELEVANCE_ORDER: TranscriptRelevance[] = ['high', 'medium', 'low', 'none']

/**
 * A column the user can drag, remembered per device.
 *
 * The right-hand panel holds a scan, a transcript and a report, and how much
 * room that deserves depends on the screen and on what is being done — reading
 * a dense page wants everything, picking through a list wants the list. A
 * hardcoded split is wrong for somebody either way, so the split is theirs.
 *
 * localStorage rather than the settings context: this is a per-device
 * preference like the assistant's style toggle, not a project setting.
 */
function useColumnWidth(key: string, initial: number, min: number, max: number) {
  const [width, setWidth] = useState(() => {
    try {
      const stored = parseInt(localStorage.getItem(key) || '', 10)
      return Number.isFinite(stored) ? Math.min(max, Math.max(min, stored)) : initial
    } catch {
      return initial
    }
  })

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(max, Math.max(min, startWidth + ev.clientX - startX))
      setWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      // Read back off the element rather than closing over a stale `width`.
      setWidth(w => { try { localStorage.setItem(key, String(w)) } catch { /* private mode */ } return w })
    }
    // Held on the body so the pointer keeps the resize cursor even when it
    // outruns the 5px handle, which it always does.
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return [width, onDragStart] as const
}

function Divider({ onDragStart }: { onDragStart: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onDragStart}
      role="separator"
      aria-orientation="vertical"
      className="shrink-0 w-1 cursor-col-resize bg-zinc-800 hover:bg-brand-500/60 active:bg-brand-500 transition-colors"
    />
  )
}

export default function ScanReadModal({ onClose, onOpenDocument, onOpenPerson }: {
  onClose: () => void
  onOpenDocument?: (documentId: number) => void
  onOpenPerson?: (personId: number) => void
}) {
  const t = useT()
  const { lang, nameOrder } = useSettings()
  const qc = useQueryClient()
  const backdrop = useBackdropClose(onClose)

  const [batchId, setBatchId] = useState<number | null>(null)
  const [pageId, setPageId] = useState<number | null>(null)
  /** Which of the two batch-level views the detail column shows behind a page. */
  const [detailView, setDetailView] = useState<'report' | 'ask'>('report')
  const [filter, setFilter] = useState<TranscriptRelevance | 'all'>('all')
  const [creating, setCreating] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [batchesWidth, dragBatches] = useColumnWidth('mnemosyne_scanread_batches', 224, 150, 420)
  const [listWidth, dragList] = useColumnWidth('mnemosyne_scanread_pages', 380, 220, 720)

  const { data: settings } = useQuery<DocumentAiSettings>({
    queryKey: ['transcriptSettings'], queryFn: api.transcripts.getSettings,
  })
  const { data: batches = [] } = useQuery<TranscriptBatch[]>({
    queryKey: ['transcriptBatches'], queryFn: api.transcripts.listBatches,
  })

  // Poll only while something is running: a finished batch is static, and a
  // modal left open on it should not keep the server busy.
  const { data: status } = useQuery<TranscriptStatus>({
    queryKey: ['transcriptStatus'],
    queryFn: api.transcripts.status,
    refetchInterval: q => (q.state.data?.running ? 1500 : false),
  })
  const running = !!status?.running

  const { data: batch } = useQuery<TranscriptBatchDetail>({
    queryKey: ['transcriptBatch', batchId],
    queryFn: () => api.transcripts.getBatch(batchId!),
    enabled: batchId != null,
    refetchInterval: running ? 2000 : false,
  })

  // The batch list carries per-status counts, so it goes stale on every page
  // the job finishes — not only when the job as a whole ends.
  useEffect(() => {
    if (running) qc.invalidateQueries({ queryKey: ['transcriptBatches'] })
  }, [running, status?.processed, qc])

  useEffect(() => {
    if (batchId == null && batches.length) setBatchId(batches[0].id)
  }, [batches, batchId])

  const pages = batch?.pages ?? []
  const shown = useMemo(
    () => (filter === 'all' ? pages : pages.filter(p => p.relevance === filter)),
    [pages, filter],
  )

  const blocked = settings && (!settings.enabled || !settings.configured)

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" {...backdrop}>
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col w-full"
        // Nearly the whole viewport: this screen shows a scan, its transcript
        // and a report side by side, and 1400px made all three cramped on a
        // wide display for no gain on a narrow one.
        style={{ maxWidth: 'min(98vw, 2400px)', height: '94vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 py-4 border-b border-zinc-800">
          <div className="pr-8">
            <h2 className="text-sm font-semibold text-zinc-100">{t('scanread.title')}</h2>
            <p className="text-xs text-zinc-500 mt-1 max-w-3xl">{t('scanread.intro')}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
        </div>

        {blocked && (
          <div className="mx-6 mt-4 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
            {!settings?.enabled ? t('scanread.disabled') : t('scanread.noKey')}
          </div>
        )}

        <div className="flex-1 min-h-0 flex">
          {/* ── batches ─────────────────────────────────────────────── */}
          <div className="shrink-0 flex flex-col" style={{ width: batchesWidth }}>
            <div className="p-3">
              <button
                onClick={() => setCreating(v => !v)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200"
              >
                + {t('scanread.newBatch')}
              </button>
            </div>
            {creating && <NewBatchForm onDone={() => setCreating(false)} onCreated={id => { setBatchId(id); setPageId(null) }} />}
            <div className="flex-1 overflow-y-auto px-2 pb-3">
              {batches.length === 0 && !creating && (
                <p className="px-2 py-4 text-xs text-zinc-600">{t('scanread.noBatches')}</p>
              )}
              {batches.map(b => (
                <button
                  key={b.id}
                  onClick={() => { setBatchId(b.id); setPageId(null); setFilter('all'); setPicked(new Set()) }}
                  className={`w-full text-left px-3 py-2 rounded-lg mb-1 ${
                    b.id === batchId ? 'bg-zinc-800 text-zinc-100' : 'hover:bg-zinc-800/50 text-zinc-400'
                  }`}
                >
                  <div className="text-xs font-medium truncate">{b.name}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    {b.total} {t('scanread.pages')}
                    {b.relevance.high ? <span className="text-emerald-400"> · {b.relevance.high} ✓</span> : null}
                  </div>
                </button>
              ))}
            </div>
            {settings && (
              <div className="px-4 py-3 border-t border-zinc-800 text-[11px] text-zinc-600">
                {t('scanread.quota')}: {settings.usage_month} / {settings.monthly_pages}
              </div>
            )}
          </div>

          <Divider onDragStart={dragBatches} />

          {/* ── the batch ───────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 flex flex-col">
            {batch ? (
              <>
                <BatchToolbar
                  batch={batch} status={status} running={running}
                  lang={lang} nameOrder={nameOrder}
                  picked={picked} onClearPicked={() => setPicked(new Set())}
                  onAsk={() => { setPageId(null); setDetailView('ask') }}
                  onDeleted={() => { setBatchId(null); setPageId(null) }}
                />
                <div className="flex-1 min-h-0 flex">
                  <div className="shrink-0 flex flex-col" style={{ width: listWidth }}>
                    <div className="px-3 py-2 border-b border-zinc-800 flex gap-1 flex-wrap">
                      <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
                        {t('scanread.filterAll')} ({pages.length})
                      </FilterChip>
                      {RELEVANCE_ORDER.filter(r => batch.relevance[r]).map(r => (
                        <FilterChip key={r} active={filter === r} onClick={() => setFilter(r)}>
                          {t(`scanread.relevance.${r}`)} ({batch.relevance[r]})
                        </FilterChip>
                      ))}
                    </div>
                    <div className="flex-1 overflow-y-auto p-2">
                      {shown.map(p => (
                        <PageRow
                          key={p.id} page={p} active={p.id === pageId}
                          checked={picked.has(p.id)}
                          onToggle={() => setPicked(prev => {
                            const next = new Set(prev)
                            next.has(p.id) ? next.delete(p.id) : next.add(p.id)
                            return next
                          })}
                          onClick={() => setPageId(p.id)}
                        />
                      ))}
                    </div>
                  </div>

                  <Divider onDragStart={dragList} />

                  <div className="flex-1 min-w-0 flex flex-col">
                    {/* Three views, not two. The questions used to sit under the
                        report, where they had a sliver of room and vanished the
                        moment an answer's page link was followed. */}
                    <div className="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-zinc-800">
                      <ViewTab active={pageId == null && detailView === 'report'}
                        onClick={() => { setPageId(null); setDetailView('report') }}>
                        {t('scanread.report')}
                      </ViewTab>
                      <ViewTab active={pageId == null && detailView === 'ask'}
                        onClick={() => { setPageId(null); setDetailView('ask') }}>
                        <span className="flex items-center gap-1.5 text-sky-300">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 10.5h8M8 14h5m-9 6.25 3.2-2.4A2 2 0 0 1 8.4 17.5H18a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12.75Z"/></svg>
                          {t('scanread.ask')}
                          {batch.questions.length > 0 && (
                            <span className="tabular-nums text-sky-500">{batch.questions.length}</span>
                          )}
                        </span>
                      </ViewTab>
                      {pageId != null && (
                        <ViewTab active onClick={() => {}}>
                          {pages.find(p => p.id === pageId)?.filename ?? t('scanread.page')}
                        </ViewTab>
                      )}
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto">
                      {pageId != null ? (
                        <PageDetail pageId={pageId} onOpenDocument={onOpenDocument} />
                      ) : detailView === 'ask' ? (
                        <AskPanel
                          batch={batch} pages={pages}
                          onOpenPage={setPageId}
                          onOpenPerson={onOpenPerson} onClose={onClose} />
                      ) : (
                        <BatchReport
                          batch={batch}
                          pages={pages}
                          // Scoped to *this* batch: the job state is global, and
                          // reading it raw told a freshly created batch that its
                          // analysis was running when the run belonged to another.
                          analysing={running && status?.batch_id === batch.id && status?.phase === 'analysing'}
                          onAsk={() => setDetailView('ask')}
                          onOpenPage={setPageId}
                          onOpenPerson={onOpenPerson} onClose={onClose} />
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-zinc-600">
                {t('scanread.noBatches')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── pieces ────────────────────────────────────────────────────────────────────

/** One of the detail column's views. Flat, because it is not a filter. */
function ViewTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-[11px] transition-colors ${
        active
          ? 'bg-zinc-800 text-zinc-100'
          : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
      }`}
    >
      {children}
    </button>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded-md text-[11px] ${
        active ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-800/60 text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {children}
    </button>
  )
}

function NewBatchForm({ onDone, onCreated }: { onDone: () => void; onCreated: (id: number) => void }) {
  const t = useT()
  const qc = useQueryClient()
  const [folder, setFolder] = useState('')
  const [name, setName] = useState('')
  const [recursive, setRecursive] = useState(true)
  const [error, setError] = useState('')

  const create = useMutation({
    mutationFn: () => api.transcripts.createBatch(folder, name || undefined, recursive),
    onSuccess: b => {
      qc.invalidateQueries({ queryKey: ['transcriptBatches'] })
      onCreated(b.id)
      onDone()
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="px-3 pb-3 space-y-2 border-b border-zinc-800 mb-2">
      <label className="block text-[11px] text-zinc-500">{t('scanread.folder')}</label>
      <FolderPicker value={folder} onChange={setFolder} />
      <input
        value={name} onChange={e => setName(e.target.value)}
        placeholder={t('scanread.batchName')}
        className="w-full px-2 py-1.5 rounded-md bg-zinc-800 border border-zinc-700 text-xs text-zinc-200"
      />
      <label className="flex items-center gap-2 text-[11px] text-zinc-500">
        <input type="checkbox" checked={recursive} onChange={e => setRecursive(e.target.checked)} />
        {t('scanread.recursive')}
      </label>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      <button
        disabled={!folder || create.isPending}
        onClick={() => { setError(''); create.mutate() }}
        className="w-full px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs text-white"
      >
        {t('scanread.create')}
      </button>
    </div>
  )
}

function BatchToolbar({ batch, status, running, lang, nameOrder, picked, onClearPicked, onDeleted, onAsk }: {
  batch: TranscriptBatchDetail
  status: TranscriptStatus | undefined
  running: boolean
  lang: string
  nameOrder: string
  picked: Set<number>
  onClearPicked: () => void
  onDeleted: () => void
  onAsk: () => void
}) {
  const t = useT()
  const qc = useQueryClient()
  const [error, setError] = useState('')

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['transcriptStatus'] })
    qc.invalidateQueries({ queryKey: ['transcriptBatches'] })
    qc.invalidateQueries({ queryKey: ['transcriptBatch', batch.id] })
  }
  const fail = (e: Error) => setError(e.message)

  const start = useMutation({
    mutationFn: (opts: { retryFailed?: boolean; pageIds?: number[] }) =>
      api.transcripts.start(batch.id, lang, nameOrder, opts.retryFailed ?? false, opts.pageIds),
    onSuccess: () => { refresh(); onClearPicked() }, onError: fail,
  })
  const again = useMutation({ mutationFn: () => api.transcripts.analyse(batch.id, lang, nameOrder), onSuccess: refresh, onError: fail })
  const stop = useMutation({ mutationFn: () => api.transcripts.stop(), onSuccess: refresh })
  // Free: pure arithmetic over what is already stored. Worth its own action
  // because the report is no longer automatic — after correcting a transcript
  // or adding people to the tree, the marks are what change, and there is no
  // reason to pay for a write-up to see it.
  const rematch = useMutation({
    mutationFn: () => api.transcripts.rematch(batch.id),
    onSuccess: refresh, onError: fail,
  })

  const drop = useMutation({
    mutationFn: () => api.transcripts.deleteBatch(batch.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transcriptBatches'] }); onDeleted() },
    onError: fail,
  })

  const unread = (batch.counts.pending ?? 0) + (batch.counts.running ?? 0)
  const failed = batch.counts.failed ?? 0
  const read = batch.counts.done ?? 0
  const mine = running && status?.batch_id === batch.id

  return (
    <div className="px-4 py-3 border-b border-zinc-800">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-zinc-300 font-medium">{batch.name}</span>
        <span className="text-[11px] text-zinc-600 truncate max-w-md" title={batch.folder ?? ''}>{batch.folder}</span>
        <div className="flex-1" />
        {mine ? (
          <button onClick={() => stop.mutate()} className="px-3 py-1.5 rounded-md bg-red-600/80 hover:bg-red-500 text-xs text-white">
            {t('scanread.stop')}
          </button>
        ) : (
          <>
            {/* The analysis leads, because once a page or two are readable it
                is the thing worth doing — it no longer waits for the folder. */}
            {read > 0 && (
              <button
                disabled={running || again.isPending}
                onClick={() => { setError(''); again.mutate() }}
                className="px-3 py-1.5 rounded-md bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-xs text-white font-medium"
              >
                {batch.analysis ? t('scanread.reanalyse') : t('scanread.analyse')}
                {unread > 0 ? ` (${read}/${batch.total})` : ''}
              </button>
            )}
            {/* Beside the analysis rather than only behind a tab. A tab is a
                label on a panel nobody has opened; the actions are looked for
                up here, so this is where the feature has to exist. */}
            {read > 0 && (
              <button
                onClick={onAsk}
                className="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-xs text-white font-medium flex items-center gap-1.5"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 10.5h8M8 14h5m-9 6.25 3.2-2.4A2 2 0 0 1 8.4 17.5H18a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12.75Z"/></svg>
                {t('scanread.ask')}
                {batch.questions.length > 0 && (
                  <span className="text-sky-200 tabular-nums">{batch.questions.length}</span>
                )}
              </button>
            )}
            {picked.size > 0 && (
              <button
                disabled={running || start.isPending}
                onClick={() => { setError(''); start.mutate({ pageIds: [...picked] }) }}
                className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs text-white"
              >
                {t('scanread.readPicked')} ({picked.size})
              </button>
            )}
            {picked.size === 0 && unread > 0 && (
              <button
                disabled={running || start.isPending}
                onClick={() => { setError(''); start.mutate({}) }}
                className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs text-white"
              >
                {unread === batch.total ? t('scanread.start') : t('scanread.resume')} ({unread})
              </button>
            )}
            {picked.size === 0 && failed > 0 && (
              <button
                disabled={running || start.isPending}
                onClick={() => { setError(''); start.mutate({ retryFailed: true }) }}
                className="px-3 py-1.5 rounded-md bg-amber-600/80 hover:bg-amber-500 disabled:opacity-40 text-xs text-white"
              >
                {t('scanread.retryFailed')} ({failed})
              </button>
            )}
            {read > 0 && (
              <button
                disabled={running || rematch.isPending}
                onClick={() => { setError(''); rematch.mutate() }}
                title={t('scanread.rematchHint')}
                className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs text-zinc-300"
              >
                {t('scanread.rematch')}
              </button>
            )}
            <button
              disabled={running}
              onClick={() => { if (confirm(t('scanread.deleteConfirm'))) drop.mutate() }}
              className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-red-900/60 disabled:opacity-40 text-xs text-zinc-400"
            >
              {t('scanread.delete')}
            </button>
          </>
        )}
      </div>

      {mine && status && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-zinc-500 mb-1">
            <span>
              {t(`scanread.phase.${status.phase}`)}
              {status.current_name ? ` · ${status.current_name}` : ''}
              {status.phase_seconds != null && status.phase_seconds > 3
                ? ` · ${Math.floor(status.phase_seconds / 60)}:${String(status.phase_seconds % 60).padStart(2, '0')}`
                : ''}
            </span>
            <span>{status.processed} / {status.total}{status.failed ? ` · ${status.failed} ✕` : ''}</span>
          </div>
          <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: status.total ? `${(status.processed / status.total) * 100}%` : '100%' }}
            />
          </div>
        </div>
      )}
      {!mine && unread > 0 && <p className="mt-2 text-[11px] text-zinc-600">{t('scanread.costHint')}</p>}
      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
    </div>
  )
}

/**
 * Intercept the app's reference anchors inside rendered Markdown.
 *
 * Shared by the report and the answers below it rather than copied into each:
 * the two render the same reference forms, and a copy is how one of them ends
 * up silently not opening a page.
 */
function useRefClick(
  onOpenPage: (pageId: number) => void,
  onOpenPerson?: (personId: number) => void,
  onClose?: () => void,
) {
  return (e: React.MouseEvent) => {
    const anchor = (e.target as Element).closest('a.note-person-ref, a.note-page-ref')
    if (!anchor) return
    e.preventDefault(); e.stopPropagation()
    const href = anchor.getAttribute('href') ?? ''
    // A page opens in this same modal; a person leaves it for the tree.
    const page = href.match(/page-ref-(\d+)$/)
    if (page) { onOpenPage(parseInt(page[1])); return }
    const person = href.match(/person-ref-(\d+)$/)
    if (person && onOpenPerson) { onClose?.(); onOpenPerson(parseInt(person[1])) }
  }
}

function BatchReport({ batch, pages, analysing, onAsk, onOpenPage, onOpenPerson, onClose }: {
  batch: TranscriptBatchDetail
  pages: TranscriptPage[]
  analysing: boolean
  onAsk: () => void
  onOpenPage: (pageId: number) => void
  onOpenPerson?: (personId: number) => void
  onClose?: () => void
}) {
  const t = useT()
  const read = batch.counts.done ?? 0
  const unread = (batch.counts.pending ?? 0) + (batch.counts.running ?? 0)
  const onRefClick = useRefClick(onOpenPage, onOpenPerson, onClose)

  return (
    <div className="p-6 space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-xs font-semibold text-zinc-300">{t('scanread.report')}</h3>
          {unread > 0 && batch.analysis && (
            <span className="px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/15 text-amber-300 text-[10px]">
              {t('scanread.partialReport', { read, total: batch.total })}
            </span>
          )}
          {/* The report is manual now, so how old it is decides whether it is
              still about the batch in front of you. */}
          {batch.analysed_at && (
            <span className="text-[10px] text-zinc-600">
              {t('scanread.lastAnalysed', { when: new Date(batch.analysed_at).toLocaleString() })}
            </span>
          )}
        </div>
        {batch.analysis_error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
            {t('scanread.reportFailed')}: {batch.analysis_error}
          </div>
        )}
        {batch.analysis ? (
          <div
            className="note-content text-sm text-zinc-300"
            // Same delegation the document and note views use: the report is
            // rendered HTML, so the anchors are intercepted rather than wired.
            onClick={onRefClick}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(batch.analysis, []) }}
          />
        ) : (
          <p className="text-xs text-zinc-600">
            {analysing
              ? t('scanread.analysing')
              : read === 0 ? t('scanread.reportPending') : t('scanread.reportManual')}
          </p>
        )}
      </div>

      <AnalysisSteps steps={batch.analysis_steps} live={analysing} pages={pages} />

      {/* The moment after reading the report is the moment a question forms,
          which makes this the one place the offer cannot be missed. */}
      {read > 0 && (
        <button
          onClick={onAsk}
          className="w-full text-left px-4 py-3 rounded-lg border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/15 transition-colors"
        >
          <span className="flex items-center gap-2 text-xs text-sky-300 font-medium">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 10.5h8M8 14h5m-9 6.25 3.2-2.4A2 2 0 0 1 8.4 17.5H18a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12.75Z"/></svg>
            {t('scanread.askCta')}
          </span>
          <span className="block mt-1 text-[11px] text-zinc-500">{t('scanread.askCtaHint')}</span>
        </button>
      )}
    </div>
  )
}

/**
 * Ask a question about this folder of scans, and read back what was asked.
 *
 * Scoped to the batch rather than folded into the assistant panel: an
 * un-imported page is working state — the export deletes it — so a folder the
 * user may still throw away must not colour every unrelated answer about the
 * family. The question is asked where the folder is being read.
 *
 * The conversation is **stored on the batch**, not held here. It started in
 * component state, and the first thing anyone does with an answer is open a
 * page it recommended — which unmounted this panel and took the conversation
 * with it, along with the reason they opened the page.
 */
function AskPanel({ batch, pages, onOpenPage, onOpenPerson, onClose }: {
  batch: TranscriptBatchDetail
  pages: TranscriptPage[]
  onOpenPage: (pageId: number) => void
  onOpenPerson?: (personId: number) => void
  onClose?: () => void
}) {
  const t = useT()
  const qc = useQueryClient()
  const { lang, nameOrder } = useSettings()
  const [question, setQuestion] = useState('')
  const [error, setError] = useState('')
  const onRefClick = useRefClick(onOpenPage, onOpenPerson, onClose)
  const read = batch.counts.done ?? 0

  const ask = useMutation({
    mutationFn: (q: string) =>
      api.transcripts.ask(batch.id, { question: q, lang, name_order: nameOrder }),
    onSuccess: (turn) => {
      if (turn.error && !turn.answer) setError(turn.error)
      else { setError(''); setQuestion('') }
      qc.invalidateQueries({ queryKey: ['transcriptBatch', batch.id] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const clear = useMutation({
    mutationFn: () => api.transcripts.clearQuestions(batch.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transcriptBatch', batch.id] }),
  })

  const submit = () => {
    const q = question.trim()
    if (!q || ask.isPending) return
    setError('')
    ask.mutate(q)
  }

  return (
    <div className="p-6 flex flex-col gap-4 min-h-full">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-zinc-300">{t('scanread.ask')}</h3>
        {batch.questions.length > 0 && (
          <button
            onClick={() => clear.mutate()}
            className="ml-auto text-[10px] text-zinc-600 hover:text-zinc-400"
          >
            {t('scanread.askClear')}
          </button>
        )}
      </div>

      {read === 0 ? (
        <p className="text-xs text-zinc-600">{t('scanread.askNeedsPages')}</p>
      ) : (
        <>
          <div className="flex-1 space-y-6">
            {batch.questions.length === 0 && !ask.isPending && (
              <p className="text-xs text-zinc-600">{t('scanread.askEmpty')}</p>
            )}
            {batch.questions.map(turn => (
              <AskTurn key={turn.id} turn={turn} pages={pages} onRefClick={onRefClick} />
            ))}
            {ask.isPending && (
              <div className="space-y-2">
                <p className="text-xs text-zinc-400">{question}</p>
                <p className="text-[11px] text-zinc-600 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {t('scanread.asking')}
                </p>
              </div>
            )}
          </div>

          {error && <p className="text-[11px] text-red-400">{error}</p>}

          <div className="shrink-0 space-y-2 pt-2 border-t border-zinc-800">
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              // Enter sends, Shift+Enter is a newline — the shape every chat box has.
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
              rows={3}
              placeholder={t('scanread.askPlaceholder')}
              className="w-full px-2 py-1.5 rounded-md bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 resize-y"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={submit}
                disabled={ask.isPending || !question.trim()}
                className="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-xs text-white"
              >
                {ask.isPending ? t('scanread.asking') : t('scanread.askSend')}
              </button>
              {/* Every question is a paid call, and nothing else on this screen is. */}
              <span className="text-[10px] text-zinc-600">{t('scanread.askCost')}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function AskTurn({ turn, pages, onRefClick }: {
  turn: TranscriptQuestion
  pages: TranscriptPage[]
  onRefClick: (e: React.MouseEvent) => void
}) {
  const t = useT()
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-400 border-l-2 border-zinc-700 pl-2">{turn.question}</p>
      {turn.error && !turn.answer ? (
        <p className="text-[11px] text-red-400">{turn.error}</p>
      ) : (
        <div
          className="note-content text-sm text-zinc-300"
          onClick={onRefClick}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.answer ?? '', []) }}
        />
      )}
      <AnalysisSteps steps={turn.steps} live={false} pages={pages} />
      {turn.created_at && (
        <p className="text-[10px] text-zinc-700">{new Date(turn.created_at).toLocaleString()}</p>
      )}
    </div>
  )
}

/**
 * What the analysis looked up while writing.
 *
 * The matching pass is arithmetic — it says *which* people a page touched. What
 * makes a match worth acting on is what the project already records about those
 * people, and only the project can answer that, so the report runs as an agent
 * loop over the same read-only tools the assistant uses. Showing the calls is
 * not decoration: it is the difference between a claim and a checkable one, and
 * it is the same reason a conversation keeps its tool calls.
 */
/**
 * What a tool call was actually *about*, in one short phrase.
 *
 * `page_id=29 ` is an id nobody can read. The filename is on screen two columns
 * to the left, so the step says the filename — the whole reason the steps are
 * shown is so a reader can tell research from assertion, and that needs the
 * step to name something they recognise.
 */
function stepSubject(step: TranscriptAnalysisStep, pages: TranscriptPage[]): string {
  const input = step.input ?? {}
  const pageId = input.page_id
  if (typeof pageId === 'number') {
    return pages.find(p => p.id === pageId)?.filename ?? `#${pageId}`
  }
  const query = input.query ?? input.text ?? input.name
  if (typeof query === 'string' && query.trim()) return `"${query}"`
  const personId = input.person_id ?? input.id
  if (typeof personId === 'number') return `#${personId}`
  const rest = Object.entries(input).map(([k, v]) => `${k}=${String(v)}`).join(' ')
  return rest || '—'
}

function AnalysisSteps({ steps, live, pages }: {
  steps: TranscriptAnalysisStep[]
  live: boolean
  pages: TranscriptPage[]
}) {
  const t = useT()
  const [open, setOpen] = useState<number | null>(null)
  if (!steps.length && !live) return null

  return (
    <div className="border-t border-zinc-800 pt-4">
      <h4 className="text-[11px] font-semibold text-zinc-400 mb-2 flex items-center gap-2">
        {t('scanread.steps')}
        {live && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
      </h4>
      {steps.length === 0 ? (
        <p className="text-[11px] text-zinc-600">{t('scanread.stepsPending')}</p>
      ) : (
        <ol className="space-y-1">
          {steps.map((s, i) => (
            <li key={i}>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-zinc-800/60 flex items-center gap-2"
              >
                <span className="text-[10px] text-zinc-600 tabular-nums w-5 shrink-0">{i + 1}.</span>
                <span className={`text-[11px] shrink-0 ${s.is_error ? 'text-red-400' : 'text-sky-300'}`}>
                  {t(`chat.tool.${s.tool}`)}
                </span>
                <span className="text-[10px] text-zinc-500 truncate flex-1" title={stepSubject(s, pages)}>
                  {stepSubject(s, pages)}
                </span>
                <span className="text-[10px] text-zinc-700 tabular-nums shrink-0">
                  {t('scanread.stepChars', { n: s.result_chars.toLocaleString() })}
                </span>
              </button>
              {open === i && (
                <pre className="mx-7 mt-1 mb-2 p-2 rounded-md bg-zinc-950/60 border border-zinc-800 text-[10px] text-zinc-400 whitespace-pre-wrap break-words max-h-52 overflow-y-auto">
                  {s.result_preview}
                  {s.result_chars > s.result_preview.length && (
                    <span className="text-zinc-600">{`\n… ${s.result_chars} chars total`}</span>
                  )}
                </pre>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function PageRow({ page, active, checked, onToggle, onClick }: {
  page: TranscriptPage
  active: boolean
  checked: boolean
  onToggle: () => void
  onClick: () => void
}) {
  const t = useT()
  return (
    <div
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-lg mb-1 cursor-pointer ${active ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'}`}
    >
      <div className="flex items-center gap-2">
        {/* Ticking a page must not also open it — reading a few named pages is
            a different action from looking at one. */}
        <input
          type="checkbox"
          checked={checked}
          onClick={e => e.stopPropagation()}
          onChange={onToggle}
          className="shrink-0 accent-emerald-500"
        />
        <span className="text-xs text-zinc-300 truncate flex-1">{page.filename}</span>
        {page.document_id != null && <span className="text-[10px] text-emerald-400 shrink-0">✓</span>}
      </div>
      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
        {page.relevance && (
          <span className={`px-1.5 py-0.5 rounded border text-[10px] ${RELEVANCE_STYLES[page.relevance]}`}>
            {t(`scanread.relevance.${page.relevance}`)}
          </span>
        )}
        <span className="text-[10px] text-zinc-600">{t(`scanread.status.${page.status}`)}</span>
        {page.edited && <span className="text-[10px] text-sky-400">{t('scanread.edited')}</span>}
        {page.corroboration && (
          <span className="px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/15 text-emerald-300 text-[10px]">
            {t(`scanread.corroboration.${page.corroboration.kind}`)}
            {page.corroboration.entry_no != null &&
              ` · ${t('scanread.corroboration.entry', { n: page.corroboration.entry_no })}`}
          </span>
        )}
        {page.incomplete && (
          <span className="px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/15 text-amber-300 text-[10px]">
            {t('scanread.incomplete')}
          </span>
        )}
      </div>
    </div>
  )
}

function PageDetail({ pageId, onOpenDocument }: {
  pageId: number
  onOpenDocument?: (documentId: number) => void
}) {
  const t = useT()
  const qc = useQueryClient()
  const { lang, nameOrder } = useSettings()
  const { persons, familyMap } = usePersonDirectory()

  const { data: page } = useQuery<TranscriptPageFull>({
    queryKey: ['transcriptPage', pageId],
    queryFn: () => api.transcripts.getPage(pageId),
  })

  const [text, setText] = useState('')
  const [zoomed, setZoomed] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setText(page?.text ?? '')
    setTitle(page?.filename ?? '')
    setDirty(false)
    setSelected(new Set())
    setError('')
    setZoomed(false)
  }, [page?.id, page?.text, page?.filename])

  const save = useMutation({
    mutationFn: () => api.transcripts.updatePage(pageId, { text }),
    onSuccess: () => {
      setDirty(false)
      qc.invalidateQueries({ queryKey: ['transcriptPage', pageId] })
      qc.invalidateQueries({ queryKey: ['transcriptBatch', page?.batch_id] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const readPage = useMutation({
    mutationFn: () => api.transcripts.start(page!.batch_id, lang, nameOrder, false, [pageId]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transcriptStatus'] })
      qc.invalidateQueries({ queryKey: ['transcriptBatch', page?.batch_id] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const bring = useMutation({
    mutationFn: () => api.transcripts.importPage(pageId, {
      person_ids: [...selected], title: title || null,
      date: page?.extraction?.date ?? null,
    }),
    onSuccess: () => {
      // Every list that counts documents has just changed, plus the batch's
      // own imported tally and this page's link.
      qc.invalidateQueries({ queryKey: ['transcriptPage', pageId] })
      qc.invalidateQueries({ queryKey: ['transcriptBatch', page?.batch_id] })
      qc.invalidateQueries({ queryKey: ['transcriptBatches'] })
      qc.invalidateQueries({ queryKey: ['documents'] })
      qc.invalidateQueries({ queryKey: ['persons'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  if (!page) return <div className="p-6 text-xs text-zinc-600">…</div>

  const isImage = (page.mime_type ?? '').startsWith('image/')

  return (
    <div className="p-5 space-y-4">
      {zoomed && isImage && (
        <Lightbox
          src={api.transcripts.fileUrl(page.id)}
          alt={page.filename}
          onClose={() => setZoomed(false)}
        />
      )}
      <div className="flex items-start gap-4">
        <div className="w-72 shrink-0">
          {isImage ? (
            <button
              type="button"
              onClick={() => setZoomed(true)}
              title={t('scanread.zoomHint')}
              className="block w-full rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-600 transition-colors cursor-zoom-in"
            >
              <img
                src={api.transcripts.fileUrl(page.id)}
                alt={page.filename}
                className="w-full block"
              />
            </button>
          ) : (
            <a
              href={api.transcripts.fileUrl(page.id)} target="_blank" rel="noreferrer"
              className="block px-3 py-6 rounded-lg border border-zinc-800 text-center text-xs text-zinc-400 hover:text-zinc-200"
            >
              {page.filename}
            </a>
          )}
          <p className="mt-2 text-[11px] text-zinc-600">
            {page.language ? `${page.language} · ` : ''}{page.method ?? ''}
          </p>
        </div>

        <div className="flex-1 min-w-0 space-y-3">
          {page.error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              {page.error}
            </div>
          )}
          {!page.text && !page.error && (
            <p className="text-xs text-zinc-600">{t('scanread.noTranscript')}</p>
          )}

          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">{t('scanread.transcript')}</label>
            <textarea
              value={text}
              onChange={e => { setText(e.target.value); setDirty(true) }}
              rows={8}
              className="w-full px-2 py-1.5 rounded-md bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 font-mono leading-relaxed"
            />
            <p className="mt-1 text-[11px] text-zinc-600">{t('scanread.uncertainHint')}</p>
          </div>


          <div className="flex items-center gap-2 flex-wrap">
            <button
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
              className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs text-zinc-200"
            >
              {dirty ? t('scanread.save') : t('scanread.saved')}
            </button>
            <button
              disabled={readPage.isPending}
              onClick={() => { setError(''); readPage.mutate() }}
              className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs text-zinc-200"
            >
              {t('scanread.readThis')}
            </button>
          </div>
        </div>
      </div>

      {page.extraction && <ExtractionCard extraction={page.extraction} />}

      {/* ── import ──────────────────────────────────────────────────── */}
      <div className="pt-4 border-t border-zinc-800">
        {page.document_id != null ? (
          <div className="flex items-center gap-3">
            <span className="text-xs text-emerald-400">{t('scanread.imported')}</span>
            {onOpenDocument && (
              <button
                onClick={() => onOpenDocument(page.document_id!)}
                className="text-xs text-sky-400 hover:text-sky-300"
              >
                {t('scanread.openDocument')} →
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] text-zinc-500 mb-1">{t('scanread.importTitle')}</label>
              <input
                value={title} onChange={e => setTitle(e.target.value)}
                className="w-full px-2 py-1.5 rounded-md bg-zinc-800 border border-zinc-700 text-xs text-zinc-200"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-500 mb-1">{t('scanread.importPersons')}</label>
              <PersonMultiSelect
                persons={persons} familyMap={familyMap}
                selectedIds={selected}
                onToggle={id => setSelected(prev => {
                  const next = new Set(prev)
                  next.has(id) ? next.delete(id) : next.add(id)
                  return next
                })}
                maxHeight={200}
              />
            </div>
            {error && <p className="text-[11px] text-red-400">{error}</p>}
            <button
              disabled={bring.isPending}
              onClick={() => { setError(''); bring.mutate() }}
              className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs text-white"
            >
              {t('scanread.import')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Full-screen view of one scan, inside the modal.
 *
 * Two sizes, not a zoom control: **fit** to read the layout of the page, and
 * **actual size** to read the hand. Old registers are photographed at a
 * resolution where fitting the page to a screen is exactly what makes the
 * writing illegible, so one click has to reach 1:1 with real scrollbars —
 * a slider would put the useful size somewhere the user has to hunt for.
 */
function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const t = useT()
  const backdrop = useBackdropClose(onClose)
  const [actual, setActual] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    // The modal underneath scrolls otherwise, and the page is lost on close.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/95 flex flex-col"
      {...backdrop}
    >
      <div className="shrink-0 flex items-center gap-3 px-5 py-3 text-xs text-zinc-400">
        <span className="truncate">{alt}</span>
        <div className="flex-1" />
        <button
          onClick={e => { e.stopPropagation(); setActual(v => !v) }}
          className="px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
        >
          {actual ? t('scanread.zoomFit') : t('scanread.zoomActual')}
        </button>
        <button onClick={onClose} className="px-2 text-lg leading-none text-zinc-400 hover:text-zinc-100">×</button>
      </div>
      <div className={`flex-1 min-h-0 ${actual ? 'overflow-auto' : 'overflow-hidden flex items-center justify-center'} px-5 pb-5`}>
        <img
          src={src}
          alt={alt}
          onClick={e => { e.stopPropagation(); setActual(v => !v) }}
          className={actual
            ? 'max-w-none cursor-zoom-out'
            : 'max-w-full max-h-full object-contain cursor-zoom-in'}
        />
      </div>
    </div>
  )
}

function ExtractionCard({ extraction }: { extraction: NonNullable<TranscriptPageFull['extraction']> }) {
  const t = useT()
  const facts = [extraction.kind, extraction.date, extraction.place, extraction.register].filter(Boolean)
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <h4 className="text-[11px] font-semibold text-zinc-400 mb-2">{t('scanread.details')}</h4>
      {facts.length > 0 && <p className="text-xs text-zinc-300 mb-2">{facts.join(' · ')}</p>}
      <div className="space-y-1">
        {(extraction.persons ?? []).map((p, i) => (
          <div key={i} className="text-xs text-zinc-400">
            <span className="text-zinc-600">{p.role ?? '—'}:</span>{' '}
            <span className="text-zinc-200">{[p.last_name, p.first_name].filter(Boolean).join(' ') || '—'}</span>
            {p.occupation && <span className="text-zinc-600"> · {p.occupation}</span>}
            {p.age != null && <span className="text-zinc-600"> · {p.age}</span>}
          </div>
        ))}
      </div>
      {extraction.remarks && <p className="mt-2 text-[11px] text-zinc-500">{extraction.remarks}</p>}
    </div>
  )
}

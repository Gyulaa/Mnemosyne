import { useState, useRef, useCallback, DragEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import FolderPicker from './FolderPicker'
import DuplicateReviewModal from './DuplicateReviewModal'
import { useT } from '../SettingsContext'

const LAST_PATH_KEY = 'organizer_scan_path'
const SKIP_DUPES_KEY = 'organizer_skip_duplicates'

export default function ScanTab() {
  const t = useT()
  const [path, setPath] = useState(() => localStorage.getItem(LAST_PATH_KEY) ?? '')
  const [skipDuplicates, setSkipDuplicates] = useState(() => localStorage.getItem(SKIP_DUPES_KEY) === 'true')
  const [eps, setEps] = useState(0.5)
  const [minSamples, setMinSamples] = useState(3)
  const [minDetScore, setMinDetScore] = useState(0.65)
  const [clusterResult, setClusterResult] = useState<{
    clusters: number; noise: number
  } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ count: number; message: string } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [showDupeReview, setShowDupeReview] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const qc = useQueryClient()

  const { data: status } = useQuery({
    queryKey: ['scan-status'],
    queryFn: api.scan.status,
    refetchInterval: 1_000,
  })

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: api.stats,
    refetchInterval: status?.running ? 3_000 : 10_000,
  })

  const startMut = useMutation({
    mutationFn: () => {
      localStorage.setItem(LAST_PATH_KEY, path)
      return api.scan.start(path, skipDuplicates)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scan-status'] }),
  })

  function toggleSkipDuplicates(val: boolean) {
    setSkipDuplicates(val)
    localStorage.setItem(SKIP_DUPES_KEY, String(val))
  }

  const stopMut = useMutation({
    mutationFn: api.scan.stop,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scan-status'] }),
  })

  const clusterMut = useMutation({
    mutationFn: () => api.cluster.run(eps, minSamples, minDetScore),
    onSuccess: data => {
      setClusterResult(data)
      qc.invalidateQueries({ queryKey: ['clusters'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })

  const handleImport = useCallback(async (files: File[]) => {
    const imageFiles = files.filter(f => /\.(jpe?g|png|bmp|tiff?|webp|heic|heif)$/i.test(f.name))
    if (!imageFiles.length) {
      setImportError(t('scan.noImages'))
      return
    }
    setImporting(true)
    setImportResult(null)
    setImportError(null)
    try {
      const result = await api.scan.importFiles(imageFiles)
      setImportResult({ count: result.count, message: t('scan.imported', { n: result.count, unit: t(result.count === 1 ? 'scan.importedUnit.one' : 'scan.importedUnit.many') }) })
      qc.invalidateQueries({ queryKey: ['scan-status'] })
    } catch (e) {
      setImportError(String((e as Error).message))
    } finally {
      setImporting(false)
    }
  }, [qc])

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) handleImport(files)
  }, [handleImport])

  const isRunning = status?.running ?? false
  const progress =
    status && status.total > 0
      ? Math.round((status.processed / status.total) * 100)
      : 0
  const hasFaces = (stats?.total_faces ?? 0) > 0

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Folder picker */}
      <section className="space-y-3">
        <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest">
          {t('scan.sourceFolder')}
        </label>
        <FolderPicker value={path} onChange={setPath} />

        <div className="flex items-center gap-3 pt-1">
          {isRunning ? (
            <button
              onClick={() => stopMut.mutate()}
              className="px-5 py-2.5 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium transition-colors"
            >
              {t('scan.stopScan')}
            </button>
          ) : (
            <button
              onClick={() => startMut.mutate()}
              disabled={!path.trim() || startMut.isPending}
              className="px-5 py-2.5 bg-brand-500 hover:bg-brand-400 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              {startMut.isPending ? t('scan.starting') : t('scan.startScan')}
            </button>
          )}
          {startMut.isError && (
            <span className="text-sm text-red-400">
              {String((startMut.error as Error).message)}
            </span>
          )}
        </div>

        {/* Duplicate skip option */}
        <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
          <button
            role="switch"
            aria-checked={skipDuplicates}
            onClick={() => toggleSkipDuplicates(!skipDuplicates)}
            disabled={isRunning}
            className={`inline-flex items-center rounded-full transition-colors shrink-0 disabled:opacity-40 ${skipDuplicates ? 'bg-brand-500' : 'bg-zinc-700'}`}
            style={{ width: '30px', height: '17px' }}
          >
            <span
              className="inline-block w-3 h-3 rounded-full bg-white shadow transition-transform"
              style={{ transform: skipDuplicates ? 'translateX(15px)' : 'translateX(2px)' }}
            />
          </button>
          <span className="text-xs text-zinc-400">
            {skipDuplicates ? t('scan.skipDupes.on') : t('scan.skipDupes.off')}
          </span>
        </label>
      </section>

      {/* Individual file import */}
      <section className="space-y-2">
        <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest">
          {t('scan.importFiles')}
        </label>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-xl px-6 py-8 text-center cursor-pointer transition-colors select-none
            ${dragOver
              ? 'border-brand-400 bg-brand-400/10 text-brand-300'
              : 'border-zinc-700 hover:border-zinc-500 text-zinc-500 hover:text-zinc-400'
            }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.bmp,.tiff,.tif,.webp,.heic,.heif"
            className="sr-only"
            onChange={e => {
              const files = Array.from(e.target.files ?? [])
              if (files.length) handleImport(files)
              e.target.value = ''
            }}
          />
          <svg className="w-8 h-8 mx-auto mb-2 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          {importing ? (
            <p className="text-sm text-brand-400">{t('scan.uploading')}</p>
          ) : (
            <>
              <p className="text-sm font-medium">{t('scan.dropImages')}</p>
              <p className="text-xs mt-1 opacity-70">{t('scan.browseFiles')}</p>
              <p className="text-xs mt-1 opacity-50">{t('scan.supportedFormats')}</p>
            </>
          )}
        </div>
        {importResult && !importing && (
          <p className="text-sm text-emerald-400">✓ {importResult.message}</p>
        )}
        {importError && (
          <p className="text-sm text-red-400">{importError}</p>
        )}
      </section>

      {/* Progress bar */}
      {status && status.total > 0 && (
        <section className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className={isRunning ? 'text-brand-400' : 'text-zinc-400'}>
              {isRunning ? t('scan.scanning') : t('scan.complete')}
            </span>
            <span className="text-zinc-400 tabular-nums flex items-center gap-3">
              {status.dupes_skipped > 0 && (
                <span className="text-amber-400/80 text-xs">
                  {t('scan.dupesSkipped', { n: status.dupes_skipped })}
                </span>
              )}
              {status.processed.toLocaleString()} / {status.total.toLocaleString()}
              {status.errors > 0 && (
                <span className="text-red-400 ml-2">{t('scan.errors', { n: status.errors })}</span>
              )}
            </span>
          </div>
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #7e22ce, #c084fc)' }}
            />
          </div>
        </section>
      )}

      {/* Stats */}
      {stats && (
        <section className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label={t('scan.totalImages')} value={stats.total_images} />
            <StatCard
              label={t('scan.scanned')}
              value={stats.scanned}
              sub={stats.no_face > 0 ? t('scan.noFace', { n: stats.no_face }) : undefined}
            />
            <StatCard label={t('scan.facesFound')} value={stats.total_faces} />
            <StatCard label={t('scan.pending')} value={stats.pending} />
          </div>
          {(stats.duplicates ?? 0) > 0 && (
            <div
              className="flex items-center gap-4 px-4 py-3 rounded-xl"
              style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.18)' }}
            >
              <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span className="text-xs text-amber-300 flex-1">
                <span className="font-semibold">{stats.duplicates}</span>{' '}
                {t('scan.dupeBanner', { n: stats.duplicates })}
                {!skipDuplicates && t('scan.dupeBannerStored')}
              </span>
              {!skipDuplicates && (
                <button
                  onClick={() => setShowDupeReview(true)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-amber-300 transition-colors shrink-0"
                  style={{ background: 'rgba(251,191,36,0.12)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(251,191,36,0.22)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(251,191,36,0.12)' }}
                >
                  {t('scan.dupeReview')}
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {showDupeReview && <DuplicateReviewModal onClose={() => setShowDupeReview(false)} />}

      {/* Clustering */}
      {hasFaces && (
        <section className="space-y-3 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest">
            {t('scan.clustering')}
          </label>
          <div className="flex flex-wrap items-end gap-4">
            <NumberInput
              label={t('scan.eps')}
              value={eps}
              onChange={setEps}
              step={0.05}
              min={0.1}
              max={1}
            />
            <NumberInput
              label={t('scan.minSamples')}
              value={minSamples}
              onChange={setMinSamples}
              step={1}
              min={1}
              max={20}
            />
            <NumberInput
              label={t('scan.minConf')}
              value={minDetScore}
              onChange={setMinDetScore}
              step={0.05}
              min={0}
              max={1}
            />
            <button
              onClick={() => clusterMut.mutate()}
              disabled={clusterMut.isPending}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
            >
              {clusterMut.isPending ? t('scan.clusteringBusy') : t('scan.runClustering')}
            </button>
            {clusterMut.isError && (
              <span className="text-sm text-red-400 self-center">
                {String((clusterMut.error as Error).message)}
              </span>
            )}
            {clusterResult && !clusterMut.isPending && (
              <span className="text-sm text-zinc-400 self-center">
                {t('scan.clusterResult', { clusters: clusterResult.clusters, noise: clusterResult.noise })}
              </span>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function StatCard({
  label, value, sub, accent,
}: {
  label: string; value: number; sub?: string; accent?: boolean
}) {
  return (
    <div
      className={`relative border rounded-xl p-4 overflow-hidden ${accent ? 'ring-1 ring-brand-500/25' : ''}`}
      style={{
        borderColor: accent ? 'rgba(147,51,234,0.3)' : 'rgba(255,255,255,0.07)',
        background: accent ? 'linear-gradient(160deg, #1e1628 0%, #18151e 100%)' : 'linear-gradient(160deg, #171620 0%, #131219 100%)',
      }}
    >
      {accent && <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-brand-600 via-brand-400 to-brand-600" />}
      <div className={`text-3xl font-bold tabular-nums ${accent ? 'text-brand-400' : 'text-zinc-100'}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-xs text-zinc-500 mt-1">{label}</div>
      {sub && <div className="text-xs text-zinc-700 mt-0.5">{sub}</div>}
    </div>
  )
}

function NumberInput({
  label, value, onChange, step, min, max,
}: {
  label: string; value: number; onChange: (v: number) => void
  step: number; min: number; max: number
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-zinc-500">{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-24 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-center tabular-nums focus:outline-none focus:border-brand-400 transition-colors"
      />
    </label>
  )
}

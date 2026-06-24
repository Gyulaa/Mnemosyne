import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import FolderPicker from './FolderPicker'

const LAST_PATH_KEY = 'organizer_scan_path'

export default function ScanTab() {
  const [path, setPath] = useState(() => localStorage.getItem(LAST_PATH_KEY) ?? '')
  const [eps, setEps] = useState(0.5)
  const [minSamples, setMinSamples] = useState(2)
  const [minDetScore, setMinDetScore] = useState(0.65)
  const [clusterResult, setClusterResult] = useState<{
    clusters: number; noise: number
  } | null>(null)

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
      return api.scan.start(path)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scan-status'] }),
  })

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
          Source folder
        </label>
        <FolderPicker value={path} onChange={setPath} />

        <div className="flex items-center gap-3 pt-1">
          {isRunning ? (
            <button
              onClick={() => stopMut.mutate()}
              className="px-5 py-2.5 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium transition-colors"
            >
              Stop scan
            </button>
          ) : (
            <button
              onClick={() => startMut.mutate()}
              disabled={!path.trim() || startMut.isPending}
              className="px-5 py-2.5 bg-brand-500 hover:bg-brand-400 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              {startMut.isPending ? 'Starting…' : 'Start scan'}
            </button>
          )}
          {startMut.isError && (
            <span className="text-sm text-red-400">
              {String((startMut.error as Error).message)}
            </span>
          )}
        </div>
      </section>

      {/* Progress bar */}
      {status && status.total > 0 && (
        <section className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className={isRunning ? 'text-brand-400' : 'text-zinc-400'}>
              {isRunning ? 'Scanning…' : 'Scan complete'}
            </span>
            <span className="text-zinc-400 tabular-nums">
              {status.processed.toLocaleString()} / {status.total.toLocaleString()}
              {status.errors > 0 && (
                <span className="text-red-400 ml-2">· {status.errors} errors</span>
              )}
            </span>
          </div>
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-400 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </section>
      )}

      {/* Stats */}
      {stats && (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total images" value={stats.total_images} />
          <StatCard
            label="Scanned"
            value={stats.scanned}
            sub={stats.no_face > 0 ? `${stats.no_face} no face` : undefined}
          />
          <StatCard label="Faces found" value={stats.total_faces} accent />
          <StatCard label="Pending" value={stats.pending} />
        </section>
      )}

      {/* Clustering */}
      {hasFaces && (
        <section className="space-y-3 pt-2 border-t border-zinc-800">
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest">
            Clustering
          </label>
          <div className="flex flex-wrap items-end gap-4">
            <NumberInput
              label="eps"
              value={eps}
              onChange={setEps}
              step={0.05}
              min={0.1}
              max={1}
            />
            <NumberInput
              label="min samples"
              value={minSamples}
              onChange={setMinSamples}
              step={1}
              min={1}
              max={20}
            />
            <NumberInput
              label="min conf"
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
              {clusterMut.isPending ? 'Clustering…' : 'Run clustering'}
            </button>
            {clusterMut.isError && (
              <span className="text-sm text-red-400 self-center">
                {String((clusterMut.error as Error).message)}
              </span>
            )}
            {clusterResult && !clusterMut.isPending && (
              <span className="text-sm text-zinc-400 self-center">
                ✓ {clusterResult.clusters} clusters · {clusterResult.noise} noise
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
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className={`text-2xl font-bold tabular-nums ${accent ? 'text-brand-400' : 'text-zinc-100'}`}>
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

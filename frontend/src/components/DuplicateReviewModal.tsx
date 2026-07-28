import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { DuplicateGroup, DuplicateImageInfo } from '../types'
import { useT } from '../SettingsContext'

function basename(path: string) {
  return path.replace(/\\/g, '/').split('/').pop() ?? path
}

function formatDims(w: number | null, h: number | null) {
  if (!w || !h) return null
  return `${w}×${h}`
}

type TFn = ReturnType<typeof useT>

function SimilarityBadge({ group, t }: { group: DuplicateGroup; t: TFn }) {
  const allExact = group.duplicates.every(d => d.similarity === 'exact')
  const minHamming = group.duplicates
    .map(d => d.hamming_distance ?? 0)
    .reduce((a, b) => Math.min(a, b), 64)

  if (allExact) {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-semibold text-emerald-300"
        style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)' }}>
        {t('scan.dupeReview.exact')}
      </span>
    )
  }
  const label = minHamming <= 2
    ? t('scan.dupeReview.nearHigh')
    : minHamming <= 4
      ? t('scan.dupeReview.nearMed')
      : t('scan.dupeReview.nearLow')
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold text-amber-300"
      style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.25)' }}>
      {label} ({minHamming} bit)
    </span>
  )
}

function ImageCard({
  img,
  role,
  onKeep,
  onDelete,
  resolving,
  t,
}: {
  img: DuplicateImageInfo
  role: 'original' | 'duplicate'
  onKeep?: () => void
  onDelete?: () => void
  resolving: boolean
  t: TFn
}) {
  const thumbUrl = `/api/images/${img.id}/view?max_size=320`

  return (
    <div className="flex flex-col rounded-xl overflow-hidden" style={{ background: '#13121a', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="relative aspect-video bg-black overflow-hidden">
        <img src={thumbUrl} alt="" className="w-full h-full object-contain" />
        <div className="absolute top-2 left-2">
          <span className="px-2 py-0.5 rounded-md text-xs font-semibold"
            style={{ background: 'rgba(0,0,0,0.7)', color: role === 'original' ? '#f4f4f5' : '#a1a1aa' }}>
            {role === 'original' ? t('scan.dupeReview.original') : t('scan.dupeReview.duplicate')}
          </span>
        </div>
      </div>

      <div className="px-3 py-2.5 space-y-1 flex-1">
        <p className="text-xs font-medium text-zinc-200 truncate" title={img.path}>
          {basename(img.path)}
        </p>
        <p className="text-xs text-zinc-600 truncate" title={img.path}>
          {img.path}
        </p>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          {img.exif_date && <span>{img.exif_date.slice(0, 10)}</span>}
          {formatDims(img.width, img.height) && (
            <>
              {img.exif_date && <span className="text-zinc-700">·</span>}
              <span>{formatDims(img.width, img.height)}</span>
            </>
          )}
        </div>
      </div>

      {role === 'duplicate' && (
        <div className="px-3 pb-3 flex gap-2">
          <button
            onClick={onKeep}
            disabled={resolving}
            className="flex-1 py-1.5 rounded-lg text-xs font-medium text-zinc-200 transition-colors disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.08)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.13)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)' }}
          >
            {t('scan.dupeReview.keep')}
          </button>
          <button
            onClick={onDelete}
            disabled={resolving}
            className="flex-1 py-1.5 rounded-lg text-xs font-medium text-red-400 transition-colors disabled:opacity-40"
            style={{ background: 'rgba(239,68,68,0.08)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.15)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.08)' }}
          >
            {t('scan.dupeReview.delete')}
          </button>
        </div>
      )}
    </div>
  )
}

export default function DuplicateReviewModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const qc = useQueryClient()
  const [groupIdx, setGroupIdx] = useState(0)
  const [resolving, setResolving] = useState(false)
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['duplicate-groups'],
    queryFn: api.scan.duplicateGroups,
  })

  const visibleGroups = groups.filter(g => !dismissed.has(g.original.id))
  const group = visibleGroups[groupIdx]
  const total = visibleGroups.length

  async function resolveOne(imageId: number, action: 'keep' | 'delete') {
    setResolving(true)
    try {
      await api.scan.resolveDuplicate(imageId, action)
      qc.invalidateQueries({ queryKey: ['duplicate-groups'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    } finally {
      setResolving(false)
    }
  }

  function dismissGroup() {
    if (!group) return
    // Mark all duplicates in this group as dismissed (keep as-is)
    const promises = group.duplicates.map(d => api.scan.resolveDuplicate(d.id, 'dismiss'))
    Promise.all(promises).then(() => {
      setDismissed(prev => new Set([...prev, group.original.id]))
      if (groupIdx >= visibleGroups.length - 1) setGroupIdx(Math.max(0, groupIdx - 1))
      qc.invalidateQueries({ queryKey: ['duplicate-groups'] })
    })
  }

  async function keepAllSeparate() {
    if (!group) return
    setResolving(true)
    try {
      await Promise.all(group.duplicates.map(d => api.scan.resolveDuplicate(d.id, 'keep')))
      qc.invalidateQueries({ queryKey: ['duplicate-groups'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      setDismissed(prev => new Set([...prev, group.original.id]))
      if (groupIdx >= visibleGroups.length - 1) setGroupIdx(Math.max(0, groupIdx - 1))
    } finally {
      setResolving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-3xl flex flex-col rounded-2xl shadow-2xl"
        style={{ background: '#111117', border: '1px solid rgba(255,255,255,0.09)', maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">{t('scan.dupeReview.title')}</h2>
            {!isLoading && (
              <p className="text-xs text-zinc-500 mt-0.5">
                {t('scan.dupeReview.subtitle', { n: total, current: groupIdx + 1, total })}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-200 transition-colors"
            style={{ background: 'rgba(255,255,255,0.05)' }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-48 text-zinc-500 text-sm">{t('scan.dupeReview.loading')}</div>
          ) : total === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-zinc-500">
              <svg className="w-12 h-12 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm">{t('scan.dupeReview.empty')}</p>
            </div>
          ) : group ? (
            <div className="space-y-5">
              {/* Similarity badge */}
              <div className="flex items-center gap-3">
                <SimilarityBadge group={group} t={t} />
                <span className="text-xs text-zinc-600">
                  {t('scan.dupeReview.count', { n: group.duplicates.length })}
                </span>
              </div>

              {/* Image grid */}
              <div className={`grid gap-4 ${group.duplicates.length === 1 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                <ImageCard img={group.original} role="original" resolving={resolving} t={t} />
                {group.duplicates.map(dup => (
                  <ImageCard
                    key={dup.id}
                    img={dup}
                    role="duplicate"
                    resolving={resolving}
                    t={t}
                    onKeep={() => resolveOne(dup.id, 'keep')}
                    onDelete={() => resolveOne(dup.id, 'delete')}
                  />
                ))}
              </div>

              {/* Group actions */}
              <div className="flex items-center gap-3 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <button
                  onClick={keepAllSeparate}
                  disabled={resolving}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-300 transition-colors disabled:opacity-40"
                  style={{ background: 'rgba(255,255,255,0.07)' }}
                >
                  {t('scan.dupeReview.keepAll')}
                </button>
                <button
                  onClick={dismissGroup}
                  disabled={resolving}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
                >
                  {t('scan.dupeReview.dismiss')}
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => setGroupIdx(i => Math.max(0, i - 1))}
                    disabled={groupIdx === 0 || resolving}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-200 disabled:opacity-30 transition-colors"
                    style={{ background: 'rgba(255,255,255,0.06)' }}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setGroupIdx(i => Math.min(total - 1, i + 1))}
                    disabled={groupIdx >= total - 1 || resolving}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-200 disabled:opacity-30 transition-colors"
                    style={{ background: 'rgba(255,255,255,0.06)' }}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ImageItem, ImagePerson, PersonEvent } from '../types'
import { api } from '../api'
import { useT, useDateLocale } from '../SettingsContext'
import { useBackdropClose } from '../modalBackdrop'
import { plainMentions } from '../markdown'

const STATUS_CLS: Record<string, string> = {
  done:    'bg-green-900/50 text-green-400 border-green-800',
  no_face: 'bg-zinc-800 text-zinc-500 border-zinc-700',
  error:   'bg-red-900/50 text-red-400 border-red-800',
  pending: 'bg-amber-900/40 text-amber-400 border-amber-800',
}
const STATUS_KEY: Record<string, string> = {
  done:    'images.statusDone',
  no_face: 'images.statusNoFace',
  error:   'images.statusError',
  pending: 'images.statusPending',
}

function parseMeta(metaJson: string | null | undefined): { width?: number; height?: number; make?: string; model?: string } {
  if (!metaJson) return {}
  try { return JSON.parse(metaJson) } catch { return {} }
}

export function ImagePreviewModal({
  imageIds,
  startIdx,
  onClose,
  onNavToCluster,
  onNavToEvent,
  onTogglePrivacy,
}: {
  imageIds: number[]
  startIdx: number
  onClose: () => void
  onNavToCluster?: (clusterId: number) => void
  onNavToEvent?: (eventId: number) => void
  onTogglePrivacy?: (id: number, isPrivate: boolean) => void
}) {
  const [idx, setIdx] = useState(startIdx)
  const imageId = imageIds[idx]
  const t = useT()
  const dateLocale = useDateLocale()
  const backdrop = useBackdropClose(onClose)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowLeft')  setIdx(i => Math.max(0, i - 1))
      if (e.key === 'ArrowRight') setIdx(i => Math.min(imageIds.length - 1, i + 1))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [imageIds.length, onClose])

  const { data: img } = useQuery<ImageItem>({
    queryKey: ['image-detail', imageId],
    queryFn: () => api.images.get(imageId),
    enabled: !!imageId,
    staleTime: 60_000,
  })

  const { data: persons = [] } = useQuery<ImagePerson[]>({
    queryKey: ['image-persons', imageId],
    queryFn: () => api.images.persons(imageId),
    staleTime: 120_000,
    enabled: !!imageId,
  })

  const { data: linkedEvents = [] } = useQuery<PersonEvent[]>({
    queryKey: ['image-events', imageId],
    queryFn: () => api.events.listForImage(imageId),
    staleTime: 30_000,
    enabled: !!imageId,
  })

  if (!imageId) return null

  const exifMeta = parseMeta(img?.meta_json)
  const statusCls = img ? (STATUS_CLS[img.scan_status] ?? 'bg-zinc-800 text-zinc-400 border-zinc-700') : ''

  return (
    <div
      className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
      {...backdrop}
    >
      {/* Nav arrows */}
      <button
        onClick={e => { e.stopPropagation(); setIdx(i => Math.max(0, i - 1)) }}
        disabled={idx === 0}
        className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-zinc-800/80 hover:bg-zinc-700 disabled:opacity-20 flex items-center justify-center text-zinc-200 text-2xl transition-colors z-10"
      >‹</button>
      <button
        onClick={e => { e.stopPropagation(); setIdx(i => Math.min(imageIds.length - 1, i + 1)) }}
        disabled={idx === imageIds.length - 1}
        className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-zinc-800/80 hover:bg-zinc-700 disabled:opacity-20 flex items-center justify-center text-zinc-200 text-2xl transition-colors z-10"
      >›</button>

      <div
        className="rounded-2xl overflow-hidden shadow-2xl flex flex-col mx-16"
        style={{ background: '#111117', border: '1px solid rgba(255,255,255,0.08)', maxHeight: '92vh', width: 'min(860px, calc(100vw - 120px))' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Image */}
        <div className="bg-zinc-950 flex items-center justify-center overflow-hidden relative" style={{ maxHeight: '68vh', minHeight: 200 }}>
          <img
            key={imageId}
            src={api.imageViewUrl(imageId, 1400)}
            alt={img?.filename ?? ''}
            className="max-w-full max-h-full object-contain"
            style={{ maxHeight: '68vh' }}
          />
          <div className="absolute bottom-2 right-2 bg-black/60 rounded-lg px-2 py-0.5 text-xs text-zinc-400 tabular-nums">
            {idx + 1} / {imageIds.length}
          </div>
        </div>

        {/* Metadata */}
        <div className="px-5 py-4 flex items-start justify-between gap-4 overflow-y-auto">
          <div className="min-w-0 flex-1 space-y-2">
            {img && (
              <>
                <div>
                  <p className="font-semibold text-zinc-100 truncate" title={img.filename}>{img.filename}</p>
                  <p className="text-xs text-zinc-500 truncate mt-0.5" title={img.path}>{img.path}</p>
                  {img.error_msg && <p className="text-xs text-red-400 mt-1">{img.error_msg}</p>}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                  {img.exif_date && (
                    <span className="flex items-center gap-1 text-zinc-300 font-medium">
                      <svg className="w-3 h-3 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {new Date(img.exif_date).toLocaleString(dateLocale)}
                    </span>
                  )}
                  {(exifMeta.make || exifMeta.model) && (
                    <span>{[exifMeta.make, exifMeta.model].filter(Boolean).join(' ')}</span>
                  )}
                  {exifMeta.width && exifMeta.height && (
                    <span>{exifMeta.width} × {exifMeta.height}</span>
                  )}
                </div>
              </>
            )}

            {/* Linked events */}
            {linkedEvents.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-zinc-600">{t('images.events')}</span>
                {linkedEvents.map(ev => (
                  <button key={ev.id}
                    onClick={() => { onNavToEvent?.(ev.id); onClose() }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-brand-900/40 border border-brand-700/50 rounded-full text-xs text-brand-300 hover:bg-brand-800/50 hover:border-brand-600/60 transition-colors">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    {plainMentions(ev.title ?? '') || ev.event_type}
                    {ev.year ? ` (${ev.year})` : ''}
                  </button>
                ))}
              </div>
            )}

            {/* Persons in image */}
            {persons.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-zinc-600">{t('images.persons')}</span>
                {persons.map(p => {
                  const canNav = onNavToCluster && p.cluster_id != null
                  return canNav ? (
                    <button key={p.person_id}
                      onClick={() => { onNavToCluster!(p.cluster_id!); onClose() }}
                      className="inline-flex items-center gap-1 pl-0.5 pr-2 py-0.5 bg-zinc-800 border border-zinc-700 hover:border-zinc-500 hover:bg-zinc-700 rounded-full text-xs text-zinc-300 transition-colors">
                      <img src={api.faceThumbnailUrl(p.face_id, 32)} alt=""
                        className="w-4 h-4 rounded-full object-cover shrink-0" />
                      {p.person_name ?? t('images.unnamed')}
                    </button>
                  ) : (
                    <span key={p.person_id}
                      className="inline-flex items-center gap-1 pl-0.5 pr-2 py-0.5 bg-zinc-800 border border-zinc-700 rounded-full text-xs text-zinc-300">
                      <img src={api.faceThumbnailUrl(p.face_id, 32)} alt=""
                        className="w-4 h-4 rounded-full object-cover shrink-0" />
                      {p.person_name ?? t('images.unnamed')}
                    </span>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 shrink-0">
            {img && STATUS_KEY[img.scan_status] && (
              <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border ${statusCls}`}>
                {t(STATUS_KEY[img.scan_status])}
              </span>
            )}
            {img && onTogglePrivacy && (
              <button
                onClick={() => onTogglePrivacy(img.id, !img.is_private)}
                title={img.is_private ? t('images.privacyOn') : t('images.privacyOff')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                  img.is_private
                    ? 'text-amber-300 bg-amber-900/40 hover:bg-amber-900/60'
                    : 'text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700'
                }`}
              >
                {img.is_private ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="11" width="18" height="11" rx="2" /><path strokeLinecap="round" d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="11" width="18" height="11" rx="2" /><path strokeLinecap="round" d="M7 11V7a5 5 0 019.9-1" />
                  </svg>
                )}
                {img.is_private ? t('images.private') : t('images.makePrivate')}
              </button>
            )}
            <button onClick={onClose}
              className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

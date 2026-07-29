import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { useSettings, useT } from '../SettingsContext'
import type { UpdateStatus } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMB(bytes: number) {
  return (bytes / 1_048_576).toFixed(1) + ' MB'
}

// ── Header icon button ────────────────────────────────────────────────────────

function UpdateIcon({ status, onClick }: { status: UpdateStatus['status'] | 'unknown'; onClick: () => void }) {
  const t = useT()
  const dotColor =
    status === 'error'            ? 'bg-red-400' :
    status === 'ready'            ? 'bg-green-400' :
    status === 'downloading'      ? 'bg-blue-400' :
    status === 'update_available' ? 'bg-amber-400' :
    status === 'dev_build'        ? 'bg-zinc-500' :
    status === 'applying'         ? 'bg-zinc-400' :
    null

  return (
    <button
      onClick={onClick}
      title={t('update.title')}
      className="w-8 h-8 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors relative"
    >
      {/* Cloud-download icon */}
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
      </svg>

      {/* Pulse dot while checking */}
      {status === 'checking' && (
        <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse" />
      )}

      {/* Solid colored dot for actionable states */}
      {dotColor && (
        <span className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${dotColor}`} />
      )}
    </button>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function Modal({
  status,
  onClose,
  onCheck,
  onDownload,
  onApply,
}: {
  status: UpdateStatus
  onClose: () => void
  onCheck: () => void
  onDownload: () => void
  onApply: () => void
}) {
  const t = useT()
  const pct = status.total > 0 ? Math.round((status.downloaded / status.total) * 100) : 0

  return createPortal(
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4">
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold mb-1">{t('update.header')}</p>
            <h2 className="text-base font-semibold text-zinc-100">
              {status.status === 'idle'             && t('update.idle')}
              {status.status === 'up_to_date'       && t('update.upToDate')}
              {status.status === 'dev_build'        && t('update.devBuild')}
              {status.status === 'checking'         && t('update.checking')}
              {status.status === 'update_available' && t('update.available')}
              {status.status === 'downloading'      && t('update.downloading')}
              {status.status === 'ready'            && t('update.ready')}
              {status.status === 'applying'         && t('update.applying')}
              {status.status === 'error'            && t('update.error')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors shrink-0 ml-4 mt-0.5"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pb-6 space-y-4">

          {/* Version row */}
          {status.current_version && (
            <div className="flex items-center gap-3 text-sm">
              <div className="text-center">
                <p className="text-xs text-zinc-500 mb-0.5">{t('update.currentVersion')}</p>
                <p className="font-mono text-xs text-zinc-300 bg-zinc-800 px-2 py-1 rounded-md">
                  {status.current_version}
                </p>
              </div>
              {status.latest_version && status.latest_version !== status.current_version && (
                <>
                  <svg className="w-4 h-4 text-zinc-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  <div className="text-center">
                    <p className="text-xs text-zinc-500 mb-0.5">{t('update.latestVersion')}</p>
                    <p className="font-mono text-xs text-green-300 bg-green-950/50 border border-green-800/40 px-2 py-1 rounded-md">
                      {status.latest_version}
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Idle */}
          {status.status === 'idle' && (
            <p className="text-sm text-zinc-400">{t('update.idleBody')}</p>
          )}

          {/* Checking spinner */}
          {status.status === 'checking' && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <svg className="w-4 h-4 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              {t('update.checkingBody')}
            </div>
          )}

          {/* Up to date */}
          {status.status === 'up_to_date' && (
            <p className="text-sm text-zinc-400">{t('update.upToDateBody')}</p>
          )}

          {/* Unstamped build — version unknown, cannot self-update */}
          {status.status === 'dev_build' && (
            <div className="p-3 bg-amber-950/30 border border-amber-800/40 rounded-xl">
              <p className="text-xs text-amber-300 leading-relaxed">{t('update.devBuildBody')}</p>
            </div>
          )}

          {/* Update available */}
          {status.status === 'update_available' && (
            <div className="space-y-3">
              <p className="text-sm text-zinc-300">{t('update.availableBody')}</p>
              <div className="flex items-start gap-2 p-3 bg-zinc-800/60 rounded-xl border border-zinc-700/50">
                <svg className="w-4 h-4 text-green-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <p className="text-xs text-zinc-400 leading-relaxed">{t('update.safeNote')}</p>
              </div>
            </div>
          )}

          {/* Download progress */}
          {status.status === 'downloading' && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-zinc-400">
                <span>{fmtMB(status.downloaded)} / {status.total > 0 ? fmtMB(status.total) : '…'}</span>
                <span>{pct}%</span>
              </div>
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-zinc-500">{t('update.downloadingWarning')}</p>
            </div>
          )}

          {/* Ready to apply */}
          {status.status === 'ready' && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-green-950/30 rounded-xl border border-green-800/40">
                <svg className="w-4 h-4 text-green-400 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <p className="text-xs text-green-300 leading-relaxed">{t('update.readyBody')}</p>
              </div>
              <p className="text-xs text-zinc-500">{t('update.readyNote')}</p>
            </div>
          )}

          {/* Applying */}
          {status.status === 'applying' && (
            <div className="flex items-center gap-3 text-sm text-zinc-300">
              <svg className="w-5 h-5 animate-spin text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              <div>
                <p className="font-medium">{t('update.applying')}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{t('update.applyingBody')}</p>
              </div>
            </div>
          )}

          {/* Error */}
          {status.status === 'error' && (
            <div className="p-3 bg-red-950/40 border border-red-800/40 rounded-xl">
              <p className="text-xs text-red-300 leading-relaxed">{status.error}</p>
            </div>
          )}

        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 bg-zinc-950/50 border-t border-zinc-800">

          {(status.status === 'idle' || status.status === 'up_to_date' ||
            status.status === 'dev_build' || status.status === 'error') && (
            <>
              {status.status === 'dev_build' && status.release_url && (
                <a
                  href={status.release_url}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 mr-auto rounded-lg text-xs font-medium text-brand-300 hover:text-brand-200 hover:bg-zinc-800 transition-colors"
                >
                  {t('update.openRelease')}
                </a>
              )}
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              >
                {t('update.close')}
              </button>
              <button
                onClick={onCheck}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {t('update.check')}
              </button>
            </>
          )}

          {status.status === 'update_available' && (
            <>
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              >
                {t('update.notNow')}
              </button>
              <button
                onClick={onDownload}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-brand-500 hover:bg-brand-400 text-white transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {t('update.download')}
              </button>
            </>
          )}

          {status.status === 'ready' && (
            <>
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              >
                {t('update.later')}
              </button>
              <button
                onClick={onApply}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-green-600 hover:bg-green-500 text-white transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {t('update.applyRestart')}
              </button>
            </>
          )}

          {(status.status === 'checking' || status.status === 'downloading' || status.status === 'applying') && (
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              {t('update.close')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function UpdateBanner() {
  const { autoCheckUpdates } = useSettings()
  const [status, setStatus]       = useState<UpdateStatus | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const s = await api.update.getStatus()
      setStatus(s)
    } catch { /* backend not ready yet */ }
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Auto-check after 5 s (only if enabled in settings)
  useEffect(() => {
    if (!autoCheckUpdates) return
    const t = setTimeout(async () => {
      try {
        await api.update.check()
        fetchStatus()
      } catch { /* ignore */ }
    }, 5_000)
    return () => clearTimeout(t)
  }, [autoCheckUpdates, fetchStatus])

  // Fast poll while checking or downloading
  useEffect(() => {
    const active = status?.status === 'checking' || status?.status === 'downloading'
    if (!active) return
    const t = setInterval(fetchStatus, 800)
    return () => clearInterval(t)
  }, [status?.status, fetchStatus])

  async function handleCheck() {
    try {
      await api.update.check()
      fetchStatus()
    } catch (e) {
      console.error('Check error:', e)
    }
  }

  async function handleDownload() {
    try {
      await api.update.download()
      fetchStatus()
    } catch (e) {
      console.error('Download error:', e)
    }
  }

  async function handleApply() {
    try {
      await api.update.apply()
      fetchStatus()
    } catch (e) {
      console.error('Apply error:', e)
    }
  }

  return (
    <>
      <UpdateIcon
        status={status?.status ?? 'unknown'}
        onClick={() => setModalOpen(true)}
      />
      {modalOpen && status && (
        <Modal
          status={status}
          onClose={() => setModalOpen(false)}
          onCheck={handleCheck}
          onDownload={handleDownload}
          onApply={handleApply}
        />
      )}
    </>
  )
}

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useSettings, useT } from '../SettingsContext'
import type { DocumentAiSettings, PersonDocument } from '../types'

/**
 * Reading one scanned document with the vision model, into its description.
 *
 * The batch reader (`ScanReadModal`) exists for a folder of records being
 * triaged before any of it is imported. This is the other half: a scan already
 * in the project, whose text the user wants now.
 *
 * The reading is appended to the description rather than kept in a field of its
 * own. A second field would have to be edited, searched, exported and shown
 * separately, and would start disagreeing with the description the moment
 * either was touched — while the description already goes everywhere the text
 * needs to go: it is editable with mentions and citations, the assistant
 * receives it in full with every document it lists, and it survives an export.
 *
 * Appended, never substituted: what somebody wrote about a document is theirs.
 */
export default function DocumentReadButton({ doc, onRead }: {
  doc: PersonDocument
  /** The text this call read. The owner decides where to put it. */
  onRead: (text: string) => void
}) {
  const t = useT()
  const { lang } = useSettings()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [fileId, setFileId] = useState<number | null>(null)

  const { data: settings } = useQuery<DocumentAiSettings>({
    queryKey: ['doc-ai-settings'],
    queryFn: api.transcripts.getSettings,
    staleTime: 30_000,
  })

  const mime = doc.mime_type ?? ''
  const readable = mime.startsWith('image/') || mime === 'application/pdf'

  // Nothing here can read a file that is already text, or one that is neither a
  // picture nor a PDF — stay out of the way entirely rather than offer a
  // button that can only fail.
  if (doc.is_text || !readable) return null

  const quotaLeft = settings ? settings.monthly_pages - settings.usage_month : 0
  // Why the button is unavailable, in the order the user can act on: switch it
  // on, add a key, pick a model that can see, wait for next month.
  const blocked =
    !settings ? null
      : !settings.enabled ? t('docRead.offHint')
        : !settings.configured ? t('docRead.noKeyHint')
          : !settings.vision ? t('docRead.noVisionHint')
            : quotaLeft <= 0 ? t('docRead.quotaHint')
              : null

  async function run() {
    setBusy(true); setErr(null)
    try {
      const res = await api.documents.transcribe(doc.id, { fileId, lang })
      onRead(res.text)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {/* Which file to read — only worth asking when the document has more than
          one, which is what a multi-page scan is. */}
      {(doc.files?.length ?? 0) > 0 && (
        <select value={fileId ?? ''}
          onChange={e => setFileId(e.target.value ? Number(e.target.value) : null)}
          className="w-full mb-2 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300">
          <option value="">{doc.filename}</option>
          {doc.files.map(f => <option key={f.id} value={f.id}>{f.filename}</option>)}
        </select>
      )}

      <button onClick={run} disabled={busy || !!blocked} title={blocked ?? undefined}
        className="w-full py-2 rounded-lg text-xs font-medium text-white transition-opacity disabled:opacity-40"
        style={{ background: 'linear-gradient(135deg, #9333ea 0%, #7e22ce 100%)' }}>
        {busy ? t('docRead.reading') : t('docRead.read')}
      </button>
      <p className="text-[10px] text-zinc-600 mt-1.5 leading-relaxed">
        {blocked ?? t('docRead.hint', { n: quotaLeft })}
      </p>

      {err && <p className="text-xs text-red-400 mt-2 break-words">{err}</p>}
    </div>
  )
}

/**
 * Where a reading joins a description. One rule, shared by both callers and
 * matching the server's own append, so a draft that is edited locally and a
 * description written server-side cannot come out spaced differently.
 */
export function appendReading(existing: string | null | undefined, text: string): string {
  const base = (existing ?? '').replace(/\s+$/, '')
  return base ? `${base}\n\n${text}` : text
}

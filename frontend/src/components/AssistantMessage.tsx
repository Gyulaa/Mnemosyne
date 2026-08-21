import { useState } from 'react'
import { renderMarkdown } from '../markdown'
import { useT } from '../SettingsContext'
import type { ChatToolCall } from '../types'

/** Human label for a tool name — falls back to the raw name for tools added
 *  later than the translation file. */
function useToolLabel() {
  const t = useT()
  return (name: string) => {
    const key = `chat.tool.${name}`
    const label = t(key)
    return label === key ? name : label
  }
}

function ToolChip({ call, running }: { call: ChatToolCall; running?: boolean }) {
  const [open, setOpen] = useState(false)
  const t = useT()
  const label = useToolLabel()

  const args = Object.entries(call.input ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')

  return (
    <div
      className={[
        'rounded-lg border text-xs transition-colors',
        call.is_error
          ? 'border-red-800/60 bg-red-950/30'
          : running
            ? 'border-brand-500/40 bg-brand-500/[0.07]'
            : 'border-zinc-800 bg-zinc-900/50',
      ].join(' ')}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
      >
        {running ? (
          <svg className="w-3.5 h-3.5 animate-spin text-brand-400 shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        ) : call.is_error ? (
          <svg className="w-3.5 h-3.5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}

        <span className={running ? 'text-brand-200 font-medium' : 'text-zinc-300 font-medium'}>
          {label(call.name)}
        </span>
        {args && (
          <span className="text-zinc-600 font-mono text-[10px] truncate flex-1 min-w-0">{args}</span>
        )}
        {typeof call.duration_ms === 'number' && !running && (
          <span className="text-zinc-700 text-[10px] tabular-nums shrink-0">{call.duration_ms} ms</span>
        )}
        <svg
          className={`w-3 h-3 text-zinc-600 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {open && (
        <pre className="px-2.5 pb-2 pt-0 text-[10px] leading-relaxed text-zinc-500 font-mono overflow-x-auto max-h-52">
          {call.result === null || call.result === undefined
            ? t('chat.tool.running')
            : JSON.stringify(call.result, null, 1)}
        </pre>
      )}
    </div>
  )
}

interface Props {
  role: 'user' | 'assistant'
  content: string
  toolCalls: ChatToolCall[]
  /** Set on the message currently being streamed — shows the caret. */
  streaming?: boolean
  onNavToPerson: (id: number) => void
  onNavToImage: (imageId: number) => void
  onNavToImages: (personIds: number[]) => void
  onNavToDocument: (docId: number) => void
}

export default function AssistantMessage({
  role, content, toolCalls, streaming, onNavToPerson, onNavToImage, onNavToImages, onNavToDocument,
}: Props) {
  const t = useT()

  // References render as anchors with a known class; delegate clicks to
  // navigation the same way NoteEditor and DocumentViewer already do. Shared
  // by both roles, so a person or document the user themselves referenced
  // when composing stays clickable in the transcript too.
  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const anchor = (e.target as Element).closest(
      'a.note-person-ref, a.note-image-ref, a.note-people-ref, a.note-document-ref',
    ) as HTMLAnchorElement | null
    if (!anchor) return
    const href = anchor.getAttribute('href') ?? ''
    e.preventDefault()

    let m = href.match(/person-ref-(\d+)$/)
    if (m) return onNavToPerson(parseInt(m[1]))

    m = href.match(/image-ref-(\d+)$/)
    if (m) return onNavToImage(parseInt(m[1]))

    m = href.match(/document-ref-(\d+)$/)
    if (m) return onNavToDocument(parseInt(m[1]))

    m = href.match(/people-ref-([\d,]+)$/)
    if (m) {
      const ids = m[1].split(',').map(Number).filter(Number.isFinite)
      if (ids.length) onNavToImages(ids)
    }
  }

  if (role === 'user') {
    return (
      <div className="flex justify-end ai-fade-up">
        <div
          onClick={handleClick}
          className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-800/60 border border-zinc-700/50 px-3.5 py-2 text-sm text-zinc-100 note-content ai-prose break-words"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content, []) }}
        />
      </div>
    )
  }

  return (
    <div className="ai-fade-up space-y-1.5">
      {toolCalls.length > 0 && (
        <div className="space-y-1">
          {toolCalls.map(c => (
            <ToolChip key={String(c.id)} call={c} running={c.result === null || c.result === undefined} />
          ))}
        </div>
      )}

      {content ? (
        <div
          onClick={handleClick}
          className="note-content ai-prose text-sm text-zinc-300 leading-relaxed break-words"
          dangerouslySetInnerHTML={{
            __html: renderMarkdown(content, []) + (streaming ? '<span class="ai-caret">▍</span>' : ''),
          }}
        />
      ) : streaming ? (
        <p className="text-sm text-zinc-600">
          <span className="ai-caret">▍</span> {t('chat.thinking')}
        </p>
      ) : null}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useSettings, useT } from '../SettingsContext'
import AssistantMessage from './AssistantMessage'
import AssistantSetup from './AssistantSetup'
import type { AiSettings, ChatMessage, ChatThread, ChatToolCall } from '../types'

/** A message being streamed — not yet persisted, so it has no server id. */
interface LiveMessage {
  content: string
  toolCalls: ChatToolCall[]
}

/** How the assistant shapes its prose — sent with every turn, see primer.py. */
type ChatStyle = 'structured' | 'narrative'
const CHAT_STYLES: ChatStyle[] = ['structured', 'narrative']

// Two photo-library prompts and two genealogy ones — the app is used for both,
// and the empty state is where a new user learns which questions land.
const SUGGESTION_KEYS = ['chat.suggest.1', 'chat.suggest.2', 'chat.suggest.3', 'chat.suggest.4']

const MIN_WIDTH = 340
const MAX_WIDTH = 900
/** Composer growth ceiling — beyond this the transcript gets squeezed out. */
const MAX_COMPOSER_PX = 320

export default function AssistantPanel({
  onClose,
  onNavToPerson,
  onNavToImage,
  onNavToImages,
}: {
  onClose: () => void
  onNavToPerson: (id: number) => void
  onNavToImage: (imageId: number) => void
  onNavToImages: (personIds: number[]) => void
}) {
  const t = useT()
  const { lang, nameOrder } = useSettings()
  const qc = useQueryClient()

  const [threadId, setThreadId] = useState<number | null>(null)
  const [input, setInput] = useState('')
  const [live, setLive] = useState<LiveMessage | null>(null)
  const [pendingUser, setPendingUser] = useState<string | null>(null)
  // Server id of the message being sent. Once the refetched transcript contains
  // it, the optimistic bubble is dropped — without this the two overlap and the
  // question appears twice while the answer streams.
  const [pendingUserId, setPendingUserId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  const [showThreads, setShowThreads] = useState(false)
  const [width, setWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('mnemosyne_assistantWidth') ?? '')
    return Number.isFinite(saved) && saved >= MIN_WIDTH ? saved : 440
  })
  const [style, setStyleState] = useState<ChatStyle>(() => {
    const saved = localStorage.getItem('mnemosyne_chatStyle')
    return saved === 'narrative' ? 'narrative' : 'structured'
  })

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { data: settings } = useQuery<AiSettings>({
    queryKey: ['ai-settings'],
    queryFn: api.ai.getSettings,
  })
  const { data: threads = [] } = useQuery<ChatThread[]>({
    queryKey: ['ai-threads'],
    queryFn: api.ai.listThreads,
  })
  const { data: messages = [] } = useQuery<ChatMessage[]>({
    queryKey: ['ai-messages', threadId],
    queryFn: () => api.ai.listMessages(threadId as number),
    enabled: threadId !== null,
  })

  const busy = live !== null

  // Follow the tail of the conversation as it streams.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, live?.content, live?.toolCalls.length, pendingUser])

  useEffect(() => {
    if (settings && !settings.configured) setShowSetup(true)
  }, [settings?.configured])

  // Abort an in-flight stream if the panel unmounts mid-answer.
  useEffect(() => () => abortRef.current?.abort(), [])

  // Grow the composer with its content instead of keeping a one-line box that
  // makes a long question impossible to review before sending.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_PX)}px`
  }, [input])

  // Drag the left edge to resize; persisted so it survives a reload.
  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (startX - ev.clientX)))
      setWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
      setWidth(w => { localStorage.setItem('mnemosyne_assistantWidth', String(w)); return w })
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function setStyle(s: ChatStyle) {
    setStyleState(s)
    localStorage.setItem('mnemosyne_chatStyle', s)
  }

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy) return

    setError(null)
    setInput('')
    setPendingUser(trimmed)
    setPendingUserId(null)
    setLive({ content: '', toolCalls: [] })

    let id = threadId
    try {
      if (id === null) {
        const created = await api.ai.createThread()
        id = created.id
        setThreadId(id)
        qc.invalidateQueries({ queryKey: ['ai-threads'] })
      }

      const controller = new AbortController()
      abortRef.current = controller

      await api.ai.stream(
        id,
        { message: trimmed, lang, name_order: nameOrder, style },
        ev => {
          switch (ev.type) {
            case 'user_saved':
              // The transcript now owns this message; refetch so the optimistic
              // copy can retire the moment the real one arrives.
              setPendingUserId(ev.message_id)
              qc.invalidateQueries({ queryKey: ['ai-messages', id] })
              break
            case 'text':
              setLive(l => (l ? { ...l, content: l.content + ev.text } : l))
              break
            case 'tool_start':
              setLive(l => l && {
                ...l,
                toolCalls: [...l.toolCalls, {
                  id: ev.id, name: ev.name, input: ev.input,
                  result: null, duration_ms: null, is_error: false,
                }],
              })
              break
            case 'tool_end':
              setLive(l => l && {
                ...l,
                toolCalls: l.toolCalls.map(c =>
                  c.id === ev.id
                    ? { ...c, result: ev.result, duration_ms: ev.duration_ms, is_error: ev.is_error }
                    : c),
              })
              break
            case 'error':
              setError(ev.message)
              break
            case 'notice':
              setError(ev.message)
              break
          }
        },
        controller.signal,
      )
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      abortRef.current = null
      setLive(null)
      setPendingUser(null)
      setPendingUserId(null)
      // The server owns the transcript — refetch rather than trusting local state.
      qc.invalidateQueries({ queryKey: ['ai-messages', id] })
      qc.invalidateQueries({ queryKey: ['ai-threads'] })
    }
  }

  function newThread() {
    abortRef.current?.abort()
    setThreadId(null)
    setLive(null)
    setPendingUser(null)
    setError(null)
    setShowThreads(false)
    inputRef.current?.focus()
  }

  async function openThread(id: number) {
    abortRef.current?.abort()
    setThreadId(id)
    setLive(null)
    setError(null)
    setShowThreads(false)
  }

  async function removeThread(id: number) {
    await api.ai.deleteThread(id)
    if (id === threadId) newThread()
    qc.invalidateQueries({ queryKey: ['ai-threads'] })
  }

  const empty = threadId === null || (messages.length === 0 && !pendingUser)

  return (
    <aside
      className="ai-panel shrink-0 h-full flex flex-col relative border-l border-zinc-800/80"
      style={{
        width: `${width}px`,
        background: 'linear-gradient(165deg, rgba(33,32,46,0.92) 0%, rgba(24,24,27,0.96) 55%, rgba(18,18,20,0.98) 100%)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* Vertical counterpart of the header's brand hairline. */}
      <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-brand-500/40 to-transparent pointer-events-none" />

      {/* Resize grip — wider than it looks so it is easy to grab. */}
      <div
        onPointerDown={startResize}
        onDoubleClick={() => { setWidth(440); localStorage.setItem('mnemosyne_assistantWidth', '440') }}
        title={t('chat.resize')}
        className="absolute inset-y-0 -left-1 w-2 cursor-col-resize z-10 group"
      >
        <div className="absolute inset-y-0 left-1 w-px bg-transparent group-hover:bg-brand-500/60 transition-colors" />
      </div>

      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3.5 py-3 border-b border-zinc-800/70">
        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
             style={{ background: 'linear-gradient(135deg, #9333ea 0%, #7e22ce 100%)' }}>
          <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2z" />
          </svg>
        </div>
        <span className="text-sm font-semibold font-display text-zinc-200 truncate flex-1 min-w-0">
          {threads.find(x => x.id === threadId)?.title || t('chat.title')}
        </span>

        <button onClick={() => setShowThreads(o => !o)} title={t('chat.history')}
                className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h10" />
          </svg>
        </button>
        <button onClick={newThread} title={t('chat.new')}
                className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button onClick={() => setShowSetup(s => !s)} title={t('chat.settings')}
                className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors shrink-0">
          {/* Same cog as the app header — the previous starburst read as a
              brightness control, not settings. */}
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
        <button onClick={onClose} title={t('chat.close')}
                className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Thread history */}
      {showThreads && (
        <div className="shrink-0 max-h-56 overflow-y-auto border-b border-zinc-800/70 py-1">
          {threads.length === 0 && (
            <p className="px-3.5 py-2 text-xs text-zinc-600">{t('chat.noThreads')}</p>
          )}
          {threads.map(th => (
            <div key={th.id} className="group flex items-center gap-1 px-2">
              <button
                onClick={() => openThread(th.id)}
                className={`flex-1 min-w-0 text-left px-1.5 py-1.5 rounded-md text-xs truncate transition-colors ${
                  th.id === threadId ? 'text-brand-300' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {th.title || t('chat.untitled')}
              </button>
              <button
                onClick={() => removeThread(th.id)}
                title={t('common.delete')}
                className="w-6 h-6 shrink-0 rounded flex items-center justify-center text-zinc-700 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Body */}
      {showSetup && settings ? (
        // Rendered as a direct flex child, not wrapped: a nested div with
        // overflow-y-auto but no height of its own just grows to fit and never
        // scrolls, which pushed the Save button off screen.
        <AssistantSetup settings={settings} onDone={() => setShowSetup(false)} />
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3.5 py-4 space-y-4">
            {empty && !pendingUser ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-2">
                <h2 className="text-xl font-display font-bold ai-shimmer">{t('chat.empty.title')}</h2>
                <p className="text-xs text-zinc-500 mt-2 mb-6 leading-relaxed max-w-[280px]">
                  {t('chat.empty.subtitle')}
                </p>
                <div className="w-full space-y-2">
                  {SUGGESTION_KEYS.map(k => (
                    <button
                      key={k}
                      onClick={() => send(t(k))}
                      className="w-full text-left text-xs text-zinc-400 rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2.5 hover:border-brand-500/50 hover:text-zinc-200 hover:bg-brand-500/[0.06] transition-colors"
                    >
                      {t(k)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map(m => (
                  <AssistantMessage
                    key={m.id}
                    role={m.role}
                    content={m.content}
                    toolCalls={m.tool_calls}
                    onNavToPerson={onNavToPerson}
                    onNavToImage={onNavToImage}
                    onNavToImages={onNavToImages}
                  />
                ))}
                {pendingUser && !messages.some(m => m.id === pendingUserId) && (
                  <AssistantMessage role="user" content={pendingUser} toolCalls={[]} onNavToPerson={onNavToPerson}
                    onNavToImage={onNavToImage}
                    onNavToImages={onNavToImages} />
                )}
                {live && (
                  <AssistantMessage
                    role="assistant"
                    content={live.content}
                    toolCalls={live.toolCalls}
                    streaming
                    onNavToPerson={onNavToPerson}
                    onNavToImage={onNavToImage}
                    onNavToImages={onNavToImages}
                  />
                )}
              </>
            )}

            {error && (
              <div className="rounded-lg border border-red-800/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="shrink-0 p-3 border-t border-zinc-800/70">
            {/* Response style — swaps the prompt's formatting instructions, not
                just a display preference, so it takes effect on the next turn. */}
            <div className="flex items-center gap-1 mb-2">
              {CHAT_STYLES.map(s => (
                <button
                  key={s}
                  onClick={() => setStyle(s)}
                  title={t(`chat.style.${s}.hint`)}
                  className={`px-2 py-1 rounded-md text-[10.5px] font-medium border transition-colors ${
                    style === s
                      ? 'border-brand-500/40 bg-brand-500/15 text-brand-300'
                      : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60'
                  }`}
                >
                  {t(`chat.style.${s}`)}
                </button>
              ))}
            </div>
            <div className="relative rounded-xl border border-zinc-700/70 bg-zinc-900/70 focus-within:border-brand-500/60 transition-colors">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send(input)
                  }
                }}
                rows={1}
                placeholder={settings?.configured ? t('chat.placeholder') : t('chat.placeholderSetup')}
                disabled={!settings?.configured || busy}
                // Height is driven by the auto-grow effect above; overflow-auto
                // takes over once the ceiling is reached.
                className="w-full bg-transparent resize-none px-3 py-2.5 pr-11 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none disabled:opacity-50 overflow-y-auto leading-relaxed"
                style={{ minHeight: '42px', maxHeight: `${MAX_COMPOSER_PX}px` }}
              />
              {busy ? (
                <button
                  onClick={() => abortRef.current?.abort()}
                  title={t('chat.stop')}
                  className="absolute right-2 bottom-2 w-7 h-7 rounded-lg flex items-center justify-center bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors"
                >
                  <span className="block w-2.5 h-2.5 rounded-[2px] bg-current" />
                </button>
              ) : (
                <button
                  onClick={() => send(input)}
                  disabled={!input.trim() || !settings?.configured}
                  title={t('chat.send')}
                  className="absolute right-2 bottom-2 w-7 h-7 rounded-lg flex items-center justify-center text-white transition-opacity disabled:opacity-30"
                  style={{ background: 'linear-gradient(135deg, #9333ea 0%, #7e22ce 100%)' }}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              )}
            </div>
            <p className="text-[10px] text-zinc-700 mt-1.5 px-1">{t('chat.disclaimer')}</p>
          </div>
        </>
      )}
    </aside>
  )
}

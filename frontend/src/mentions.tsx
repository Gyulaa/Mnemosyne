/**
 * The `@` mention picker — one implementation for every field that has one.
 *
 * Three fields use it today (a text document's body, a document's description,
 * a document's title) and they used to carry three near-copies of this logic,
 * which is how they drifted apart: one showed relatives under the name, another
 * showed only the name. Given names repeat heavily within a family, a bare name
 * cannot be picked from reliably — so the row rendering lives here, once, and
 * every mention list shows the same thing.
 *
 * `useAtMention` owns the state (open/closed, query, keyboard cursor, caret
 * anchor) and hands back a ready-made `popup` to render. The caller keeps
 * ownership of the text: it says what an accepted mention *writes* into the
 * field, which differs — a Markdown body gets `@[name](#pid-N)`, a plain-text
 * title gets the bare name.
 */
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PersonFull } from './types'
import { displayPersonName, useSettings, useT } from './SettingsContext'
import { caretAnchor, useCaretPopup, type CaretAnchor } from './caretPopup'
import { personMatches, FamilyContextLines, personLifeSummary } from './familyContext'
import { usePersonDirectory } from './components/PersonSelect'

/** How many people a mention list offers at once. */
export const MENTION_LIMIT = 8

export interface AtMentionContext {
  /** What has been typed after the `@`. */
  query: string
  /** Index of the `@` itself, so the caller can replace from there. */
  atStart: number
}

/**
 * Is the caret inside an `@…` mention being typed? Returns the `@`'s position
 * and the query after it, or null when there is no live mention at the caret.
 */
export function getAtMentionContext(text: string, cursorPos: number): AtMentionContext | null {
  const before = text.slice(0, cursorPos)
  const idx = before.lastIndexOf('@')
  if (idx === -1) return null
  const afterAt = before.slice(idx)
  // A `[` means the mention is already resolved into a link; a newline means
  // the `@` belongs to an earlier line and the caret has moved on.
  if (afterAt.includes('[') || afterAt.includes('\n')) return null
  return { query: before.slice(idx + 1), atStart: idx }
}

/**
 * The mention list itself. Every row carries the person's years/place line and
 * their close relatives — see the module comment for why that is not optional.
 */
function MentionList({ matches, cursor, onHover, onPick, popupRef, style }: {
  matches: PersonFull[]
  cursor: number
  onHover: (i: number) => void
  onPick: (p: PersonFull) => void
  popupRef: React.RefObject<HTMLDivElement | null>
  style: React.CSSProperties
}) {
  const t = useT()
  const { nameOrder } = useSettings()
  const { familyMap } = usePersonDirectory()

  return (
    <div ref={popupRef} style={{ ...style, zIndex: 9999, width: 288 }}
      className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden">
      <p className="px-3 pt-2 pb-1 text-xs font-semibold text-zinc-600 uppercase tracking-wider">
        {t('textDoc.mentionPerson')}
      </p>
      <div className="max-h-72 overflow-y-auto">
        {matches.map((p, i) => {
          const active = i === cursor
          const bio = personLifeSummary(p)
          return (
            <button key={p.id} type="button"
              onMouseDown={e => { e.preventDefault(); onPick(p) }}
              onMouseEnter={() => onHover(i)}
              className={`w-full text-left px-3 py-2 transition-all ${active ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'}`}>
              <p className={`text-xs font-medium ${active ? 'text-zinc-100' : 'text-zinc-200'}`}>
                {displayPersonName(p, nameOrder)}
              </p>
              {bio && <p className="text-xs text-zinc-500 mt-0.5 truncate">{bio}</p>}
              <FamilyContextLines fam={familyMap.get(p.id)} dim={!active} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * `@` mention behaviour for one field.
 *
 * Wire it up with three calls: `sync()` from the field's `onChange` (and from
 * anything else that moves the caret), `handleKeyDown()` from its `onKeyDown`
 * — it returns true when it consumed the key — and `{popup}` somewhere in the
 * returned JSX. `onPick` receives the person and the context to replace.
 */
export function useAtMention(onPick: (person: PersonFull, ctx: AtMentionContext) => void) {
  const { nameOrder } = useSettings()
  const { persons } = usePersonDirectory()

  const [ctx, setCtx] = useState<AtMentionContext | null>(null)
  const [anchor, setAnchor] = useState<CaretAnchor | null>(null)
  const [cursor, setCursor] = useState(0)

  const matches = useMemo(
    () => (ctx ? persons.filter(p => personMatches(p, ctx.query, nameOrder)).slice(0, MENTION_LIMIT) : []),
    [ctx, persons, nameOrder],
  )
  useEffect(() => { setCursor(0) }, [matches])

  const placement = useCaretPopup(anchor)

  function close() { setCtx(null); setAnchor(null) }

  /** Re-read the caret: opens, updates or closes the list as the text implies. */
  function sync(field: HTMLTextAreaElement | HTMLInputElement, value: string, caret: number) {
    const next = getAtMentionContext(value, caret)
    setCtx(next)
    setAnchor(next ? caretAnchor(field, caret) : null)
  }

  /** True when the key belonged to the mention list and the field should ignore it. */
  function handleKeyDown(e: React.KeyboardEvent): boolean {
    if (!ctx || matches.length === 0) return false
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, matches.length - 1)); return true }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); return true }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); onPick(matches[cursor], ctx); return true }
    if (e.key === 'Escape')    { e.preventDefault(); close(); return true }
    return false
  }

  const popup = ctx !== null && anchor !== null && matches.length > 0
    ? createPortal(
        <MentionList
          matches={matches} cursor={cursor}
          onHover={setCursor}
          onPick={p => onPick(p, ctx)}
          popupRef={placement.ref} style={placement.style}
        />,
        document.body,
      )
    : null

  return { open: ctx !== null, sync, close, handleKeyDown, popup }
}

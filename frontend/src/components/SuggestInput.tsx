/**
 * A text field that offers what the project has already had typed into it.
 *
 * This is the one implementation of that behaviour. `PlaceInput` and the
 * person's vocabulary fields (occupation, religion, nationality, education,
 * cause of death, title) are thin wrappers that differ only in where their
 * options come from and what a row shows — the input, the dropdown, the
 * keyboard handling and the blur rules live here. Two near-copies of a
 * suggestion list is how the `@` mention popups drifted apart, and reconciling
 * them cost more than the extraction would have.
 *
 * Three rules it exists to enforce:
 *
 * * **Free text always wins.** The list is a suggestion, never a constraint,
 *   and nothing is written into the field that the user did not choose.
 * * **Enter is only swallowed when a row is highlighted.** Otherwise the
 *   keystroke belongs to the form, and typing a brand-new value would need an
 *   Escape first.
 * * **Matching is accent- and case-insensitive, anywhere in the string** — an
 *   option is found by any part of it, not only by how it starts.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { foldPlace } from '../placeKey'

export interface SuggestOption {
  /** What gets written into the field when the row is chosen. */
  value: string
  /** Folded `value` — supplied by the caller, so it can come from the server. */
  key: string
  /** How many records already use it. Shown greyed at the end of the row. */
  count: number
  /** Optional short label saying what kind of row this is. */
  hint?: string
  /** Distinguishes two rows sharing a `key` (a whole value and one of its parts). */
  rowId?: string
}

export interface SuggestInputProps {
  value: string
  onChange: (value: string) => void
  options: SuggestOption[]
  placeholder?: string
  className: string
  /** Cap on rows shown at once; the rest stay reachable by typing more. */
  limit?: number
  autoFocus?: boolean
  onBlur?: () => void
}

export default function SuggestInput({
  value, onChange, options, placeholder, className, limit = 8, autoFocus, onBlur,
}: SuggestInputProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const q = foldPlace(value)
    // An empty field offers the most-used values rather than nothing: before the
    // first keystroke is exactly when a suggestion saves the most typing.
    // A field already holding exactly one option's value drops that option —
    // there is nothing left to suggest — but keeps the ones it is a part of.
    const pool = q ? options.filter(o => o.key.includes(q) && o.key !== q) : options
    return pool.slice(0, limit)
  }, [options, value, limit])

  useEffect(() => { setActive(-1) }, [value])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const pick = (o: SuggestOption) => {
    onChange(o.value)
    setOpen(false)
    setActive(-1)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(i => (i + 1) % matches.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(i => (i <= 0 ? matches.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      if (active >= 0) {
        e.preventDefault()
        pick(matches[active])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div ref={containerRef} className="relative flex-1 min-w-20">
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        // Rows are picked on mousedown with preventDefault, so clicking one
        // never blurs the field — which leaves blur free to mean "done here"
        // and stops the list hanging open after a Tab to the next field.
        onBlur={() => { setOpen(false); setActive(-1); onBlur?.() }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        // Dropped straight down and no wider than the field: the person panel is
        // docked to the right edge at 520px, so anything wider runs off-screen.
        <div className="absolute top-full left-0 right-0 mt-1 min-w-48 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl z-50 overflow-hidden">
          <div className="max-h-56 overflow-y-auto py-1">
            {matches.map((o, i) => (
              <button
                key={o.rowId ?? o.key}
                type="button"
                onMouseDown={e => { e.preventDefault(); pick(o) }}
                onMouseEnter={() => setActive(i)}
                className={`w-full px-2.5 py-1.5 text-left flex items-baseline gap-2 transition-colors ${i === active ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'}`}
              >
                <span className="text-xs text-zinc-100 truncate flex-1">{o.value}</span>
                {o.hint && <span className="text-[10px] text-zinc-500 shrink-0">{o.hint}</span>}
                {o.count > 0 && (
                  <span className="text-[10px] text-zinc-600 tabular-nums shrink-0">{o.count}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

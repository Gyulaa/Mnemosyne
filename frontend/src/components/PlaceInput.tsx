/**
 * A place field: a plain text input with the project's existing places offered
 * underneath it.
 *
 * Every place in the app goes through here rather than through a bare `<input>`.
 * Nothing else offered what had already been typed, so the same village
 * accumulated a spelling per typist, and no later cleanup fixes that
 * retroactively.
 *
 * Two things it deliberately does not do:
 *
 * * **It never parses a place string.** The comma levels arrive already split
 *   from `GET /api/places`, decided once in `backend/places.py`. A second
 *   heuristic in the browser is how the tree card sizes drifted from the PNG
 *   export, and a house number is a subtler judgement than a card width.
 * * **It never overrides what was typed.** The list is a suggestion; free text
 *   is always a valid place, and Enter only picks a row when the user has
 *   arrowed onto one.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { PlaceUsage } from '../types'
import { useT } from '../SettingsContext'
import { foldPlace } from '../placeKey'

/** Places, fetched once per screen and shared by every field on it. */
export function usePlaces() {
  return useQuery({
    queryKey: ['places'],
    queryFn: api.places.list,
    staleTime: 60_000,
  })
}

export interface PlaceInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className: string
  /** Cap on rows shown at once; the rest stay reachable by typing more. */
  limit?: number
  autoFocus?: boolean
  onBlur?: () => void
}

export default function PlaceInput({
  value, onChange, placeholder, className, limit = 8, autoFocus, onBlur,
}: PlaceInputProps) {
  const t = useT()
  const { data: places = [] } = usePlaces()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const q = foldPlace(value)
    // An empty field offers the most-used places rather than nothing: the first
    // keystroke is exactly when a suggestion is worth most.
    const pool: PlaceUsage[] = q
      ? places.filter(p => p.key.includes(q) && p.key !== q)
      : places
    return pool.slice(0, limit)
  }, [places, value, limit])

  useEffect(() => { setActive(-1) }, [value])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const pick = (p: PlaceUsage) => {
    onChange(p.value)
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
      // Only swallow Enter when a row is actually highlighted — otherwise the
      // keystroke belongs to the form, and typing a brand-new place would need
      // an Escape first.
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
            {matches.map((p, i) => (
              <button
                key={`${p.key}-${p.is_settlement}`}
                type="button"
                onMouseDown={e => { e.preventDefault(); pick(p) }}
                onMouseEnter={() => setActive(i)}
                className={`w-full px-2.5 py-1.5 text-left flex items-baseline gap-2 transition-colors ${i === active ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'}`}
              >
                <span className="text-xs text-zinc-100 truncate flex-1">{p.value}</span>
                {p.is_settlement && (
                  <span className="text-[10px] text-zinc-500 shrink-0">{t('place.settlementOnly')}</span>
                )}
                <span className="text-[10px] text-zinc-600 tabular-nums shrink-0">{p.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

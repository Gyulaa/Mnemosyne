/**
 * Positioning for popups that belong to the caret of a `<textarea>` or a
 * single-line `<input>` — the `@` mention pickers in the note, document and
 * title fields.
 *
 * Neither element gives caret coordinates, so `caretAnchor()` measures them the
 * usual way: an off-screen div styled exactly like the field, holding the text
 * up to the caret, with the rest in a span whose offset is the caret.
 *
 * `useCaretPopup()` then places the popup below that line, flipping it above
 * when the space below is too small and clamping it to the viewport either way.
 * Anchoring the popup to the *field* instead is what put the list off the top
 * of the screen in the document editor, where the textarea starts high up.
 */
import { useLayoutEffect, useRef, useState } from 'react'

const MARGIN = 8   // keep this much clear of every viewport edge
const GAP = 6      // between the caret's line and the popup

export type CaretAnchor = { top: number; bottom: number; left: number }

/** Everything that can change where a glyph lands. Not `boxSizing`: see below. */
const MIRROR_PROPS = [
  'direction',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontFamily',
  'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform',
  'textAlign', 'whiteSpace', 'wordBreak', 'overflowWrap', 'tabSize',
] as const

/** Viewport rect of the caret's line: its top, its bottom, and its x. */
export function caretAnchor(field: HTMLTextAreaElement | HTMLInputElement, index: number): CaretAnchor {
  const cs = getComputedStyle(field)
  const rect = field.getBoundingClientRect()
  // An `<input>` never wraps and is always one line, which changes both how the
  // mirror is measured and what the caret's "line" is.
  const singleLine = field.tagName === 'INPUT'

  const mirror = document.createElement('div')
  for (const prop of MIRROR_PROPS) mirror.style[prop] = cs[prop]
  // Force content-box and give it the computed *content* width, so the mirror
  // wraps at the same column whatever box model the textarea itself uses.
  mirror.style.boxSizing = 'content-box'
  mirror.style.height = 'auto'
  mirror.style.position = 'absolute'
  mirror.style.top = '0'
  mirror.style.left = '-9999px'
  mirror.style.visibility = 'hidden'
  if (singleLine) {
    // Constraining the width would wrap text an input scrolls instead, putting
    // the caret on an imaginary second line.
    mirror.style.width = 'auto'
    mirror.style.whiteSpace = 'pre'
  } else {
    mirror.style.width = cs.width
    mirror.style.whiteSpace = 'pre-wrap'
    mirror.style.overflowWrap = 'break-word'
  }
  // A scrollbar on the mirror would narrow it and move every wrap point.
  mirror.style.overflow = 'hidden'

  mirror.textContent = field.value.slice(0, index)
  const marker = document.createElement('span')
  // A trailing newline collapses without something after it, and an empty span
  // has no box to measure.
  marker.textContent = field.value.slice(index) || '.'
  mirror.appendChild(marker)

  document.body.appendChild(mirror)
  const offsetTop = marker.offsetTop
  const offsetLeft = marker.offsetLeft
  document.body.removeChild(mirror)

  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2
  // Offsets run from the mirror's padding edge, so the borders are still ours
  // to add — `rect` starts at the field's outer border edge.
  const borderTop = parseFloat(cs.borderTopWidth) || 0
  const borderLeft = parseFloat(cs.borderLeftWidth) || 0
  // A caret scrolled out of the field would drag the popup with it; keep it
  // alongside the visible part instead.
  const top = singleLine
    ? rect.top
    : Math.min(Math.max(rect.top + borderTop + offsetTop - field.scrollTop, rect.top), rect.bottom)
  return {
    top,
    // An input's one line *is* the field, whatever its padding does vertically.
    bottom: singleLine ? rect.bottom : Math.min(top + lineHeight, rect.bottom),
    left: rect.left + borderLeft + offsetLeft - field.scrollLeft,
  }
}

function place(anchor: CaretAnchor, popup: HTMLElement): { top: number; left: number } {
  const { offsetHeight: h, offsetWidth: w } = popup
  const below = window.innerHeight - anchor.bottom - GAP - MARGIN
  const above = anchor.top - GAP - MARGIN

  let top: number
  if (h <= below || below >= above) top = anchor.bottom + GAP
  else top = anchor.top - GAP - h
  top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, window.innerHeight - h - MARGIN))

  const left = Math.min(Math.max(anchor.left, MARGIN), Math.max(MARGIN, window.innerWidth - w - MARGIN))
  return { top, left }
}

/**
 * Ref + inline style for a caret popup. Pass `null` while it is closed.
 *
 * The popup is rendered hidden for one frame so it can be measured before it is
 * placed — its height decides whether it opens downwards or upwards, and a
 * resize (a longer match list, an expanded row) re-places it.
 */
export function useCaretPopup(anchor: CaretAnchor | null) {
  const ref = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!anchor || !el) { setPlacement(null); return }
    const measure = () => setPlacement(place(anchor, el))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [anchor])

  return {
    ref,
    style: {
      position: 'fixed' as const,
      top: placement?.top ?? anchor?.bottom ?? 0,
      left: placement?.left ?? anchor?.left ?? 0,
      visibility: (placement ? 'visible' : 'hidden') as 'visible' | 'hidden',
    },
  }
}

/**
 * Every modal backdrop closes on click — some through a panel that calls
 * `stopPropagation()` so a click inside it doesn't bubble out, others (plain
 * lightboxes) by letting an unprotected click bubble all the way to the
 * backdrop on purpose, so clicking the dark margin around an image closes it.
 * Neither is enough on its own: dragging to select text (e.g. selecting all
 * of an existing title before retyping it), or just dragging on an image
 * past its own edge, can end the drag outside where it started. Browsers
 * then fire the resulting `click` on the nearest common ancestor of the
 * mousedown and mouseup targets, which is neither element the drag actually
 * touched — so a `stopPropagation` inside the drag's start point never runs,
 * and an unprotected lightbox closes on a drag that never left the image.
 *
 * `useBackdropClose` closes only on a stationary click: the element under
 * the pointer at mousedown must be the same element the resulting `click`
 * targets. A real drag never satisfies that, regardless of which pattern the
 * modal uses.
 */
import { useRef } from 'react'
import type { MouseEvent } from 'react'

export function useBackdropClose(onClose: () => void) {
  const mouseDownTarget = useRef<EventTarget | null>(null)
  return {
    onMouseDown: (e: MouseEvent) => { mouseDownTarget.current = e.target },
    onClick: (e: MouseEvent) => {
      if (mouseDownTarget.current === e.target) onClose()
    },
  }
}

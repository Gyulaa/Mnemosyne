/**
 * The client half of the place comparison key — pure, no React, no `api.ts`.
 *
 * It lives outside the component for the same reason `graphLayout.ts` and
 * `treeGeometry.ts` do: it can be imported by a plain Node script and checked
 * against the Python side, which in a repo with no test suite is the only way
 * to verify it beyond looking at a dropdown.
 *
 * It has to agree with `fold()` and `normalize_raw()` in `backend/places.py`,
 * because the server sends each row's folded `key` and this is what a typed
 * query — or a raw column value being looked up among those rows — is folded
 * with. What counts as a *house number* is not decided here and never should
 * be: that heuristic exists once, server-side, and arrives already applied.
 */

/** NFD, drop the combining marks, lower-case, trim — Python's `fold()`. */
export function foldPlace(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

/** `foldPlace` of the comma levels re-joined — Python's `fold(normalize_raw(…))`. */
export function placeKey(raw: string | null | undefined): string {
  if (!raw) return ''
  const levels = raw
    .split(',')
    .map(l => l.split(/\s+/).filter(Boolean).join(' '))
    .filter(Boolean)
  return foldPlace(levels.join(', '))
}

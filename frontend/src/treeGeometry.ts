/**
 * Family tree node geometry — shared by the interactive view and the PNG export.
 *
 * These must be one definition, not two. `TreeView` computes node positions from
 * them, while `TreeExportModal` only *draws* cards at those positions; if the two
 * copies drift, the exported image gets correctly-placed cards of the wrong size
 * and they overlap or leave gaps.
 *
 * Sizing is driven by the text a card has to hold. The budget is:
 *
 *   text height = NH - 8 (outer py-1) - 12 (inner py-1.5) = 72px
 *   line height = 12.75px (text-xs at a 17px root) x 1.375 (leading-snug) = 17.5px
 *   => 4 lines
 */

/** Node width. Text column is NW - 40 (avatar) - 10 (gap) - 20 (padding). */
export const NW = 168
/** Node height. See the four-line budget above before reducing this. */
export const NH = 92
/** Horizontal gap between sibling nodes. */
export const HG = 30
/** Vertical gap between generations. */
export const VG = 96
/** Padding around the whole tree. */
export const PAD = 72
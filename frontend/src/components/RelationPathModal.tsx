import { useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { PersonFull, Relation } from '../types'
import { useSettings, displayPersonName, displayInitials } from '../SettingsContext'
import type { NameOrder } from '../SettingsContext'

// ── BFS path finder ────────────────────────────────────────────────────────────

type EdgeLabel = 'parent' | 'child' | 'sibling' | 'spouse'

interface PathEdge {
  fromId: number
  toId: number
  label: EdgeLabel
  blood: boolean
}

function findPath(fromId: number, toId: number, relations: Relation[]): PathEdge[] | null {
  if (fromId === toId) return []

  type Adj = { toId: number; label: EdgeLabel; blood: boolean }
  const adj = new Map<number, Adj[]>()
  const push = (from: number, e: Adj) => {
    if (!adj.has(from)) adj.set(from, [])
    adj.get(from)!.push(e)
  }

  for (const r of relations) {
    if (r.type === 'parent') {
      push(r.person_a_id, { toId: r.person_b_id, label: 'parent', blood: true })
      push(r.person_b_id, { toId: r.person_a_id, label: 'child',  blood: true })
    } else if (r.type === 'sibling') {
      push(r.person_a_id, { toId: r.person_b_id, label: 'sibling', blood: true })
      push(r.person_b_id, { toId: r.person_a_id, label: 'sibling', blood: true })
    } else if (r.type === 'spouse') {
      push(r.person_a_id, { toId: r.person_b_id, label: 'spouse', blood: false })
      push(r.person_b_id, { toId: r.person_a_id, label: 'spouse', blood: false })
    }
  }

  const prev = new Map<number, { from: number; edge: Adj } | null>([[fromId, null]])
  const queue = [fromId]

  while (queue.length) {
    const cur = queue.shift()!
    if (cur === toId) {
      const path: PathEdge[] = []
      let id = toId
      while (id !== fromId) {
        const entry = prev.get(id)!
        path.unshift({ fromId: entry.from, toId: id, label: entry.edge.label, blood: entry.edge.blood })
        id = entry.from
      }
      return path
    }
    for (const e of adj.get(cur) ?? []) {
      if (!prev.has(e.toId)) {
        prev.set(e.toId, { from: cur, edge: e })
        queue.push(e.toId)
      }
    }
  }
  return null
}

// ── LCA computation ────────────────────────────────────────────────────────────

// BFS upward through parent relations, returns every ancestor with their depth
function ancestorsWithDepth(personId: number, relations: Relation[]): Map<number, number> {
  const result = new Map<number, number>([[personId, 0]])
  const queue: [number, number][] = [[personId, 0]]
  while (queue.length) {
    const [cur, d] = queue.shift()!
    for (const r of relations) {
      if (r.type === 'parent' && r.person_b_id === cur && !result.has(r.person_a_id)) {
        result.set(r.person_a_id, d + 1)
        queue.push([r.person_a_id, d + 1])
      }
    }
  }
  return result
}

// Returns the nearest common ancestor, preferring male when equidistant
function findLCA(
  personAId: number,
  personBId: number,
  relations: Relation[],
  byId: Map<number, PersonFull>,
): number | null {
  const dA = ancestorsWithDepth(personAId, relations)
  const dB = ancestorsWithDepth(personBId, relations)

  const candidates: Array<{ id: number; total: number }> = []
  for (const [id, depthA] of dA) {
    if (dB.has(id)) candidates.push({ id, total: depthA + dB.get(id)! })
  }
  if (!candidates.length) return null

  const minDepth = Math.min(...candidates.map(c => c.total))
  const best = candidates.filter(c => c.total === minDepth)
  const male = best.find(c => byId.get(c.id)?.sex === 'M')
  return (male ?? best[0]).id
}

// ── Layout constants ───────────────────────────────────────────────────────────

const ROW_SIZE = 5
const CARD_W  = 88   // px — MiniCard width
const EDGE_W  = 60   // px — EdgeConnector width
const ROW_W   = ROW_SIZE * CARD_W + (ROW_SIZE - 1) * EDGE_W  // 680 px

const LABEL_TEXT: Record<EdgeLabel, string> = {
  parent:  'parent of',
  child:   'child of',
  sibling: 'sibling',
  spouse:  'spouse',
}

// Line colour per relation kind. Spouse edges get their own hue so a marriage
// link never reads as a descent link.
function edgeStroke(label: EdgeLabel, highlight?: boolean) {
  if (label === 'spouse') return highlight ? '#60a5fa' : '#a78bfa'
  return '#52525b'
}

/**
 * Which way the arrowhead points, in *visual* terms.
 *
 * A 'parent' edge runs from the parent to the child, so travelling it moves
 * down a generation and the arrow points forward. A 'child' edge runs from the
 * child up to the parent, so the arrow has to point backward. Either way the
 * head lands on the child. Odd snake rows render with flex-row-reverse, which
 * mirrors left/right — hence the XOR against `rtl`.
 */
function arrowPointsForward(label: EdgeLabel, rtl: boolean) {
  return (label === 'parent') !== rtl
}

const hasArrow  = (label: EdgeLabel) => label === 'parent' || label === 'child'
const isSpouse  = (label: EdgeLabel) => label === 'spouse'

function labelPillClass(blood: boolean, highlight?: boolean) {
  return [
    'px-1 py-0.5 rounded text-[8px] font-medium tracking-wide uppercase whitespace-nowrap',
    blood
      ? 'text-zinc-500 bg-zinc-800/80'
      : highlight
      ? 'text-blue-300 bg-blue-950/60 border border-blue-700/50'
      : 'text-violet-400 bg-violet-950/60 border border-violet-800/40',
  ].join(' ')
}

// ── Person mini-card ───────────────────────────────────────────────────────────

type HighlightType = 'endpoint' | 'lca' | 'marriage'

function MiniCard({ person, highlightType, onClick }: {
  person: PersonFull
  highlightType?: HighlightType
  onClick?: () => void
}) {
  const [err, setErr] = useState(false)
  const { nameOrder } = useSettings()
  const initials = displayInitials(person)
  const by = person.birth_date ? person.birth_date.slice(0, 4) : person.birth_year != null ? String(person.birth_year) : null
  const dy = person.death_date ? person.death_date.slice(0, 4) : person.death_year != null ? String(person.death_year) : null
  const years = [by, dy].filter(Boolean).join('–')

  const ringClass =
    highlightType === 'lca'      ? 'ring-2 ring-rose-500 bg-zinc-700' :
    highlightType === 'marriage' ? 'ring-2 ring-blue-400/80 bg-zinc-700' :
    highlightType === 'endpoint' ? 'ring-2 ring-violet-500/60 bg-zinc-700' :
    'bg-zinc-800 border border-zinc-700'

  const clickable = !!onClick
  const hoverRing = clickable
    ? highlightType === 'lca'      ? 'hover:ring-rose-400'
    : highlightType === 'marriage' ? 'hover:ring-blue-300/90'
    : highlightType === 'endpoint' ? 'hover:ring-violet-400'
    : 'hover:ring-2 hover:ring-zinc-500'
    : ''

  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0" style={{ width: CARD_W }}>
      <button
        onClick={onClick}
        disabled={!clickable}
        title={clickable ? `Open ${person.name ?? 'person'}` : undefined}
        className={`w-10 h-10 rounded-full overflow-hidden flex items-center justify-center transition-all ${ringClass} ${hoverRing} ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {person.thumbnail_face_id && !err
          ? <img src={api.faceThumbnailUrl(person.thumbnail_face_id, 80)} className="w-full h-full object-cover" onError={() => setErr(true)} />
          : <span className="text-xs font-semibold text-zinc-400">{initials}</span>
        }
      </button>
      <div className="text-center w-full px-1">
        <button
          onClick={onClick}
          disabled={!clickable}
          className={`text-xs font-semibold leading-tight line-clamp-2 w-full transition-colors ${highlightType === 'lca' ? 'text-rose-300' : 'text-zinc-100'} ${clickable ? 'hover:underline cursor-pointer' : 'cursor-default'}`}
        >
          {displayPersonName(person, nameOrder)}
        </button>
        {years && <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">{years}</p>}
        {highlightType === 'lca' && (
          <p className="text-[8px] text-rose-500/80 font-medium tracking-wide uppercase mt-0.5">LCA</p>
        )}
      </div>
    </div>
  )
}

// ── Horizontal edge connector ──────────────────────────────────────────────────

function EdgeConnector({ label, blood, highlight, rtl = false }: {
  label: EdgeLabel; blood: boolean; highlight?: boolean; rtl?: boolean
}) {
  const H      = 12
  const mid    = H / 2
  const stroke = edgeStroke(label, highlight)
  const spouse = isSpouse(label)
  const arrow  = hasArrow(label)
  const fwd    = arrowPointsForward(label, rtl)
  // Leave room for the head so the line doesn't poke through its tip
  const x1 = arrow && !fwd ? 9 : 1
  const x2 = arrow && fwd ? EDGE_W - 9 : EDGE_W - 1

  return (
    <div className="flex flex-col items-center shrink-0" style={{ width: EDGE_W }}>
      <svg width={EDGE_W} height={H} aria-hidden>
        {spouse ? (
          // Marriage bar: a double rule, the genealogical convention for a union
          <>
            <line x1={1} y1={mid - 2} x2={EDGE_W - 1} y2={mid - 2} stroke={stroke} strokeWidth={1.25} />
            <line x1={1} y1={mid + 2} x2={EDGE_W - 1} y2={mid + 2} stroke={stroke} strokeWidth={1.25} />
          </>
        ) : (
          <line x1={x1} y1={mid} x2={x2} y2={mid} stroke={stroke} strokeWidth={1.25} />
        )}
        {arrow && (
          <path
            d={fwd
              ? `M${EDGE_W - 1},${mid} L${EDGE_W - 9},${mid - 4} L${EDGE_W - 9},${mid + 4} Z`
              : `M1,${mid} L9,${mid - 4} L9,${mid + 4} Z`}
            fill={stroke}
          />
        )}
      </svg>
      <span className={`mt-1 ${labelPillClass(blood, highlight)}`}>
        {LABEL_TEXT[label]}
      </span>
    </div>
  )
}

// ── Turn connector (vertical, between snake rows) ──────────────────────────────

function TurnConnector({ edge, side, highlight }: { edge: PathEdge; side: 'right' | 'left'; highlight?: boolean }) {
  const W = 16, SEG = 14, cx = W / 2
  const stroke = edgeStroke(edge.label, highlight)
  const spouse = isSpouse(edge.label)
  const arrow  = hasArrow(edge.label)
  // Travel between rows always runs downward, so a 'parent' edge points down at
  // the child and a 'child' edge points back up at it. Row mirroring is
  // horizontal only, so `side` never flips this.
  const down   = edge.label === 'parent'

  const doubleLine = (
    <>
      <line x1={cx - 2} y1={0} x2={cx - 2} y2={SEG} stroke={stroke} strokeWidth={1.25} />
      <line x1={cx + 2} y1={0} x2={cx + 2} y2={SEG} stroke={stroke} strokeWidth={1.25} />
    </>
  )

  return (
    <div
      className={`flex py-0.5 ${side === 'right' ? 'justify-end' : 'justify-start'}`}
      style={{ width: ROW_W }}
    >
      <div className="flex flex-col items-center" style={{ width: CARD_W }}>
        <svg width={W} height={SEG} aria-hidden>
          {spouse ? doubleLine : (
            <line x1={cx} y1={arrow && !down ? 8 : 0} x2={cx} y2={SEG} stroke={stroke} strokeWidth={1.25} />
          )}
          {arrow && !down && <path d={`M${cx},0 L${cx - 4},8 L${cx + 4},8 Z`} fill={stroke} />}
        </svg>

        <span className={labelPillClass(edge.blood, highlight)}>
          {LABEL_TEXT[edge.label]}
        </span>

        <svg width={W} height={SEG} aria-hidden>
          {spouse ? doubleLine : (
            <line x1={cx} y1={0} x2={cx} y2={arrow && down ? SEG - 8 : SEG} stroke={stroke} strokeWidth={1.25} />
          )}
          {arrow && down && <path d={`M${cx},${SEG} L${cx - 4},${SEG - 8} L${cx + 4},${SEG - 8} Z`} fill={stroke} />}
        </svg>
      </div>
    </div>
  )
}

// ── Canvas export ─────────────────────────────────────────────────────────────

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

async function exportRelationPathPNG(
  chainPersons: PersonFull[],
  path: PathEdge[],
  highlightMap: Map<number, HighlightType>,
  personA: PersonFull,
  personB: PersonFull,
  nameOrder: NameOrder,
  lcaId: number | null,
  byId: Map<number, PersonFull>,
  isBloodOnly: boolean,
  steps: number,
) {
  const DPR = 2
  const CCARD_W = 120
  const CEDGE_W = 72
  const SLOT_W  = CCARD_W + CEDGE_W
  const AVATAR_R = 28
  const CARD_BODY_H = AVATAR_R * 2 + 52
  const CTURN_H  = 50
  const CPAD     = 48
  const HEADER_H = 72
  const FOOTER_H = steps > 0 ? 54 : 0
  const CROW_SIZE = 5

  const nCols    = Math.min(CROW_SIZE, chainPersons.length)
  const rowWidth = nCols * CCARD_W + Math.max(0, nCols - 1) * CEDGE_W

  type ERow = { persons: PersonFull[]; edges: PathEdge[]; isRTL: boolean; turnEdge: PathEdge | null }
  const rows: ERow[] = []
  if (path.length > 0) {
    for (let r = 0; r * CROW_SIZE < chainPersons.length; r++) {
      const s = r * CROW_SIZE
      const e = Math.min(s + CROW_SIZE, chainPersons.length)
      rows.push({
        persons:  chainPersons.slice(s, e),
        edges:    path.slice(s, e - 1),
        isRTL:    r % 2 === 1,
        turnEdge: e < chainPersons.length ? path[e - 1] : null,
      })
    }
  }

  const nRows  = Math.max(rows.length, 1)
  const chainH = nRows * CARD_BODY_H + Math.max(0, nRows - 1) * CTURN_H
  const canvasW = rowWidth + CPAD * 2
  const canvasH = CPAD + HEADER_H + chainH + FOOTER_H + CPAD

  // Pre-load avatar images
  const avatarImgs = new Map<number, HTMLImageElement | null>()
  await Promise.all(
    chainPersons
      .filter(p => p.thumbnail_face_id != null)
      .map(p => new Promise<void>(res => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload  = () => { avatarImgs.set(p.id, img);  res() }
        img.onerror = () => { avatarImgs.set(p.id, null); res() }
        img.src = api.faceThumbnailUrl(p.thumbnail_face_id!, 80)
      }))
  )

  const canvas = document.createElement('canvas')
  canvas.width  = canvasW * DPR
  canvas.height = canvasH * DPR
  const ctx = canvas.getContext('2d')!
  ctx.scale(DPR, DPR)

  // Background
  ctx.fillStyle = '#09090b'
  ctx.fillRect(0, 0, canvasW, canvasH)

  // Header
  const nameA = displayPersonName(personA, nameOrder) || '(unnamed)'
  const nameB = displayPersonName(personB, nameOrder) || '(unnamed)'
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#3f3f46'
  ctx.font = '600 10px system-ui,-apple-system,sans-serif'
  ctx.fillText('RELATIONSHIP', canvasW / 2, CPAD + 14)
  ctx.fillStyle = '#e4e4e7'
  ctx.font = '700 15px system-ui,-apple-system,sans-serif'
  ctx.fillText(`${nameA}  ·  ${nameB}`, canvasW / 2, CPAD + 38)
  ctx.fillStyle = '#27272a'
  ctx.fillRect(CPAD, CPAD + 50, canvasW - CPAD * 2, 1)

  const startY = CPAD + HEADER_H

  // ── helpers ──────────────────────────────────────────────────────────────

  function drawAvatar(person: PersonFull, cx: number, cy: number) {
    const ht        = highlightMap.get(person.id)
    const ringColor = ht === 'lca' ? '#ef4444' : ht === 'endpoint' ? '#7c3aed' : ht === 'marriage' ? '#3b82f6' : null

    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, AVATAR_R, 0, Math.PI * 2)
    ctx.clip()
    const img = avatarImgs.get(person.id)
    if (img) {
      ctx.drawImage(img, cx - AVATAR_R, cy - AVATAR_R, AVATAR_R * 2, AVATAR_R * 2)
    } else {
      ctx.fillStyle = '#3f3f46'
      ctx.fillRect(cx - AVATAR_R, cy - AVATAR_R, AVATAR_R * 2, AVATAR_R * 2)
    }
    ctx.restore()

    if (!img) {
      ctx.fillStyle    = '#a1a1aa'
      ctx.font         = `700 ${Math.floor(AVATAR_R * 0.55)}px system-ui,-apple-system,sans-serif`
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(displayInitials(person), cx, cy)
      ctx.textBaseline = 'alphabetic'
    }

    if (ringColor) {
      ctx.beginPath()
      ctx.arc(cx, cy, AVATAR_R + 2.5, 0, Math.PI * 2)
      ctx.strokeStyle = ringColor
      ctx.lineWidth   = 2.5
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.arc(cx, cy, AVATAR_R, 0, Math.PI * 2)
      ctx.strokeStyle = '#3f3f46'
      ctx.lineWidth   = 1
      ctx.stroke()
    }

    const fullName = displayPersonName(person, nameOrder) || '(unnamed)'
    ctx.font         = '600 11px system-ui,-apple-system,sans-serif'
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'alphabetic'
    let name = fullName
    while (ctx.measureText(name).width > CCARD_W - 8 && name.length > 3) {
      name = name.slice(0, -4) + '…'
    }
    ctx.fillStyle = ht === 'lca' ? '#fca5a5' : '#f4f4f5'
    ctx.fillText(name, cx, cy + AVATAR_R + 18)

    if (ht === 'lca') {
      ctx.fillStyle = '#f87171'
      ctx.font      = '700 7px system-ui,-apple-system,sans-serif'
      ctx.fillText('LCA', cx, cy + AVATAR_R + 30)
    }

    const by = person.birth_date ? person.birth_date.slice(0, 4) : person.birth_year != null ? String(person.birth_year) : null
    const dy = person.death_date ? person.death_date.slice(0, 4) : person.death_year != null ? String(person.death_year) : null
    const years = [by, dy].filter(Boolean).join('–')
    if (years) {
      ctx.fillStyle = '#52525b'
      ctx.font      = '400 9px system-ui,-apple-system,sans-serif'
      ctx.fillText(years, cx, cy + AVATAR_R + (ht === 'lca' ? 42 : 31))
    }
  }

  function drawArrowHead(tipX: number, tipY: number, dir: 'left' | 'right' | 'up' | 'down', color: string) {
    const L = 8, HW = 4
    ctx.beginPath()
    ctx.moveTo(tipX, tipY)
    if (dir === 'right')      { ctx.lineTo(tipX - L, tipY - HW); ctx.lineTo(tipX - L, tipY + HW) }
    else if (dir === 'left')  { ctx.lineTo(tipX + L, tipY - HW); ctx.lineTo(tipX + L, tipY + HW) }
    else if (dir === 'down')  { ctx.lineTo(tipX - HW, tipY - L); ctx.lineTo(tipX + HW, tipY - L) }
    else                      { ctx.lineTo(tipX - HW, tipY + L); ctx.lineTo(tipX + HW, tipY + L) }
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
  }

  function drawHEdge(sx: number, ex: number, lineY: number, edge: PathEdge, rtl: boolean) {
    const color  = edge.label === 'spouse' ? '#a78bfa' : '#52525b'
    const spouse = edge.label === 'spouse'
    const arrow  = edge.label === 'parent' || edge.label === 'child'
    const fwd    = (edge.label === 'parent') !== rtl

    ctx.strokeStyle = color
    ctx.lineWidth   = 1.5
    if (spouse) {
      // Marriage bar — double rule, matching the on-screen connector
      for (const dy of [-2, 2]) {
        ctx.beginPath()
        ctx.moveTo(sx, lineY + dy)
        ctx.lineTo(ex, lineY + dy)
        ctx.stroke()
      }
    } else {
      ctx.beginPath()
      ctx.moveTo(arrow && !fwd ? sx + 8 : sx, lineY)
      ctx.lineTo(arrow && fwd ? ex - 8 : ex, lineY)
      ctx.stroke()
    }
    if (arrow) drawArrowHead(fwd ? ex : sx, lineY, fwd ? 'right' : 'left', color)

    const label = LABEL_TEXT[edge.label].toUpperCase()
    ctx.font     = '600 7px system-ui,-apple-system,sans-serif'
    const tw = ctx.measureText(label).width
    const bw = tw + 10, bh = 14, mx = (sx + ex) / 2
    const bx = mx - bw / 2, by2 = lineY + 5

    roundRect(ctx, bx, by2, bw, bh, 3)
    ctx.fillStyle = edge.blood ? '#1a1a1e' : '#1e1b4b'
    ctx.fill()
    roundRect(ctx, bx, by2, bw, bh, 3)
    ctx.strokeStyle = edge.blood ? '#3f3f46' : '#3730a3'
    ctx.lineWidth   = 0.5
    ctx.stroke()

    ctx.fillStyle    = edge.blood ? '#71717a' : '#818cf8'
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, mx, by2 + bh / 2)
    ctx.textBaseline = 'alphabetic'
  }

  function drawVEdge(turnX: number, topY: number, botY: number, edge: PathEdge) {
    const label = LABEL_TEXT[edge.label].toUpperCase()
    ctx.font     = '600 7px system-ui,-apple-system,sans-serif'
    const tw = ctx.measureText(label).width
    const bw = tw + 10, bh = 14
    const midY = (topY + botY) / 2
    const bx = turnX - bw / 2, by2 = midY - bh / 2

    const color  = edge.label === 'spouse' ? '#a78bfa' : '#52525b'
    const spouse = edge.label === 'spouse'
    const arrow  = edge.label === 'parent' || edge.label === 'child'
    const down   = edge.label === 'parent'

    ctx.strokeStyle = color
    ctx.lineWidth   = 1.5
    if (spouse) {
      for (const dx of [-2, 2]) {
        ctx.beginPath(); ctx.moveTo(turnX + dx, topY);      ctx.lineTo(turnX + dx, by2);  ctx.stroke()
        ctx.beginPath(); ctx.moveTo(turnX + dx, by2 + bh);  ctx.lineTo(turnX + dx, botY); ctx.stroke()
      }
    } else {
      ctx.beginPath()
      ctx.moveTo(turnX, arrow && !down ? topY + 8 : topY)
      ctx.lineTo(turnX, by2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(turnX, by2 + bh)
      ctx.lineTo(turnX, arrow && down ? botY - 8 : botY)
      ctx.stroke()
    }
    if (arrow) drawArrowHead(turnX, down ? botY : topY, down ? 'down' : 'up', color)

    roundRect(ctx, bx, by2, bw, bh, 3)
    ctx.fillStyle = edge.blood ? '#1a1a1e' : '#1e1b4b'
    ctx.fill()
    roundRect(ctx, bx, by2, bw, bh, 3)
    ctx.strokeStyle = edge.blood ? '#3f3f46' : '#3730a3'
    ctx.lineWidth   = 0.5
    ctx.stroke()

    ctx.fillStyle    = edge.blood ? '#71717a' : '#818cf8'
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, turnX, midY)
    ctx.textBaseline = 'alphabetic'
  }

  // ── Draw rows ─────────────────────────────────────────────────────────────

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri]
    const n   = row.persons.length
    const rowY   = startY + ri * (CARD_BODY_H + CTURN_H)
    const avatarY = rowY + AVATAR_R + 4

    for (let i = 0; i < n; i++) {
      const px = CPAD + (row.isRTL ? (nCols - 1 - i) * SLOT_W : i * SLOT_W)
      drawAvatar(row.persons[i], px + CCARD_W / 2, avatarY)

      if (i < n - 1) {
        const sx = row.isRTL
          ? CPAD + (nCols - 2 - i) * SLOT_W + CCARD_W
          : CPAD + i * SLOT_W + CCARD_W
        drawHEdge(sx, sx + CEDGE_W, avatarY, row.edges[i], row.isRTL)
      }
    }

    if (row.turnEdge) {
      const turnX   = row.isRTL ? CPAD + CCARD_W / 2 : CPAD + (n - 1) * SLOT_W + CCARD_W / 2
      const turnTopY = rowY + CARD_BODY_H + 2
      const turnBotY = rowY + CARD_BODY_H + CTURN_H - 2
      drawVEdge(turnX, turnTopY, turnBotY, row.turnEdge)
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────

  if (steps > 0) {
    const fy = startY + chainH + 20
    ctx.fillStyle = '#27272a'
    ctx.fillRect(CPAD, fy - 10, canvasW - CPAD * 2, 1)

    ctx.textBaseline = 'middle'
    ctx.textAlign    = 'left'
    ctx.font         = '600 11px system-ui,-apple-system,sans-serif'
    ctx.fillStyle    = isBloodOnly ? '#fda4af' : '#93c5fd'
    ctx.fillText(isBloodOnly ? '♥ Blood relatives' : '♥ Related by marriage', CPAD, fy + 10)

    ctx.textAlign = 'right'
    ctx.fillStyle = '#3f3f46'
    ctx.font      = '400 11px system-ui,-apple-system,sans-serif'
    ctx.fillText(`${steps} ${steps === 1 ? 'step' : 'steps'}`, canvasW - CPAD, fy + 10)

    if (lcaId) {
      const lcaP = byId.get(lcaId)
      if (lcaP) {
        ctx.textAlign = 'left'
        ctx.fillStyle = '#fca5a5'
        ctx.font      = '400 9px system-ui,-apple-system,sans-serif'
        ctx.fillText(`LCA: ${displayPersonName(lcaP, nameOrder)}`, CPAD, fy + 28)
      }
    }
    ctx.textBaseline = 'alphabetic'
  }

  // Watermark
  ctx.fillStyle    = '#27272a'
  ctx.font         = '400 8px system-ui,-apple-system,sans-serif'
  ctx.textAlign    = 'right'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('Mnemosyne', canvasW - CPAD / 2, canvasH - 10)

  // Download
  const safeName = `${nameA}_${nameB}`.replace(/[^a-zA-Z0-9_-]/g, '_')
  canvas.toBlob(blob => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a   = document.createElement('a')
    a.download = `relationship_${safeName}.png`
    a.href = url
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 'image/png')
}

// ── Main modal ─────────────────────────────────────────────────────────────────

interface Props {
  personA: PersonFull
  personB: PersonFull
  persons: PersonFull[]
  relations: Relation[]
  onClose: () => void
  onNavigate?: (personId: number) => void
}

export default function RelationPathModal({ personA, personB, persons, relations, onClose, onNavigate }: Props) {
  const { nameOrder } = useSettings()
  const [exporting, setExporting] = useState(false)
  const byId = new Map(persons.map(p => [p.id, p]))

  const path = findPath(personA.id, personB.id, relations)
  const hasPath = path !== null
  const isBloodOnly = path !== null && path.every(e => e.blood)
  const steps = path?.length ?? 0

  // Build display chain
  const chainPersons: PersonFull[] = [personA]
  if (path && path.length > 0) {
    for (const edge of path) {
      const p = byId.get(edge.toId)
      if (p) chainPersons.push(p)
    }
  }

  // ── LCA + highlight computation ────────────────────────────────────────────
  const lcaId = isBloodOnly ? findLCA(personA.id, personB.id, relations, byId) : null
  const lcaInChain = lcaId != null && chainPersons.some(p => p.id === lcaId)

  const highlightMap = new Map<number, HighlightType>()
  highlightMap.set(personA.id, 'endpoint')
  highlightMap.set(personB.id, 'endpoint')
  if (lcaId && lcaInChain) highlightMap.set(lcaId, 'lca')

  // Marriage bridge: mark persons adjacent to non-blood edges
  if (!isBloodOnly && path) {
    for (const edge of path) {
      if (!edge.blood) {
        if (!highlightMap.has(edge.fromId)) highlightMap.set(edge.fromId, 'marriage')
        if (!highlightMap.has(edge.toId))   highlightMap.set(edge.toId,   'marriage')
      }
    }
  }

  // Build snake rows
  interface SnakeRow {
    persons: PersonFull[]
    edges: PathEdge[]
    isRTL: boolean
    turnEdge: PathEdge | null
  }
  const rows: SnakeRow[] = []
  if (hasPath && chainPersons.length > 1 && path) {
    for (let r = 0; r * ROW_SIZE < chainPersons.length; r++) {
      const s = r * ROW_SIZE
      const e = Math.min(s + ROW_SIZE, chainPersons.length)
      rows.push({
        persons: chainPersons.slice(s, e),
        edges: path.slice(s, e - 1),
        isRTL: r % 2 === 1,
        turnEdge: e < chainPersons.length ? path[e - 1] : null,
      })
    }
  }

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: Math.min(ROW_W + 40, window.innerWidth * 0.92) }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-800">
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold mb-1">Relationship</p>
            <h2 className="text-sm font-semibold text-zinc-100">
              {displayPersonName(personA, nameOrder)}
              <span className="text-zinc-500 font-normal mx-2">and</span>
              {displayPersonName(personB, nameOrder)}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors shrink-0 ml-4"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>

        {/* Chain */}
        <div className="px-5 py-5">
          {!hasPath && (
            <p className="text-sm text-zinc-500 text-center py-4 px-8">
              No relationship found between these two persons.
            </p>
          )}

          {hasPath && chainPersons.length === 1 && (
            <p className="text-sm text-zinc-400 text-center py-2">Same person.</p>
          )}

          {hasPath && rows.length > 0 && (
            <div>
              {rows.map((row, ri) => (
                <div key={ri}>
                  {/*
                    flex-row-reverse for RTL rows creates the snake effect.
                    items-center aligns edge connectors to the vertical midpoint of the cards.
                  */}
                  <div className={`flex items-center ${row.isRTL ? 'flex-row-reverse' : ''}`}>
                    {row.persons.flatMap((p, i): ReactNode[] => {
                      const nodes: ReactNode[] = [
                        <MiniCard
                          key={`c-${ri}-${i}`}
                          person={p}
                          highlightType={highlightMap.get(p.id)}
                          onClick={onNavigate ? () => { onClose(); onNavigate(p.id) } : undefined}
                        />,
                      ]
                      if (i < row.persons.length - 1) {
                        nodes.push(
                          <EdgeConnector
                            key={`e-${ri}-${i}`}
                            label={row.edges[i].label}
                            blood={row.edges[i].blood}
                            highlight={!row.edges[i].blood}
                            rtl={row.isRTL}
                          />
                        )
                      }
                      return nodes
                    })}
                  </div>

                  {row.turnEdge && (
                    <TurnConnector
                      edge={row.turnEdge}
                      side={row.isRTL ? 'left' : 'right'}
                      highlight={!row.turnEdge.blood}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {hasPath && (
          <div className="flex flex-wrap items-center gap-3 px-5 py-3 bg-zinc-950/50 border-t border-zinc-800">
            {steps > 0 && (
              <>
                <div className={[
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
                  isBloodOnly
                    ? 'bg-rose-950/60 text-rose-300 border border-rose-900/50'
                    : 'bg-blue-950/60 text-blue-300 border border-blue-900/50',
                ].join(' ')}>
                  {isBloodOnly ? (
                    <>
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 3C7 7 4 10 4 13a6 6 0 0012 0c0-3-3-6-6-10z" />
                      </svg>
                      Blood relatives
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                      </svg>
                      Related by marriage
                    </>
                  )}
                </div>

                {lcaId && (
                  <div className="relative group/lca">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-950/60 text-rose-300 border border-rose-900/50 cursor-default select-none">
                      <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m8-9h1M3 12H2m15.07-6.07l.707.707M5.636 18.364l-.707.707M18.364 18.364l.707-.707M5.636 5.636l-.707-.707" />
                      </svg>
                      <span className="text-rose-500/70 mr-0.5">LCA:</span>
                      {displayPersonName(byId.get(lcaId) ?? {}, nameOrder)}
                      {!lcaInChain && (
                        <span className="text-rose-600/60 ml-0.5">(not in path)</span>
                      )}
                    </div>
                    {/* Tooltip */}
                    <div className="pointer-events-none absolute bottom-full left-0 mb-2 w-64 opacity-0 group-hover/lca:opacity-100 transition-opacity duration-150 z-10">
                      <div className="bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl p-3">
                        <p className="text-xs font-semibold text-zinc-100 mb-1">Lowest Common Ancestor</p>
                        <p className="text-xs text-zinc-400 leading-relaxed">
                          The nearest ancestor from whom both persons directly descend. Among equidistant candidates, a male ancestor is preferred.
                        </p>
                        {!lcaInChain && (
                          <p className="text-xs text-rose-400/80 mt-1.5 leading-relaxed">
                            This ancestor is not shown in the path above because the connection was found via a sibling relation.
                          </p>
                        )}
                      </div>
                      <div className="w-2 h-2 bg-zinc-800 border-b border-r border-zinc-700 rotate-45 ml-4 -mt-1" />
                    </div>
                  </div>
                )}

                <span className="text-xs text-zinc-600">
                  {steps} {steps === 1 ? 'step' : 'steps'}
                </span>
              </>
            )}

            <button
              onClick={async () => {
                setExporting(true)
                try {
                  await exportRelationPathPNG(chainPersons, path!, highlightMap, personA, personB, nameOrder, lcaId, byId, isBloodOnly, steps)
                } finally {
                  setExporting(false)
                }
              }}
              disabled={exporting}
              className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border border-zinc-700/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exporting ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              )}
              {exporting ? 'Exporting…' : 'Export PNG'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Layout for the Connections graph — pure geometry, no React.
 *
 * Lives in its own module for the same reason `treeGeometry.ts` does: it is the
 * arithmetic that decides where things go, it is worth reading and checking on
 * its own, and a second copy of it inside the component would drift.
 */
import type { GraphEdge, GraphNode } from './types'

export function nodeRadius(n: GraphNode, degree: number): number {
  return Math.min(26, 12 + Math.sqrt(n.photo_count) * 0.55 + degree * 1.6)
}

/** Normalised betweenness at or above this marks someone as a connector. */
export const CONNECTOR_CUTOFF = 0.45

// ── Graph layout ───────────────────────────────────────────────────────────────
//
// The previous layout ran one force simulation over every node with a single
// gravity well at the centre of the canvas. A photo graph is genuinely dense —
// most people appear alongside most other people — and under one gravity well
// that collapses into a single hairball: separate groups get pulled into the
// same heap, and the few people who actually hold the network together end up
// buried somewhere inside it.
//
// This version is built around the three things the picture should answer:
//
//   • who holds the network together  → centrality sets each node's target
//     distance from its group's middle, so connectors sit in the centre and
//     the periphery is pushed outwards
//   • how many separate groups exist  → every connected component is laid out
//     on its own and then packed as a disc; two groups never share a centre
//   • who stands next to whom         → springs, plus a hard collision pass so
//     discs and their labels stop sitting on top of each other
//
// It is deterministic — no randomised seeding — so the same data always draws
// the same picture instead of reshuffling itself every time the tab opens.

const LAYOUT = {
  repulsion: 15000,
  spring: 0.016,
  radial: 0.055,
  damping: 0.78,
  componentGap: 72,   // clear space between two groups
  collisionPad: 16,   // extra clearance between two node discs
}

export interface LayoutPlacement {
  x: number
  y: number
  r: number
  /** Betweenness within the node's own component, 0–1. Drives the connector badge. */
  bridge: number
  component: number
}

export interface LayoutGroup {
  index: number
  size: number
  minX: number; minY: number; maxX: number; maxY: number
}

export interface GraphLayout {
  placement: Map<number, LayoutPlacement>
  groups: LayoutGroup[]
  degree: Map<number, number>
}

function buildAdjacency(nodes: GraphNode[], edges: GraphEdge[]): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>()
  for (const n of nodes) adj.set(n.id, new Set())
  for (const e of edges) {
    adj.get(e.source)?.add(e.target)
    adj.get(e.target)?.add(e.source)
  }
  return adj
}

/** Connected components, largest first — the groups that get packed separately. */
function connectedComponents(nodes: GraphNode[], adj: Map<number, Set<number>>): number[][] {
  const seen = new Set<number>()
  const out: number[][] = []
  for (const n of nodes) {
    if (seen.has(n.id)) continue
    const queue = [n.id]
    const comp: number[] = []
    seen.add(n.id)
    while (queue.length) {
      const v = queue.shift()!
      comp.push(v)
      for (const w of adj.get(v) ?? []) {
        if (!seen.has(w)) { seen.add(w); queue.push(w) }
      }
    }
    out.push(comp)
  }
  return out.sort((a, b) => b.length - a.length)
}

/**
 * Brandes' betweenness centrality on the unweighted graph: how often a person
 * lies on the shortest path between two others. This is the measure that finds
 * the person joining two friend groups even when they are in far fewer photos
 * than anyone inside either group — degree alone would rank them as marginal.
 */
function betweenness(ids: number[], adj: Map<number, Set<number>>): Map<number, number> {
  const bc = new Map<number, number>(ids.map(id => [id, 0]))
  for (const s of ids) {
    const stack: number[] = []
    const pred = new Map<number, number[]>(ids.map(id => [id, []]))
    const sigma = new Map<number, number>(ids.map(id => [id, 0]))
    const dist = new Map<number, number>()
    sigma.set(s, 1)
    dist.set(s, 0)
    const queue = [s]
    while (queue.length) {
      const v = queue.shift()!
      stack.push(v)
      for (const w of adj.get(v) ?? []) {
        if (!dist.has(w)) { dist.set(w, dist.get(v)! + 1); queue.push(w) }
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!)
          pred.get(w)!.push(v)
        }
      }
    }
    const delta = new Map<number, number>(ids.map(id => [id, 0]))
    while (stack.length) {
      const w = stack.pop()!
      for (const v of pred.get(w)!) {
        delta.set(v, delta.get(v)! + (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!))
      }
      if (w !== s) bc.set(w, bc.get(w)! + delta.get(w)!)
    }
  }
  return bc
}

/**
 * Lay one component out around its own origin.
 *
 * `pull` is the blend of betweenness and degree that decides how far in a node
 * belongs. Betweenness carries most of the weight because it is what "connects
 * groups" actually means, but it cannot carry all of it: in a near-complete
 * graph — everyone photographed with everyone — no one lies on anyone else's
 * shortest path, every betweenness is zero, and a pure-betweenness radius would
 * flatten the whole group onto one ring. Degree keeps the picture readable in
 * that case, and a dense blob genuinely has no bridge to point at.
 */
function layoutComponent(
  ids: number[],
  adj: Map<number, Set<number>>,
  edges: GraphEdge[],
  radiusOf: Map<number, number>,
  pull: Map<number, number>,
): Map<number, { x: number; y: number }> {
  const k = ids.length
  const pos = new Map<number, { x: number; y: number; vx: number; vy: number }>()
  if (k === 1) return new Map([[ids[0], { x: 0, y: 0 }]])

  const spread = 90 + Math.sqrt(k) * 58
  // Seed on a golden-angle spiral with the most central node first, so the run
  // starts near its answer instead of untangling from a circle.
  const order = [...ids].sort((a, b) => (pull.get(b) ?? 0) - (pull.get(a) ?? 0))
  order.forEach((id, i) => {
    const angle = i * 2.3999632
    const rr = spread * Math.sqrt((i + 0.5) / k)
    pos.set(id, { x: Math.cos(angle) * rr, y: Math.sin(angle) * rr, vx: 0, vy: 0 })
  })

  const inner = new Set(ids)
  const localEdges = edges.filter(e => inner.has(e.source) && inner.has(e.target))
  const targetR = new Map<number, number>(
    ids.map(id => [id, spread * Math.pow(1 - (pull.get(id) ?? 0), 0.6)]),
  )

  // Everything here is O(k²) per step and it runs synchronously before paint,
  // so the budget shrinks as the group grows. A big group is a blob whose exact
  // settling nobody can read anyway; a frozen tab is noticed immediately.
  const iterations = k <= 60 ? 700 : k <= 160 ? 420 : k <= 320 ? 240 : 140
  const collisionPasses = k <= 160 ? 2 : 1
  const fx = new Map<number, number>()
  const fy = new Map<number, number>()

  for (let step = 0; step < iterations; step++) {
    for (const id of ids) { fx.set(id, 0); fy.set(id, 0) }

    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        const a = pos.get(ids[i])!, b = pos.get(ids[j])!
        const dx = b.x - a.x, dy = b.y - a.y
        const d2 = Math.max(1, dx * dx + dy * dy)
        const d = Math.sqrt(d2)
        const f = LAYOUT.repulsion / d2
        fx.set(ids[i], fx.get(ids[i])! - f * dx / d); fy.set(ids[i], fy.get(ids[i])! - f * dy / d)
        fx.set(ids[j], fx.get(ids[j])! + f * dx / d); fy.set(ids[j], fy.get(ids[j])! + f * dy / d)
      }
    }

    for (const e of localEdges) {
      const a = pos.get(e.source)!, b = pos.get(e.target)!
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 0.1
      const ideal = Math.max(120, 280 - Math.log(e.weight + 1) * 26)
      const f = LAYOUT.spring * (d - ideal)
      fx.set(e.source, fx.get(e.source)! + f * dx / d); fy.set(e.source, fy.get(e.source)! + f * dy / d)
      fx.set(e.target, fx.get(e.target)! - f * dx / d); fy.set(e.target, fy.get(e.target)! - f * dy / d)
    }

    // Radial placement — this is what puts the connectors in the middle.
    for (const id of ids) {
      const p = pos.get(id)!
      const d = Math.sqrt(p.x * p.x + p.y * p.y) || 0.1
      const f = LAYOUT.radial * (d - targetR.get(id)!)
      fx.set(id, fx.get(id)! - f * p.x / d)
      fy.set(id, fy.get(id)! - f * p.y / d)
    }

    for (const id of ids) {
      const p = pos.get(id)!
      p.vx = (p.vx + fx.get(id)!) * LAYOUT.damping
      p.vy = (p.vy + fy.get(id)!) * LAYOUT.damping
      p.x += p.vx
      p.y += p.vy
    }

    // Hard separation. Forces alone leave discs overlapping at this density,
    // and an overlapping disc means an unreadable label.
    for (let pass = 0; pass < collisionPasses; pass++) {
      for (let i = 0; i < k; i++) {
        for (let j = i + 1; j < k; j++) {
          const a = pos.get(ids[i])!, b = pos.get(ids[j])!
          const need = (radiusOf.get(ids[i]) ?? 14) + (radiusOf.get(ids[j]) ?? 14) + LAYOUT.collisionPad
          const dx = b.x - a.x, dy = b.y - a.y
          const d = Math.sqrt(dx * dx + dy * dy) || 0.1
          if (d >= need) continue
          const shift = (need - d) / 2
          const ux = dx / d, uy = dy / d
          a.x -= ux * shift; a.y -= uy * shift
          b.x += ux * shift; b.y += uy * shift
        }
      }
    }
  }

  // Recentre on the centroid so packing can treat the group as a disc at 0,0.
  let sx = 0, sy = 0
  for (const id of ids) { sx += pos.get(id)!.x; sy += pos.get(id)!.y }
  const cx = sx / k, cy = sy / k
  const out = new Map<number, { x: number; y: number }>()
  for (const id of ids) {
    const p = pos.get(id)!
    out.set(id, { x: p.x - cx, y: p.y - cy })
  }
  return out
}

/**
 * Place already-laid-out groups so they do not touch: the largest keeps the
 * middle, the rest take the first free spot on an outward spiral. Nothing here
 * is clever — with a photo library it is one big group and a handful of small
 * ones, and the point is only that a group is never drawn through another.
 *
 * The spiral is stretched sideways because the pane it lands in is a landscape
 * rectangle. Packed on a round spiral, a single three-person offshoot parked
 * above the main group made the drawing taller than it was wide, and fitting
 * that into a wide pane shrank everything to half size — the satellite decided
 * the zoom for the whole picture.
 */
const PACK_ASPECT = { x: 1.55, y: 0.72 }

function packGroups(discs: { radius: number }[]): { x: number; y: number }[] {
  const placed: { x: number; y: number; radius: number }[] = []
  for (const disc of discs) {
    if (!placed.length) { placed.push({ x: 0, y: 0, radius: disc.radius }); continue }
    let best = { x: 0, y: 0 }
    let found = false
    for (let turn = 0; turn < 4000 && !found; turn++) {
      const angle = turn * 0.5
      const dist = 40 + turn * 6
      const cand = {
        x: Math.cos(angle) * dist * PACK_ASPECT.x,
        y: Math.sin(angle) * dist * PACK_ASPECT.y,
      }
      const clear = placed.every(p => {
        const dx = cand.x - p.x, dy = cand.y - p.y
        return Math.sqrt(dx * dx + dy * dy) >= p.radius + disc.radius + LAYOUT.componentGap
      })
      if (clear) { best = cand; found = true }
    }
    placed.push({ ...best, radius: disc.radius })
  }
  return placed.map(p => ({ x: p.x, y: p.y }))
}

export function computeLayout(nodes: GraphNode[], edges: GraphEdge[]): GraphLayout {
  const adj = buildAdjacency(nodes, edges)
  const degree = new Map<number, number>(nodes.map(n => [n.id, adj.get(n.id)?.size ?? 0]))
  const radiusOf = new Map<number, number>(
    nodes.map(n => [n.id, nodeRadius(n, degree.get(n.id) ?? 0)]),
  )

  const components = connectedComponents(nodes, adj)
  const placement = new Map<number, LayoutPlacement>()
  const laid: { ids: number[]; local: Map<number, { x: number; y: number }>; radius: number; bridge: Map<number, number> }[] = []

  for (const ids of components) {
    // Normalise inside the component: every group gets its own middle, so a
    // small group is not left rim-only just because a big one out-scores it.
    const raw = betweenness(ids, adj)
    const maxB = Math.max(...ids.map(id => raw.get(id) ?? 0), 0)
    const maxDeg = Math.max(...ids.map(id => degree.get(id) ?? 0), 1)
    const bridge = new Map<number, number>(
      ids.map(id => [id, maxB > 0 ? (raw.get(id) ?? 0) / maxB : 0]),
    )
    const pull = new Map<number, number>(
      ids.map(id => [id, 0.65 * (bridge.get(id) ?? 0) + 0.35 * ((degree.get(id) ?? 0) / maxDeg)]),
    )

    const local = layoutComponent(ids, adj, edges, radiusOf, pull)
    let radius = 40
    for (const id of ids) {
      const p = local.get(id)!
      radius = Math.max(radius, Math.hypot(p.x, p.y) + (radiusOf.get(id) ?? 14) + 26)
    }
    laid.push({ ids, local, radius, bridge })
  }

  const centres = packGroups(laid.map(l => ({ radius: l.radius })))
  const groups: LayoutGroup[] = []

  laid.forEach((comp, index) => {
    const centre = centres[index]
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const id of comp.ids) {
      const p = comp.local.get(id)!
      const r = radiusOf.get(id) ?? 14
      const x = p.x + centre.x, y = p.y + centre.y
      placement.set(id, { x, y, r, bridge: comp.bridge.get(id) ?? 0, component: index })
      minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r)
      minY = Math.min(minY, y - r); maxY = Math.max(maxY, y + r)
    }
    groups.push({ index, size: comp.ids.length, minX, minY, maxX, maxY })
  })

  return { placement, groups, degree }
}


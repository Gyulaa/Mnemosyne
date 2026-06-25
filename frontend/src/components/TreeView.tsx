import { useState, useRef, useMemo, useEffect } from 'react'
import type { PersonFull, Relation } from '../types'
import { api } from '../api'

// ── Constants ─────────────────────────────────────────────────────────────────

const NW = 148   // node width
const NH = 64    // node height
const HG = 30    // horizontal gap between nodes
const VG = 96    // vertical gap between generations
const PAD = 72   // canvas padding
const PH_SIZE = 40  // phantom node circle diameter

// ── Layout types ──────────────────────────────────────────────────────────────

interface LayoutNode {
  id: number
  person: PersonFull | null  // null = phantom "?" node
  isPhantom: boolean
  gen: number
  x: number
  y: number
  phantomChildIds?: number[]
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

// ── Connected components ──────────────────────────────────────────────────────

function connectedComponents(persons: PersonFull[], relations: Relation[]): PersonFull[][] {
  const adj = new Map<number, Set<number>>()
  const byId = new Map(persons.map(p => [p.id, p]))
  for (const p of persons) adj.set(p.id, new Set())
  for (const r of relations) {
    adj.get(r.person_a_id)?.add(r.person_b_id)
    adj.get(r.person_b_id)?.add(r.person_a_id)
  }
  const visited = new Set<number>()
  const components: PersonFull[][] = []
  for (const p of persons) {
    if (visited.has(p.id)) continue
    const comp: PersonFull[] = []
    const q = [p.id]
    while (q.length) {
      const id = q.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      const person = byId.get(id)
      if (person) comp.push(person)
      for (const nid of adj.get(id) ?? []) {
        if (!visited.has(nid)) q.push(nid)
      }
    }
    if (comp.length) components.push(comp)
  }
  return components
}

// ── Layout ────────────────────────────────────────────────────────────────────

function layoutComponent(persons: PersonFull[], relations: Relation[]): LayoutNode[] {
  if (!persons.length) return []

  const childrenOf = new Map<number, number[]>()
  const parentsOf  = new Map<number, number[]>()
  const spousesOf  = new Map<number, number[]>()
  for (const p of persons) {
    childrenOf.set(p.id, [])
    parentsOf.set(p.id, [])
    spousesOf.set(p.id, [])
  }
  for (const r of relations) {
    if (r.type === 'parent') {
      childrenOf.get(r.person_a_id)?.push(r.person_b_id)
      parentsOf.get(r.person_b_id)?.push(r.person_a_id)
    } else if (r.type === 'spouse') {
      spousesOf.get(r.person_a_id)?.push(r.person_b_id)
      spousesOf.get(r.person_b_id)?.push(r.person_a_id)
    }
  }

  // BFS generation assignment from roots
  const gen = new Map<number, number>()
  const queue: number[] = []
  for (const p of persons) {
    if ((parentsOf.get(p.id) ?? []).length === 0) { gen.set(p.id, 0); queue.push(p.id) }
  }
  for (const p of persons) {
    if (!gen.has(p.id)) { gen.set(p.id, 0); queue.push(p.id) }
  }
  const bfsVisited = new Set<number>()
  while (queue.length) {
    const id = queue.shift()!
    if (bfsVisited.has(id)) continue
    bfsVisited.add(id)
    const g = gen.get(id)!
    for (const cid of childrenOf.get(id) ?? []) {
      if (!gen.has(cid)) { gen.set(cid, g + 1); queue.push(cid) }
    }
    for (const sid of spousesOf.get(id) ?? []) {
      if (!gen.has(sid)) { gen.set(sid, g); queue.push(sid) }
    }
  }

  // Iterative fixup: spouses same gen; children strictly below parents
  let changed = true
  for (let iter = 0; iter < 40 && changed; iter++) {
    changed = false
    for (const r of relations) {
      if (r.type !== 'spouse') continue
      const ga = gen.get(r.person_a_id) ?? 0
      const gb = gen.get(r.person_b_id) ?? 0
      if (ga !== gb) {
        const ng = Math.max(ga, gb)
        gen.set(r.person_a_id, ng); gen.set(r.person_b_id, ng)
        changed = true
      }
    }
    for (const r of relations) {
      if (r.type !== 'parent') continue
      const gp = gen.get(r.person_a_id) ?? 0
      const gc = gen.get(r.person_b_id) ?? 0
      if (gc <= gp) { gen.set(r.person_b_id, gp + 1); changed = true }
    }
  }

  // ── Phantom parents for explicit siblings with no shared parent ──
  const personIds = new Set(persons.map(p => p.id))
  const sibRels = relations.filter(r => r.type === 'sibling')
  const sibAdj = new Map<number, Set<number>>()
  for (const p of persons) sibAdj.set(p.id, new Set())
  for (const r of sibRels) {
    if (personIds.has(r.person_a_id) && personIds.has(r.person_b_id)) {
      sibAdj.get(r.person_a_id)?.add(r.person_b_id)
      sibAdj.get(r.person_b_id)?.add(r.person_a_id)
    }
  }
  const sibVisited = new Set<number>()
  const sibGroups: number[][] = []
  for (const p of persons) {
    if (sibVisited.has(p.id) || (sibAdj.get(p.id)?.size ?? 0) === 0) continue
    const group: number[] = []
    const q2 = [p.id]
    while (q2.length) {
      const id = q2.shift()!
      if (sibVisited.has(id)) continue
      sibVisited.add(id); group.push(id)
      for (const nid of sibAdj.get(id) ?? []) { if (!sibVisited.has(nid)) q2.push(nid) }
    }
    if (group.length >= 2) sibGroups.push(group)
  }
  let phantomCounter = -1
  const phantomEntries: Array<{ id: number; gen: number; childIds: number[] }> = []
  for (const group of sibGroups) {
    const noneHaveParents = group.every(id => (parentsOf.get(id) ?? []).length === 0)
    if (!noneHaveParents) continue
    const phantomId = phantomCounter--
    const phantomGen = Math.min(...group.map(id => gen.get(id) ?? 0)) - 1
    gen.set(phantomId, phantomGen)
    childrenOf.set(phantomId, [...group])
    for (const id of group) parentsOf.get(id)?.push(phantomId)
    phantomEntries.push({ id: phantomId, gen: phantomGen, childIds: [...group] })
  }

  // ── Group by generation, assign x positions ──
  const byGen = new Map<number, number[]>()
  for (const [id, g] of gen) {
    if (!byGen.has(g)) byGen.set(g, [])
    byGen.get(g)!.push(id)
  }

  const xOf = new Map<number, number>()
  const gens = [...byGen.keys()].sort((a, b) => a - b)

  for (const g of gens) {
    const ids = byGen.get(g)!
    const realIds = ids.filter(id => id > 0)
    const phantomIds = ids.filter(id => id < 0)

    const scoreId = (id: number) => {
      const pxs = (parentsOf.get(id) ?? []).filter(pid => pid > 0 && xOf.has(pid)).map(pid => xOf.get(pid)!)
      return pxs.length ? pxs.reduce((a, b) => a + b, 0) / pxs.length : 0
    }

    const realIdSet = new Set(realIds)
    const spouseAdjGen = new Map<number, number[]>()
    for (const id of realIds) spouseAdjGen.set(id, [])
    for (const id of realIds) {
      for (const sid of spousesOf.get(id) ?? []) {
        if (realIdSet.has(sid)) spouseAdjGen.get(id)!.push(sid)
      }
    }

    // Cluster by connected spouse-graph component
    const spouseClusterVis = new Set<number>()
    const spouseClusters: number[][] = []
    for (const id of realIds) {
      if (spouseClusterVis.has(id)) continue
      const cluster: number[] = []
      const cq = [id]
      while (cq.length) {
        const cur = cq.shift()!
        if (spouseClusterVis.has(cur)) continue
        spouseClusterVis.add(cur); cluster.push(cur)
        for (const nid of spouseAdjGen.get(cur) ?? []) { if (!spouseClusterVis.has(nid)) cq.push(nid) }
      }
      spouseClusters.push(cluster)
    }

    spouseClusters.sort((a, b) => {
      const avg = (c: number[]) => c.reduce((s, id) => s + scoreId(id), 0) / c.length
      return avg(a) - avg(b)
    })

    // Within each cluster: order as a chain leaf-to-leaf.
    // After marriage-filtering each cluster is guaranteed to be a simple path.
    const ordered: number[] = []
    for (const cluster of spouseClusters) {
      if (cluster.length === 1) { ordered.push(cluster[0]); continue }
      const clusterSet = new Set(cluster)
      const neighbors = (id: number) => (spouseAdjGen.get(id) ?? []).filter(s => clusterSet.has(s))
      const leaves = cluster.filter(id => neighbors(id).length === 1)
      const startNode = (leaves.length > 0 ? leaves : cluster)
        .reduce((best, id) => scoreId(id) < scoreId(best) ? id : best)
      const path: number[] = []
      const pathSeen = new Set<number>()
      let cur: number | undefined = startNode
      while (cur !== undefined) {
        path.push(cur); pathSeen.add(cur)
        cur = neighbors(cur).find(s => !pathSeen.has(s))
      }
      for (const id of cluster) { if (!pathSeen.has(id)) path.push(id) }
      ordered.push(...path)
    }

    for (const pid of phantomIds) ordered.push(pid)

    const step = NW + HG
    const totalW = ordered.length * step - HG
    ordered.forEach((id, i) => xOf.set(id, i * step - totalW / 2 + NW / 2))
  }

  // Reposition phantom nodes to average x of their children
  for (const { id, childIds } of phantomEntries) {
    const childXs = childIds.filter(cid => xOf.has(cid)).map(cid => xOf.get(cid)!)
    if (childXs.length) xOf.set(id, childXs.reduce((a, b) => a + b, 0) / childXs.length)
  }

  const realNodes: LayoutNode[] = persons.map(p => ({
    id: p.id, person: p, isPhantom: false,
    gen: gen.get(p.id) ?? 0,
    x: xOf.get(p.id) ?? 0,
    y: (gen.get(p.id) ?? 0) * (NH + VG),
  }))

  const phantomNodes: LayoutNode[] = phantomEntries.map(({ id, gen: g, childIds }) => ({
    id, person: null, isPhantom: true,
    gen: g, x: xOf.get(id) ?? 0, y: g * (NH + VG),
    phantomChildIds: childIds,
  }))

  return [...realNodes, ...phantomNodes]
}

const COMPONENT_GAP = 100

function buildLayout(persons: PersonFull[], relations: Relation[]): LayoutNode[] {
  if (!persons.length) return []
  const components = connectedComponents(persons, relations)

  if (components.length === 1) return layoutComponent(persons, relations)

  components.sort((a, b) => b.length - a.length)
  const allNodes: LayoutNode[] = []
  let xCursor = 0

  for (const comp of components) {
    const compIds = new Set(comp.map(p => p.id))
    const compRels = relations.filter(r => compIds.has(r.person_a_id) && compIds.has(r.person_b_id))
    const nodes = layoutComponent(comp, compRels)
    if (!nodes.length) continue

    const xs = nodes.map(n => n.x)
    const minNx = Math.min(...xs) - NW / 2
    const maxNx = Math.max(...xs) + NW / 2
    const shift = xCursor - minNx
    allNodes.push(...nodes.map(n => ({ ...n, x: n.x + shift })))
    xCursor += (maxNx - minNx) + COMPONENT_GAP
  }

  const totalW = xCursor - COMPONENT_GAP
  const cx = totalW / 2
  return allNodes.map(n => ({ ...n, x: n.x - cx }))
}

// ── Relation filtering for multiple marriages ─────────────────────────────────

// For each person with 2+ spouses, keep only the "active" spouse in the layout.
// Also removes parent-child edges belonging to inactive couples so those children
// disappear cleanly instead of floating as orphan roots.
function filterRelationsForLayout(
  relations: Relation[],
  activeMarriages: Map<number, number>,
): Relation[] {
  // Build full spousesOf map
  const spousesOf = new Map<number, number[]>()
  for (const r of relations) {
    if (r.type !== 'spouse') continue
    if (!spousesOf.has(r.person_a_id)) spousesOf.set(r.person_a_id, [])
    if (!spousesOf.has(r.person_b_id)) spousesOf.set(r.person_b_id, [])
    spousesOf.get(r.person_a_id)!.push(r.person_b_id)
    spousesOf.get(r.person_b_id)!.push(r.person_a_id)
  }

  // Build set of hidden spouse pairs (sorted key)
  const hiddenPairs = new Set<string>()
  for (const [pid, spouses] of spousesOf) {
    if (spouses.length <= 1) continue
    const active = activeMarriages.get(pid) ?? spouses[0]
    for (const sid of spouses) {
      if (sid !== active) hiddenPairs.add([pid, sid].sort().join('-'))
    }
  }

  if (!hiddenPairs.size) return relations

  // Build parent list per child (to detect which parent-edges belong to hidden couples)
  const childParents = new Map<number, number[]>()
  for (const r of relations) {
    if (r.type !== 'parent') continue
    if (!childParents.has(r.person_b_id)) childParents.set(r.person_b_id, [])
    childParents.get(r.person_b_id)!.push(r.person_a_id)
  }

  return relations.filter(r => {
    if (r.type === 'spouse') {
      return !hiddenPairs.has([r.person_a_id, r.person_b_id].sort().join('-'))
    }
    if (r.type === 'parent') {
      // Hide parent→child edge if this parent's co-parent forms a hidden couple with them
      const parentId = r.person_a_id
      const childId  = r.person_b_id
      for (const otherParent of childParents.get(childId) ?? []) {
        if (otherParent === parentId) continue
        if (hiddenPairs.has([parentId, otherParent].sort().join('-'))) return false
      }
    }
    return true
  })
}

// ── Edge drawing ──────────────────────────────────────────────────────────────

type EdgeType = 'spouse' | 'couple-stem' | 'couple-bar' | 'child-drop' | 'child-single'

interface EdgeSpec {
  key: string; type: EdgeType
  x1: number; y1: number; x2: number; y2: number
}

function buildEdges(nodes: LayoutNode[], relations: Relation[], minX: number, minY: number): EdgeSpec[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const edges: EdgeSpec[] = []

  // ── 1. Spouse lines ──
  const drawnSpouses = new Set<string>()
  for (const r of relations) {
    if (r.type !== 'spouse') continue
    const key = [r.person_a_id, r.person_b_id].sort().join('-')
    if (drawnSpouses.has(key)) continue
    drawnSpouses.add(key)
    const an = nodeMap.get(r.person_a_id)
    const bn = nodeMap.get(r.person_b_id)
    if (!an || !bn) continue
    const leftN  = an.x <= bn.x ? an : bn
    const rightN = an.x <= bn.x ? bn : an
    const x1 = leftN.x  + NW / 2 - minX
    const x2 = rightN.x - NW / 2 - minX
    const y  = (leftN.y + rightN.y) / 2 - minY
    if (x1 < x2) edges.push({ key: `sp-${key}`, type: 'spouse', x1, y1: y, x2, y2: y })
  }

  // ── 2. Couple-based parent → child edges ──
  const spouseSet = new Set<string>()
  for (const r of relations) {
    if (r.type === 'spouse') spouseSet.add([r.person_a_id, r.person_b_id].sort().join('-'))
  }

  const childParents = new Map<number, number[]>()
  for (const r of relations) {
    if (r.type !== 'parent') continue
    if (!childParents.has(r.person_b_id)) childParents.set(r.person_b_id, [])
    childParents.get(r.person_b_id)!.push(r.person_a_id)
  }
  for (const node of nodes) {
    if (!node.isPhantom || !node.phantomChildIds?.length) continue
    for (const cid of node.phantomChildIds) {
      if (!childParents.has(cid)) childParents.set(cid, [])
      childParents.get(cid)!.push(node.id)
    }
  }

  const coupleMap = new Map<string, { parentIds: number[]; childIds: number[] }>()
  for (const [childId, parents] of childParents) {
    const key = [...parents].sort((a, b) => a - b).join(',')
    if (!coupleMap.has(key)) coupleMap.set(key, { parentIds: [...parents].sort((a, b) => a - b), childIds: [] })
    coupleMap.get(key)!.childIds.push(childId)
  }

  for (const [, { parentIds, childIds }] of coupleMap) {
    const parentNodes = parentIds.map(id => nodeMap.get(id)).filter(Boolean) as LayoutNode[]
    const childNodes  = childIds.map(id => nodeMap.get(id)).filter(Boolean) as LayoutNode[]
    if (!parentNodes.length || !childNodes.length) continue

    let junctionX: number, junctionY: number

    if (parentNodes.length === 1) {
      const pn = parentNodes[0]
      junctionX = pn.x - minX
      junctionY = pn.y + (pn.isPhantom ? PH_SIZE / 2 : NH / 2) - minY
    } else {
      const sorted = [...parentNodes].sort((a, b) => a.x - b.x)
      const leftP  = sorted[0]
      const rightP = sorted[sorted.length - 1]
      const spouseKey = [leftP.id, rightP.id].sort().join('-')
      const areSpouses = spouseSet.has(spouseKey)

      if (areSpouses) {
        const innerLeft  = leftP.x  + NW / 2 - minX
        const innerRight = rightP.x - NW / 2 - minX
        junctionX = (innerLeft + innerRight) / 2
        junctionY = parentNodes[0].y - minY  // spouse line is at card centre
      } else {
        junctionX = parentNodes.reduce((s, p) => s + p.x, 0) / parentNodes.length - minX
        junctionY = Math.max(...parentNodes.map(p => p.y)) + NH / 2 - minY
      }
    }

    const childTops  = childNodes.map(n => n.y - NH / 2 - minY)
    const firstChildY = Math.min(...childTops)
    const cardBottomY = Math.max(...parentNodes.map(p => p.y)) + NH / 2 - minY
    const barY = cardBottomY + (firstChildY - cardBottomY) * 0.5
    const parentKey = parentIds.join(',')

    if (childNodes.length === 1) {
      const cn = childNodes[0]
      edges.push({
        key: `cs-${parentKey}-${cn.id}`, type: 'child-single',
        x1: junctionX, y1: junctionY,
        x2: cn.x - minX, y2: cn.y - NH / 2 - minY,
      })
    } else {
      edges.push({ key: `stem-${parentKey}`, type: 'couple-stem', x1: junctionX, y1: junctionY, x2: junctionX, y2: barY })

      const minCX = Math.min(...childNodes.map(n => n.x - minX))
      const maxCX = Math.max(...childNodes.map(n => n.x - minX))
      edges.push({ key: `bar-${parentKey}`, type: 'couple-bar', x1: minCX, y1: barY, x2: maxCX, y2: barY })

      for (const cn of childNodes) {
        edges.push({
          key: `drop-${parentKey}-${cn.id}`, type: 'child-drop',
          x1: cn.x - minX, y1: barY,
          x2: cn.x - minX, y2: cn.y - NH / 2 - minY,
        })
      }
    }
  }

  return edges
}

// ── PersonCard ────────────────────────────────────────────────────────────────

function PersonCard({
  person,
  selected,
  marriageCount,
  marriageIndex,
  onPrevMarriage,
  onNextMarriage,
}: {
  person: PersonFull
  selected: boolean
  marriageCount?: number
  marriageIndex?: number
  onPrevMarriage?: (e: React.MouseEvent) => void
  onNextMarriage?: (e: React.MouseEvent) => void
}) {
  const [imgErr, setImgErr] = useState(false)
  const span = person.birth_year
    ? person.death_year ? `${person.birth_year}–${person.death_year}` : `* ${person.birth_year}`
    : null
  const initials = (person.name ?? '?').trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'
  const hasMultiple = marriageCount !== undefined && marriageCount > 1

  return (
    <div className={[
      'absolute inset-0 rounded-xl flex items-center gap-2.5 px-2.5 transition-all overflow-hidden',
      selected
        ? 'bg-brand-700 border-2 border-brand-400 shadow-lg shadow-brand-900/60'
        : 'bg-zinc-800/90 border border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800',
    ].join(' ')}>
      {person.thumbnail_face_id && !imgErr ? (
        <img src={api.faceThumbnailUrl(person.thumbnail_face_id, 96)} alt=""
          className="w-10 h-10 rounded-full object-cover shrink-0"
          onError={() => setImgErr(true)} />
      ) : (
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${selected ? 'bg-brand-500 text-white' : 'bg-zinc-700 text-zinc-300'}`}>
          {initials}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className={`text-xs font-semibold truncate leading-snug ${selected ? 'text-white' : 'text-zinc-100'}`}>
          {person.name ?? '(névtelen)'}
        </div>
        {span && <div className={`text-[10px] leading-snug ${selected ? 'text-brand-200' : 'text-zinc-500'}`}>{span}</div>}
        {!hasMultiple && person.face_count > 0 && (
          <div className={`text-[9px] leading-snug ${selected ? 'text-brand-300' : 'text-zinc-600'}`}>{person.face_count} fotó</div>
        )}
      </div>

      {/* Marriage navigator — only for persons with 2+ marriages */}
      {hasMultiple && (
        <div
          className={[
            'absolute bottom-0 left-0 right-0 flex items-center justify-center gap-1',
            'h-5 rounded-b-xl text-[9px] font-medium',
            selected ? 'bg-brand-600/80' : 'bg-zinc-900/80',
          ].join(' ')}
          onClick={e => e.stopPropagation()}
        >
          <button
            className={`px-1 leading-none opacity-60 hover:opacity-100 ${selected ? 'text-brand-200' : 'text-zinc-400'}`}
            onClick={onPrevMarriage}
          >◄</button>
          <span className={selected ? 'text-brand-200' : 'text-zinc-500'}>
            {(marriageIndex ?? 0) + 1}/{marriageCount} házasság
          </span>
          <button
            className={`px-1 leading-none opacity-60 hover:opacity-100 ${selected ? 'text-brand-200' : 'text-zinc-400'}`}
            onClick={onNextMarriage}
          >►</button>
        </div>
      )}
    </div>
  )
}

// ── TreeView ──────────────────────────────────────────────────────────────────

export default function TreeView({
  persons,
  relations,
  selectedId,
  onSelect,
  panelOpen = false,
}: {
  persons: PersonFull[]
  relations: Relation[]
  selectedId: number | null
  onSelect: (id: number) => void
  panelOpen?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const dragOrigin = useRef<{ mx: number; my: number; px: number; py: number } | null>(null)
  const isDragging = useRef(false)

  // personId → currently shown spouseId (for persons with 2+ spouses)
  const [activeMarriages, setActiveMarriages] = useState<Map<number, number>>(new Map())

  // Full marriages map (unfiltered) — needed for the navigator UI on cards
  const allMarriagesOf = useMemo(() => {
    const m = new Map<number, number[]>()
    for (const r of relations) {
      if (r.type !== 'spouse') continue
      if (!m.has(r.person_a_id)) m.set(r.person_a_id, [])
      if (!m.has(r.person_b_id)) m.set(r.person_b_id, [])
      m.get(r.person_a_id)!.push(r.person_b_id)
      m.get(r.person_b_id)!.push(r.person_a_id)
    }
    for (const [k, v] of m) { if (v.length <= 1) m.delete(k) }
    return m
  }, [relations])

  // Relations with inactive marriages stripped out
  const visibleRelations = useMemo(
    () => filterRelationsForLayout(relations, activeMarriages),
    [relations, activeMarriages],
  )

  const nodes = useMemo(() => buildLayout(persons, visibleRelations), [persons, visibleRelations])
  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes])

  const bounds = useMemo(() => {
    if (!nodes.length) return { minX: 0, minY: 0, canvasW: 800, canvasH: 500 }
    const xs = nodes.map(n => n.x)
    const ys = nodes.map(n => n.y)
    const minX = Math.min(...xs) - NW / 2 - PAD
    const minY = Math.min(...ys) - NH / 2 - PAD
    const canvasW = Math.max(...xs) + NW / 2 + PAD - minX
    const canvasH = Math.max(...ys) + NH / 2 + PAD - minY
    return { minX, minY, canvasW, canvasH }
  }, [nodes])

  useEffect(() => {
    if (!containerRef.current || !nodes.length) return
    const { width, height } = containerRef.current.getBoundingClientRect()
    const fitZoom = Math.min(
      (width - 40) / bounds.canvasW,
      (height - 40) / bounds.canvasH,
      1.2,
    ) * 0.9
    setZoom(Math.max(0.15, fitZoom))
    setPan({ x: 0, y: 0 })
  }, []) // eslint-disable-line

  useEffect(() => {
    if (!selectedId) return
    const node = nodeMap.get(selectedId)
    if (!node) return
    const { minX, minY, canvasW, canvasH } = bounds
    setPan({
      x: -(node.x - minX - canvasW / 2),
      y: -(node.y - minY - canvasH / 2),
    })
  }, [selectedId]) // eslint-disable-line

  const edges = useMemo(
    () => buildEdges(nodes, visibleRelations, bounds.minX, bounds.minY),
    [nodes, visibleRelations, bounds],
  )

  const cycleMarriage = (personId: number, dir: -1 | 1) => {
    const spouses = allMarriagesOf.get(personId)
    if (!spouses || spouses.length <= 1) return
    const active = activeMarriages.get(personId) ?? spouses[0]
    const idx = spouses.indexOf(active)
    const newIdx = ((idx + dir) + spouses.length) % spouses.length
    setActiveMarriages(prev => new Map(prev).set(personId, spouses[newIdx]))
  }

  if (!nodes.filter(n => !n.isPhantom).length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <div className="text-4xl opacity-20">🌳</div>
        <p className="text-zinc-500 text-sm">Még nincsenek személyek</p>
      </div>
    )
  }

  const { minX, minY, canvasW, canvasH } = bounds

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden bg-zinc-950 select-none"
      style={{ height: '100%', cursor: dragOrigin.current ? 'grabbing' : 'grab' }}
      onMouseDown={e => {
        if ((e.target as HTMLElement).closest('[data-node]')) return
        dragOrigin.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y }
        isDragging.current = false
      }}
      onMouseMove={e => {
        if (!dragOrigin.current) return
        isDragging.current = true
        setPan({
          x: dragOrigin.current.px + e.clientX - dragOrigin.current.mx,
          y: dragOrigin.current.py + e.clientY - dragOrigin.current.my,
        })
      }}
      onMouseUp={() => { dragOrigin.current = null; isDragging.current = false }}
      onMouseLeave={() => { dragOrigin.current = null; isDragging.current = false }}
      onWheel={e => {
        e.preventDefault()
        setZoom(z => clamp(z * (e.deltaY > 0 ? 0.9 : 1.1), 0.15, 3))
      }}
    >
      {!panelOpen && (
        <>
          <div className="absolute bottom-3 right-3 z-10 flex gap-1.5">
            <button onClick={() => setZoom(z => clamp(z * 1.2, 0.15, 3))}
              className="w-7 h-7 rounded-lg bg-zinc-800/90 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 flex items-center justify-center text-sm font-bold">+</button>
            <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}
              className="h-7 px-2 rounded-lg bg-zinc-800/90 border border-zinc-700 text-zinc-400 hover:bg-zinc-700 text-xs tabular-nums">{Math.round(zoom * 100)}%</button>
            <button onClick={() => setZoom(z => clamp(z * 0.8, 0.15, 3))}
              className="w-7 h-7 rounded-lg bg-zinc-800/90 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 flex items-center justify-center text-sm font-bold">−</button>
          </div>
          <div className="absolute bottom-3 left-3 z-10 flex items-center gap-4 text-[10px] text-zinc-600">
            <span className="flex items-center gap-1.5">
              <svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="#52525b" strokeWidth="1.5"/></svg>
              szülő–gyerek
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="#7c3aed" strokeWidth="2" strokeDasharray="5 3"/></svg>
              házastárs
            </span>
            <span>Húzd · görgő = zoom</span>
          </div>
        </>
      )}

      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: canvasW,
          height: canvasH,
          transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
          transformOrigin: 'center',
        }}
      >
        <svg className="absolute inset-0 pointer-events-none" width={canvasW} height={canvasH} overflow="visible">
          {edges.map(e => {
            switch (e.type) {
              case 'spouse':
                return <line key={e.key} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                  stroke="#7c3aed" strokeWidth={2} strokeDasharray="5 3" opacity={0.65} />
              case 'couple-stem':
              case 'couple-bar':
              case 'child-drop':
                return <line key={e.key} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                  stroke="#52525b" strokeWidth={1.5} />
              case 'child-single': {
                const midY = (e.y1 + e.y2) / 2
                return (
                  <path key={e.key}
                    d={`M ${e.x1} ${e.y1} C ${e.x1} ${midY}, ${e.x2} ${midY}, ${e.x2} ${e.y2}`}
                    stroke="#52525b" strokeWidth={1.5} fill="none" />
                )
              }
            }
          })}
        </svg>

        {nodes.map(node => {
          if (node.isPhantom) {
            return (
              <div key={node.id} style={{
                position: 'absolute',
                left: node.x - minX - NW / 2,
                top:  node.y - minY - NH / 2,
                width: NW, height: NH,
              }} className="flex items-center justify-center">
                <div className="w-10 h-10 rounded-full border-2 border-dashed border-zinc-600 bg-zinc-900 flex items-center justify-center text-zinc-500 font-bold text-sm"
                  title="Ismeretlen szülő">?</div>
              </div>
            )
          }

          const spouses = allMarriagesOf.get(node.id)
          const hasMultiple = spouses !== undefined && spouses.length > 1
          const activeSpouseId = hasMultiple ? (activeMarriages.get(node.id) ?? spouses![0]) : undefined
          const marriageIdx    = hasMultiple ? spouses!.indexOf(activeSpouseId!) : undefined

          return (
            <div key={node.id} data-node style={{
              position: 'absolute',
              left: node.x - minX - NW / 2,
              top:  node.y - minY - NH / 2,
              width: NW, height: NH,
            }} onClick={() => { if (!isDragging.current) onSelect(node.id) }}>
              <PersonCard
                person={node.person!}
                selected={node.id === selectedId}
                marriageCount={hasMultiple ? spouses!.length : undefined}
                marriageIndex={marriageIdx}
                onPrevMarriage={hasMultiple ? e => { e.stopPropagation(); cycleMarriage(node.id, -1) } : undefined}
                onNextMarriage={hasMultiple ? e => { e.stopPropagation(); cycleMarriage(node.id, +1) } : undefined}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

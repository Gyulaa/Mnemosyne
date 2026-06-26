import { useState, useRef, useMemo, useEffect } from 'react'
import type { PersonFull, Relation } from '../types'
import { api } from '../api'

// ── Constants ─────────────────────────────────────────────────────────────────
const NW = 148
const NH = 64
const HG = 30
const VG = 96
const PAD = 72

// ── Types ─────────────────────────────────────────────────────────────────────
interface LayoutNode {
  id: number
  person: PersonFull
  gen: number
  x: number
  y: number
}

interface RelationMaps {
  childrenOf: Map<number, number[]>
  parentsOf:  Map<number, number[]>
  spousesOf:  Map<number, number[]>
  siblingOf:  Map<number, number[]>
}

type EdgeType = 'spouse' | 'couple-stem' | 'couple-bar' | 'child-drop' | 'child-single'
interface EdgeSpec { key: string; type: EdgeType; x1: number; y1: number; x2: number; y2: number }

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

// ── Relation maps ─────────────────────────────────────────────────────────────
function buildRelationMaps(relations: Relation[], visibleIds: Set<number>): RelationMaps {
  const childrenOf = new Map<number, number[]>()
  const parentsOf  = new Map<number, number[]>()
  const spousesOf  = new Map<number, number[]>()
  const siblingOf  = new Map<number, number[]>()
  for (const r of relations) {
    if (!visibleIds.has(r.person_a_id) || !visibleIds.has(r.person_b_id)) continue
    if (r.type === 'parent') {
      if (!childrenOf.has(r.person_a_id)) childrenOf.set(r.person_a_id, [])
      childrenOf.get(r.person_a_id)!.push(r.person_b_id)
      if (!parentsOf.has(r.person_b_id)) parentsOf.set(r.person_b_id, [])
      parentsOf.get(r.person_b_id)!.push(r.person_a_id)
    } else if (r.type === 'spouse') {
      if (!spousesOf.has(r.person_a_id)) spousesOf.set(r.person_a_id, [])
      spousesOf.get(r.person_a_id)!.push(r.person_b_id)
      if (!spousesOf.has(r.person_b_id)) spousesOf.set(r.person_b_id, [])
      spousesOf.get(r.person_b_id)!.push(r.person_a_id)
    } else if (r.type === 'sibling') {
      if (!siblingOf.has(r.person_a_id)) siblingOf.set(r.person_a_id, [])
      siblingOf.get(r.person_a_id)!.push(r.person_b_id)
      if (!siblingOf.has(r.person_b_id)) siblingOf.set(r.person_b_id, [])
      siblingOf.get(r.person_b_id)!.push(r.person_a_id)
    }
  }
  // Derive implicit siblings: children who share both parents are siblings
  for (const [, children] of childrenOf) {
    for (let i = 0; i < children.length; i++) {
      for (let j = i + 1; j < children.length; j++) {
        const a = children[i], b = children[j]
        const aParents = parentsOf.get(a) ?? []
        const bParents = parentsOf.get(b) ?? []
        if (aParents.length < 2 || bParents.length < 2) continue
        const aSet = new Set(aParents)
        if (bParents.every(p => aSet.has(p))) {
          if (!siblingOf.has(a)) siblingOf.set(a, [])
          if (!siblingOf.get(a)!.includes(b)) siblingOf.get(a)!.push(b)
          if (!siblingOf.has(b)) siblingOf.set(b, [])
          if (!siblingOf.get(b)!.includes(a)) siblingOf.get(b)!.push(a)
        }
      }
    }
  }
  return { childrenOf, parentsOf, spousesOf, siblingOf }
}

// ── Proband context extraction ─────────────────────────────────────────────────
// lateralDepth: how many generations DOWN to follow from each ancestor
// (0 = off, 1 = aunts/uncles, 2 = aunts/uncles + cousins, ...)
function extractProbandContext(
  probandId: number,
  allPersons: PersonFull[],
  allRelations: Relation[],
  ancestorDepth: number,
  descendantDepth: number,
  lateralDepth: number,
): Set<number> {
  const allIds = new Set(allPersons.map(p => p.id))
  const maps = buildRelationMaps(allRelations, allIds)
  const visible = new Set<number>([probandId])

  // BFS up: collect direct ancestors, track by level for cousin-depth expansion
  const ancestorIds = new Set<number>()
  const ancestorsByLevel = new Map<number, Set<number>>()
  const ancQueue: Array<[number, number]> = [[probandId, 0]]
  while (ancQueue.length) {
    const [id, depth] = ancQueue.shift()!
    if (depth >= ancestorDepth) continue
    for (const pid of maps.parentsOf.get(id) ?? []) {
      if (!visible.has(pid)) {
        visible.add(pid)
        ancestorIds.add(pid)
        const lvl = depth + 1
        if (!ancestorsByLevel.has(lvl)) ancestorsByLevel.set(lvl, new Set())
        ancestorsByLevel.get(lvl)!.add(pid)
        ancQueue.push([pid, depth + 1])
      }
    }
  }

  // BFS down: direct descendants
  const descQueue: Array<[number, number]> = [[probandId, 0]]
  while (descQueue.length) {
    const [id, depth] = descQueue.shift()!
    if (depth >= descendantDepth) continue
    for (const cid of maps.childrenOf.get(id) ?? []) {
      if (!visible.has(cid)) { visible.add(cid); descQueue.push([cid, depth + 1]) }
    }
  }

  // Cousin-depth expansion (proband-centric semantics):
  //   j=1: proband's siblings (parents' other children)
  //   j=2: aunts/uncles (gen-1) + first cousins (gen-0)
  //   j=3: great-aunts/uncles (gen-2) + second cousins chain
  for (let j = 1; j <= Math.min(lateralDepth, ancestorDepth); j++) {
    for (const ancId of ancestorsByLevel.get(j) ?? []) {
      for (const child of maps.childrenOf.get(ancId) ?? []) {
        if (ancestorIds.has(child) || child === probandId) continue
        if (!allIds.has(child)) continue
        const q: [number, number][] = [[child, 0]]
        const seen = new Set<number>([child])
        while (q.length) {
          const [lid, d] = q.shift()!
          if (!visible.has(lid)) visible.add(lid)
          if (d < j - 1) {
            for (const cid of maps.childrenOf.get(lid) ?? []) {
              if (!seen.has(cid) && allIds.has(cid)) { seen.add(cid); q.push([cid, d + 1]) }
            }
          }
        }
      }
    }
  }

  // Include persons connected via direct sibling relations (fixpoint).
  // This handles siblings whose shared parent is not in the dataset.
  let sibChanged = true
  while (sibChanged) {
    sibChanged = false
    for (const r of allRelations) {
      if (r.type !== 'sibling') continue
      if (visible.has(r.person_a_id) && allIds.has(r.person_b_id) && !visible.has(r.person_b_id)) {
        visible.add(r.person_b_id); sibChanged = true
      }
      if (visible.has(r.person_b_id) && allIds.has(r.person_a_id) && !visible.has(r.person_a_id)) {
        visible.add(r.person_a_id); sibChanged = true
      }
    }
  }

  // Add spouses of all visible persons (fixpoint)
  let changed = true
  while (changed) {
    changed = false
    for (const id of [...visible]) {
      for (const sid of maps.spousesOf.get(id) ?? []) {
        if (!visible.has(sid)) { visible.add(sid); changed = true }
      }
    }
  }

  return visible
}

// ── Collapse helpers ───────────────────────────────────────────────────────────
function applyCollapse(
  visibleIds: Set<number>,
  collapsedIds: Set<number>,
  childrenOf: Map<number, number[]>,
): Set<number> {
  const hidden = new Set<number>()
  const queue = [...collapsedIds].filter(id => visibleIds.has(id))
  while (queue.length) {
    const id = queue.shift()!
    for (const cid of childrenOf.get(id) ?? []) {
      if (!hidden.has(cid)) { hidden.add(cid); queue.push(cid) }
    }
  }
  return new Set([...visibleIds].filter(id => !hidden.has(id)))
}

function countSubtreeDescendants(rootId: number, childrenOf: Map<number, number[]>): number {
  let count = 0
  const queue = [...(childrenOf.get(rootId) ?? [])]
  const seen = new Set<number>()
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id); count++
    for (const cid of childrenOf.get(id) ?? []) queue.push(cid)
  }
  return count
}

// ── Generation assignment ──────────────────────────────────────────────────────
function assignGenerations(
  probandId: number,
  visibleIds: Set<number>,
  maps: RelationMaps,
): Map<number, number> {
  const genMap = new Map<number, number>()
  genMap.set(probandId, 0)
  const queue: number[] = [probandId]
  const visited = new Set<number>([probandId])

  while (queue.length) {
    const id = queue.shift()!
    const g = genMap.get(id)!
    for (const pid of maps.parentsOf.get(id) ?? []) {
      if (!visibleIds.has(pid) || visited.has(pid)) continue
      visited.add(pid); genMap.set(pid, g - 1); queue.push(pid)
    }
    for (const cid of maps.childrenOf.get(id) ?? []) {
      if (!visibleIds.has(cid) || visited.has(cid)) continue
      visited.add(cid); genMap.set(cid, g + 1); queue.push(cid)
    }
    for (const sid of maps.spousesOf.get(id) ?? []) {
      if (!visibleIds.has(sid) || visited.has(sid)) continue
      visited.add(sid); genMap.set(sid, g); queue.push(sid)
    }
    for (const sid of maps.siblingOf.get(id) ?? []) {
      if (!visibleIds.has(sid) || visited.has(sid)) continue
      visited.add(sid); genMap.set(sid, g); queue.push(sid)
    }
  }

  for (const id of visibleIds) { if (!genMap.has(id)) genMap.set(id, 0) }

  let changed = true
  for (let i = 0; i < 10 && changed; i++) {
    changed = false
    for (const id of visibleIds) {
      for (const sid of maps.spousesOf.get(id) ?? []) {
        if (!visibleIds.has(sid)) continue
        const ga = genMap.get(id) ?? 0, gb = genMap.get(sid) ?? 0
        if (ga !== gb) {
          const g = Math.abs(ga) <= Math.abs(gb) ? ga : gb
          genMap.set(id, g); genMap.set(sid, g); changed = true
        }
      }
      for (const cid of maps.childrenOf.get(id) ?? []) {
        if (!visibleIds.has(cid)) continue
        const gp = genMap.get(id) ?? 0, gc = genMap.get(cid) ?? 0
        if (gc <= gp) { genMap.set(cid, gp + 1); changed = true }
      }
    }
  }

  return genMap
}

// ── Descendant layout (Reingold-Tilford, cluster-aware) ───────────────────────
// Each person + their same-generation spouses form one "cluster". Width is
// computed per cluster so spouses are never interleaved between siblings.
function layoutDescendants(
  probandId: number,
  visibleIds: Set<number>,
  maps: RelationMaps,
  genMap: Map<number, number>,
): Map<number, number> {
  const probandGen = genMap.get(probandId) ?? 0
  const isDesc = (id: number) => visibleIds.has(id) && (genMap.get(id) ?? 0) > probandGen

  // Assign each descendant to a cluster (person + their same-gen spouses).
  // The smallest ID in the group becomes the primary (cluster representative).
  const primaryOf = new Map<number, number>()
  const clusterSpouses = new Map<number, number[]>()

  const descendants = [...visibleIds]
    .filter(isDesc)
    .sort((a, b) => ((genMap.get(a) ?? 0) - (genMap.get(b) ?? 0)) || (a - b))

  for (const id of descendants) {
    if (primaryOf.has(id)) continue
    const myGen = genMap.get(id) ?? 0
    const spHere = (maps.spousesOf.get(id) ?? [])
      .filter(s => isDesc(s) && !primaryOf.has(s) && (genMap.get(s) ?? 0) === myGen)
      .sort((a, b) => a - b)
    primaryOf.set(id, id)
    clusterSpouses.set(id, spHere)
    for (const s of spHere) primaryOf.set(s, id)
  }

  const getChildClusters = (primary: number): number[] => {
    const members = [primary, ...(clusterSpouses.get(primary) ?? [])]
    const seen = new Set<number>()
    for (const m of members) {
      for (const cid of (maps.childrenOf.get(m) ?? []).filter(isDesc)) {
        seen.add(primaryOf.get(cid) ?? cid)
      }
    }
    return [...seen]
  }

  // Compute width bottom-up: cluster width = max(personal slots, children total)
  const widthMap = new Map<number, number>()
  const proc1 = new Set<number>()

  function computeWidth(primary: number): number {
    if (proc1.has(primary)) return widthMap.get(primary) ?? (NW + HG)
    proc1.add(primary)
    const step = NW + HG
    const personalW = (1 + (clusterSpouses.get(primary) ?? []).length) * step
    const childCs = getChildClusters(primary)
    if (!childCs.length) { widthMap.set(primary, personalW); return personalW }
    const childTotal = childCs.reduce((s, c) => s + computeWidth(c), 0)
    const w = Math.max(personalW, childTotal)
    widthMap.set(primary, w); return w
  }

  // Assign x positions top-down: couple centered above their children
  const xMap = new Map<number, number>()
  const proc2 = new Set<number>()

  function assignX(primary: number, left: number) {
    if (proc2.has(primary)) return
    proc2.add(primary)
    const w = widthMap.get(primary) ?? (NW + HG)
    const center = left + w / 2
    const spouses = clusterSpouses.get(primary) ?? []
    const n = 1 + spouses.length
    const step = NW + HG
    // Span of cards without trailing gap: n*step - HG
    const clusterLeft = center - (n * step - HG) / 2
    xMap.set(primary, clusterLeft + NW / 2)
    spouses.forEach((sid, i) => xMap.set(sid, clusterLeft + (i + 1) * step + NW / 2))
    // Place child clusters left-to-right
    let cursor = left
    for (const c of getChildClusters(primary)) {
      if (!proc2.has(c)) { assignX(c, cursor); cursor += widthMap.get(c) ?? step }
    }
  }

  // Root clusters: direct descendants of proband (and proband's gen-0 spouses)
  const rootClusters = new Set<number>()
  for (const cid of (maps.childrenOf.get(probandId) ?? []).filter(isDesc)) {
    rootClusters.add(primaryOf.get(cid) ?? cid)
  }
  for (const sid of (maps.spousesOf.get(probandId) ?? []).filter(
    s => visibleIds.has(s) && (genMap.get(s) ?? 0) === probandGen,
  )) {
    for (const cid of (maps.childrenOf.get(sid) ?? []).filter(isDesc)) {
      rootClusters.add(primaryOf.get(cid) ?? cid)
    }
  }

  for (const p of rootClusters) computeWidth(p)
  let cursor = 0
  for (const p of rootClusters) {
    if (!proc2.has(p)) { assignX(p, cursor); cursor += widthMap.get(p) ?? (NW + HG) }
  }

  return xMap
}

// ── Ancestor layout (Ahnentafel pedigree slots) ────────────────────────────────
function layoutAncestors(
  probandId: number,
  visibleIds: Set<number>,
  maps: RelationMaps,
  genMap: Map<number, number>,
  centerX: number,
): Map<number, number> {
  const xMap = new Map<number, number>()
  const probandGen = genMap.get(probandId) ?? 0
  const ahnIndex = new Map<number, number>([[probandId, 1]])
  const queue = [probandId]
  const visited = new Set<number>([probandId])

  while (queue.length) {
    const id = queue.shift()!
    const idx = ahnIndex.get(id)!
    const parents = (maps.parentsOf.get(id) ?? [])
      .filter(pid => visibleIds.has(pid) && (genMap.get(pid) ?? 0) < probandGen)
      .sort((a, b) => a - b)
    if (parents[0] && !visited.has(parents[0])) {
      visited.add(parents[0]); ahnIndex.set(parents[0], idx * 2); queue.push(parents[0])
    }
    if (parents[1] && !visited.has(parents[1])) {
      visited.add(parents[1]); ahnIndex.set(parents[1], idx * 2 + 1); queue.push(parents[1])
    }
  }

  const genGroups = new Map<number, Array<{ id: number; ahn: number }>>()
  for (const [id, ahn] of ahnIndex) {
    const g = genMap.get(id) ?? 0
    if (g >= probandGen) continue
    if (!genGroups.has(g)) genGroups.set(g, [])
    genGroups.get(g)!.push({ id, ahn })
  }

  for (const persons of genGroups.values()) {
    persons.sort((a, b) => a.ahn - b.ahn)
    const step = 2 * (NW + HG)
    persons.forEach(({ id }, i) =>
      xMap.set(id, centerX + (i - (persons.length - 1) / 2) * step)
    )
  }

  return xMap
}

// ── Gen-0 row layout ───────────────────────────────────────────────────────────
function layoutGen0Row(
  probandId: number,
  probandX: number,
  visibleIds: Set<number>,
  maps: RelationMaps,
  genMap: Map<number, number>,
): Map<number, number> {
  const xMap = new Map<number, number>()
  const probandGen = genMap.get(probandId) ?? 0
  const step = NW + HG

  const probandSpouses = (maps.spousesOf.get(probandId) ?? []).filter(
    sid => visibleIds.has(sid) && (genMap.get(sid) ?? 0) === probandGen,
  )
  const probandParents = maps.parentsOf.get(probandId) ?? []
  const siblings = new Set<number>()
  for (const pid of probandParents) {
    for (const sibId of maps.childrenOf.get(pid) ?? []) {
      if (sibId !== probandId && visibleIds.has(sibId) && (genMap.get(sibId) ?? 0) === probandGen) {
        siblings.add(sibId)
      }
    }
  }
  // Also include persons connected via direct sibling relations
  for (const sibId of maps.siblingOf.get(probandId) ?? []) {
    if (visibleIds.has(sibId) && (genMap.get(sibId) ?? 0) === probandGen) siblings.add(sibId)
  }

  xMap.set(probandId, probandX)
  probandSpouses.forEach((sid, i) => xMap.set(sid, probandX + (i + 1) * step))

  const nucleusLeft  = probandX - NW / 2
  const nucleusRight = probandX + probandSpouses.length * step + NW / 2

  const sibArr = [...siblings]
  const leftSibs  = sibArr.slice(0, Math.floor(sibArr.length / 2))
  const rightSibs = sibArr.slice(Math.floor(sibArr.length / 2))

  let leftCursor = nucleusLeft - HG
  for (let i = leftSibs.length - 1; i >= 0; i--) {
    const sid = leftSibs[i]
    const sibSpouses = (maps.spousesOf.get(sid) ?? []).filter(
      s => visibleIds.has(s) && (genMap.get(s) ?? 0) === probandGen && s !== probandId,
    )
    const totalW = (1 + sibSpouses.length) * step - HG
    const sibX = leftCursor - totalW + NW / 2
    xMap.set(sid, sibX)
    sibSpouses.forEach((s, j) => xMap.set(s, sibX + (j + 1) * step))
    leftCursor -= totalW + HG
  }

  let rightCursor = nucleusRight + HG
  for (const sid of rightSibs) {
    const sibSpouses = (maps.spousesOf.get(sid) ?? []).filter(
      s => visibleIds.has(s) && (genMap.get(s) ?? 0) === probandGen && s !== probandId,
    )
    xMap.set(sid, rightCursor + NW / 2)
    sibSpouses.forEach((s, j) => xMap.set(s, rightCursor + NW / 2 + (j + 1) * step))
    rightCursor += (1 + sibSpouses.length) * step + HG
  }

  return xMap
}

// ── Full proband layout ────────────────────────────────────────────────────────
function buildProbandLayout(
  probandId: number,
  allPersons: PersonFull[],
  allRelations: Relation[],
  ancestorDepth: number,
  descendantDepth: number,
  lateralDepth: number,
  collapsedIds: Set<number>,
): LayoutNode[] {
  const rawVisible = extractProbandContext(probandId, allPersons, allRelations, ancestorDepth, descendantDepth, lateralDepth)
  const rawMaps    = buildRelationMaps(allRelations, rawVisible)
  const visibleIds = applyCollapse(rawVisible, collapsedIds, rawMaps.childrenOf)
  const maps       = buildRelationMaps(allRelations, visibleIds)
  const genMap     = assignGenerations(probandId, visibleIds, maps)
  const probandGen = genMap.get(probandId) ?? 0

  // Descendant positions
  const descXMap = layoutDescendants(probandId, visibleIds, maps, genMap)

  // Proband's ideal X = center of its gen+1 children
  const spouses0 = (maps.spousesOf.get(probandId) ?? []).filter(
    sid => visibleIds.has(sid) && (genMap.get(sid) ?? 0) === probandGen,
  )
  const childrenGen1 = new Set((maps.childrenOf.get(probandId) ?? []).filter(
    cid => visibleIds.has(cid) && (genMap.get(cid) ?? 0) === probandGen + 1,
  ))
  for (const sid of spouses0) {
    for (const cid of maps.childrenOf.get(sid) ?? []) {
      if (visibleIds.has(cid) && (genMap.get(cid) ?? 0) === probandGen + 1) childrenGen1.add(cid)
    }
  }
  const probandIdealX = childrenGen1.size > 0
    ? [...childrenGen1].reduce((s, cid) => s + (descXMap.get(cid) ?? 0), 0) / childrenGen1.size
    : 0

  const ancXMap  = layoutAncestors(probandId, visibleIds, maps, genMap, probandIdealX)
  const gen0XMap = layoutGen0Row(probandId, probandIdealX, visibleIds, maps, genMap)

  // Merge: gen0 overrides others for gen-0 positions
  const combinedX = new Map<number, number>()
  for (const [id, x] of descXMap) combinedX.set(id, x)
  for (const [id, x] of ancXMap)  combinedX.set(id, x)
  for (const [id, x] of gen0XMap) combinedX.set(id, x)

  // Unified fallback — three anchors, loop to convergence.
  // KEY INVARIANT: when any person is placed via sibling or parent anchor,
  // their unpositioned same-gen spouses are placed IMMEDIATELY in the same step
  // so no third party can be inserted between a couple.
  let passN = true
  while (passN) {
    passN = false
    for (const id of visibleIds) {
      if (combinedX.has(id)) continue
      const myGen = genMap.get(id) ?? 0

      const genLeftmost  = () => { let v = Infinity;  for (const [oid, ox] of combinedX) { if ((genMap.get(oid) ?? 0) === myGen) v = Math.min(v, ox) }; return v <  Infinity ? v : 0 }
      const genRightmost = () => { let v = -Infinity; for (const [oid, ox] of combinedX) { if ((genMap.get(oid) ?? 0) === myGen) v = Math.max(v, ox) }; return v > -Infinity ? v : 0 }

      // Place `id` at `pos`, then immediately place any unpositioned same-gen
      // spouses adjacent — prevents any person from slipping between a couple.
      const placeWithSpouses = (pos: number) => {
        combinedX.set(id, pos)
        passN = true
        const dir = pos <= 0 ? -1 : 1
        let cursor = pos + dir * (NW + HG)
        for (const spId of maps.spousesOf.get(id) ?? []) {
          if (combinedX.has(spId) || (genMap.get(spId) ?? 0) !== myGen) continue
          const occ = new Set([...combinedX.values()])
          while (occ.has(cursor)) cursor += dir * (NW + HG)
          combinedX.set(spId, cursor)
          cursor += dir * (NW + HG)
        }
      }

      // A: spouse anchor — place adjacent to positioned partner
      let placed = false
      for (const sid of maps.spousesOf.get(id) ?? []) {
        if (!combinedX.has(sid) || (genMap.get(sid) ?? 0) !== myGen) continue
        const partnerX = combinedX.get(sid)!
        const dir = partnerX <= 0 ? -1 : 1
        let targetX = partnerX + dir * (NW + HG)
        const occ = new Set([...combinedX.values()])
        while (occ.has(targetX)) targetX += dir * (NW + HG)
        combinedX.set(id, targetX)
        placed = true; passN = true; break
      }
      if (placed) continue

      // B: sibling anchor — direction from actual siblings only
      const myParents = maps.parentsOf.get(id) ?? []
      const sibXs: number[] = []
      for (const pid of myParents) {
        for (const sibId of maps.childrenOf.get(pid) ?? []) {
          if (sibId === id || !combinedX.has(sibId) || (genMap.get(sibId) ?? 0) !== myGen) continue
          sibXs.push(combinedX.get(sibId)!)
        }
      }
      for (const sibId of maps.siblingOf.get(id) ?? []) {
        if (!combinedX.has(sibId) || (genMap.get(sibId) ?? 0) !== myGen) continue
        sibXs.push(combinedX.get(sibId)!)
      }
      if (sibXs.length > 0) {
        const sibCenter = sibXs.reduce((a, b) => a + b, 0) / sibXs.length
        const dir = sibCenter <= 0 ? -1 : 1
        let targetX = sibCenter + dir * (NW + HG)
        const occ = new Set([...combinedX.values()])
        while (occ.has(targetX)) targetX += dir * (NW + HG)
        placeWithSpouses(targetX)
        continue
      }

      // C: parent anchor — place directly below parent, not at generation extreme.
      // Children of lateral relatives stay visually under their own parent cluster.
      const posParentXs = myParents.filter(pid => combinedX.has(pid)).map(pid => combinedX.get(pid)!)
      if (posParentXs.length > 0) {
        const pc = posParentXs.reduce((a, b) => a + b, 0) / posParentXs.length
        const dir = pc <= 0 ? -1 : 1
        let targetX = pc
        const occ = new Set([...combinedX.values()])
        while (occ.has(targetX)) targetX += dir * (NW + HG)
        placeWithSpouses(targetX)
      }
    }
  }
  // Final fallback: truly orphaned persons with no anchor — place rightmost in gen
  for (const id of visibleIds) {
    if (combinedX.has(id)) continue
    const g = genMap.get(id) ?? 0
    let rightmost = -Infinity
    for (const [oid, ox] of combinedX) { if ((genMap.get(oid) ?? 0) === g) rightmost = Math.max(rightmost, ox) }
    combinedX.set(id, rightmost > -Infinity ? rightmost + NW + HG : 0)
  }

  // Normalize: proband at x = 0
  const probandFinalX = combinedX.get(probandId) ?? 0
  for (const [id, x] of combinedX) combinedX.set(id, x - probandFinalX)

  const byId = new Map(allPersons.map(p => [p.id, p]))
  const nodes: LayoutNode[] = []
  for (const id of visibleIds) {
    const person = byId.get(id)
    if (!person) continue
    const gen = genMap.get(id) ?? 0
    nodes.push({ id, person, gen, x: combinedX.get(id) ?? 0, y: gen * (NH + VG) })
  }
  return nodes
}

// ── Edge drawing ───────────────────────────────────────────────────────────────
function buildEdges(nodes: LayoutNode[], relations: Relation[], minX: number, minY: number): EdgeSpec[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const edges: EdgeSpec[] = []

  // Spouse lines
  const drawnSpouses = new Set<string>()
  for (const r of relations) {
    if (r.type !== 'spouse') continue
    const key = [r.person_a_id, r.person_b_id].sort().join('-')
    if (drawnSpouses.has(key)) continue
    drawnSpouses.add(key)
    const an = nodeMap.get(r.person_a_id), bn = nodeMap.get(r.person_b_id)
    if (!an || !bn) continue
    const leftN  = an.x <= bn.x ? an : bn
    const rightN = an.x <= bn.x ? bn : an
    const x1 = leftN.x  + NW / 2 - minX
    const x2 = rightN.x - NW / 2 - minX
    const y  = (leftN.y + rightN.y) / 2 - minY
    if (x1 < x2) edges.push({ key: `sp-${key}`, type: 'spouse', x1, y1: y, x2, y2: y })
  }

  // Parent-child edges grouped by couple
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

  const coupleMap = new Map<string, { parentIds: number[]; childIds: number[] }>()
  for (const [childId, parents] of childParents) {
    const key = [...parents].sort((a, b) => a - b).join(',')
    if (!coupleMap.has(key)) coupleMap.set(key, { parentIds: [...parents].sort((a, b) => a - b), childIds: [] })
    coupleMap.get(key)!.childIds.push(childId)
  }

  // Phase 1: collect geometry for all groups
  type GroupGeom = {
    parentIds: number[]; childIds: number[]
    parentNodes: LayoutNode[]; childNodes: LayoutNode[]
    junctionX: number; junctionY: number
    cardBottomY: number; firstChildY: number
    parentKey: string
  }
  const groups: GroupGeom[] = []

  for (const { parentIds, childIds } of coupleMap.values()) {
    const parentNodes = parentIds.map(id => nodeMap.get(id)).filter(Boolean) as LayoutNode[]
    const childNodes  = childIds.map(id => nodeMap.get(id)).filter(Boolean) as LayoutNode[]
    if (!parentNodes.length || !childNodes.length) continue

    let junctionX: number, junctionY: number
    if (parentNodes.length === 1) {
      const pn = parentNodes[0]
      junctionX = pn.x - minX
      junctionY = pn.y + NH / 2 - minY
    } else {
      const sorted = [...parentNodes].sort((a, b) => a.x - b.x)
      const leftP = sorted[0], rightP = sorted[sorted.length - 1]
      const spouseKey = [leftP.id, rightP.id].sort().join('-')
      if (spouseSet.has(spouseKey)) {
        junctionX = (leftP.x + NW / 2 - minX + (rightP.x - NW / 2 - minX)) / 2
        junctionY = parentNodes[0].y - minY
      } else {
        junctionX = parentNodes.reduce((s, p) => s + p.x, 0) / parentNodes.length - minX
        junctionY = Math.max(...parentNodes.map(p => p.y)) + NH / 2 - minY
      }
    }

    groups.push({
      parentIds, childIds, parentNodes, childNodes,
      junctionX, junctionY,
      cardBottomY: Math.max(...parentNodes.map(p => p.y)) + NH / 2 - minY,
      firstChildY: Math.min(...childNodes.map(n => n.y - NH / 2 - minY)),
      parentKey: parentIds.join(','),
    })
  }

  // Phase 2: stagger barY within each generation tier so bars don't overlap visually
  const tierMap = new Map<string, GroupGeom[]>()
  for (const g of groups) {
    const tierKey = `${Math.round(g.cardBottomY)}-${Math.round(g.firstChildY)}`
    if (!tierMap.has(tierKey)) tierMap.set(tierKey, [])
    tierMap.get(tierKey)!.push(g)
  }

  for (const tierGroups of tierMap.values()) {
    tierGroups.sort((a, b) => a.junctionX - b.junctionX)
    const count = tierGroups.length
    tierGroups.forEach((g, i) => {
      const t = count === 1 ? 0.5 : (i + 1) / (count + 1)
      const barY = g.cardBottomY + (g.firstChildY - g.cardBottomY) * t

      if (g.childNodes.length === 1) {
        const cn = g.childNodes[0]
        edges.push({ key: `cs-${g.parentKey}-${cn.id}`, type: 'child-single',
          x1: g.junctionX, y1: g.junctionY, x2: cn.x - minX, y2: cn.y - NH / 2 - minY })
      } else {
        edges.push({ key: `stem-${g.parentKey}`, type: 'couple-stem',
          x1: g.junctionX, y1: g.junctionY, x2: g.junctionX, y2: barY })
        const minCX = Math.min(...g.childNodes.map(n => n.x - minX), g.junctionX)
        const maxCX = Math.max(...g.childNodes.map(n => n.x - minX), g.junctionX)
        edges.push({ key: `bar-${g.parentKey}`, type: 'couple-bar', x1: minCX, y1: barY, x2: maxCX, y2: barY })
        for (const cn of g.childNodes) {
          edges.push({ key: `drop-${g.parentKey}-${cn.id}`, type: 'child-drop',
            x1: cn.x - minX, y1: barY, x2: cn.x - minX, y2: cn.y - NH / 2 - minY })
        }
      }
    })
  }

  return edges
}

// ── PersonCard ─────────────────────────────────────────────────────────────────
function PersonCard({ person, selected, isProband }: {
  person: PersonFull
  selected: boolean
  isProband?: boolean
}) {
  const [imgErr, setImgErr] = useState(false)
  const span = person.birth_year
    ? person.death_year ? `${person.birth_year}–${person.death_year}` : `* ${person.birth_year}`
    : null
  const initials = (person.name ?? '?').trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'

  return (
    <div className={[
      'absolute inset-0 rounded-xl flex items-center gap-2.5 px-2.5 transition-all overflow-hidden',
      selected
        ? 'bg-brand-700 border-2 border-brand-400 shadow-lg shadow-brand-900/60'
        : 'bg-zinc-800/90 border border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800',
    ].join(' ')}>
      {isProband && (
        <div className="absolute top-1 right-1 text-[10px] text-amber-400 leading-none" title="Focus person">★</div>
      )}
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
          {person.name ?? '(unnamed)'}
        </div>
        {span && <div className={`text-[10px] leading-snug ${selected ? 'text-brand-200' : 'text-zinc-500'}`}>{span}</div>}
        {person.face_count > 0 && (
          <div className={`text-[9px] leading-snug ${selected ? 'text-brand-300' : 'text-zinc-600'}`}>{person.face_count} photos</div>
        )}
      </div>
    </div>
  )
}

// ── TreeView ───────────────────────────────────────────────────────────────────
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
  const [pan,  setPan]  = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const dragOrigin = useRef<{ mx: number; my: number; px: number; py: number } | null>(null)
  const isDragging = useRef(false)

  const [probandId,       setProbandId]       = useState<number | null>(null)
  const [ancestorDepth,   setAncestorDepth]   = useState(3)
  const [descendantDepth, setDescendantDepth] = useState(3)
  const [lateralDepth,    setLateralDepth]    = useState(1)
  const [collapsedIds,    setCollapsedIds]    = useState<Set<number>>(new Set())

  // Auto-set proband when selection changes
  useEffect(() => {
    if (selectedId !== null) setProbandId(selectedId)
  }, [selectedId])

  // Reset collapse when proband changes
  useEffect(() => { setCollapsedIds(new Set()) }, [probandId])

  // Full children map for collapse count (uses all relations, not just visible)
  const fullChildrenOf = useMemo(() => {
    const m = new Map<number, number[]>()
    for (const r of relations) {
      if (r.type !== 'parent') continue
      if (!m.has(r.person_a_id)) m.set(r.person_a_id, [])
      m.get(r.person_a_id)!.push(r.person_b_id)
    }
    return m
  }, [relations])

  const effectiveProbandId = probandId ?? persons[0]?.id ?? null

  // Direct ancestor set — collapse is forbidden on these to prevent tree collapse
  const directAncestorIds = useMemo(() => {
    if (!effectiveProbandId) return new Set<number>()
    const ids = new Set<number>()
    const queue = [effectiveProbandId]
    while (queue.length) {
      const id = queue.shift()!
      for (const r of relations) {
        if (r.type === 'parent' && r.person_b_id === id && !ids.has(r.person_a_id)) {
          ids.add(r.person_a_id)
          queue.push(r.person_a_id)
        }
      }
    }
    return ids
  }, [effectiveProbandId, relations])

  const nodes = useMemo(() => {
    if (!effectiveProbandId || !persons.length) return []
    return buildProbandLayout(
      effectiveProbandId, persons, relations,
      ancestorDepth, descendantDepth, lateralDepth, collapsedIds,
    )
  }, [effectiveProbandId, persons, relations, ancestorDepth, descendantDepth, lateralDepth, collapsedIds])

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes])

  const layoutRelations = useMemo(() => {
    const vis = new Set(nodes.map(n => n.id))
    return relations.filter(r => vis.has(r.person_a_id) && vis.has(r.person_b_id))
  }, [nodes, relations])

  const bounds = useMemo(() => {
    if (!nodes.length) return { minX: 0, minY: 0, canvasW: 800, canvasH: 500 }
    const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y)
    const minX = Math.min(...xs) - NW / 2 - PAD
    const minY = Math.min(...ys) - NH / 2 - PAD
    return {
      minX, minY,
      canvasW: Math.max(...xs) + NW / 2 + PAD - minX,
      canvasH: Math.max(...ys) + NH / 2 + PAD - minY,
    }
  }, [nodes])

  const edges = useMemo(
    () => buildEdges(nodes, layoutRelations, bounds.minX, bounds.minY),
    [nodes, layoutRelations, bounds],
  )

  function resetView() {
    if (!containerRef.current || !nodes.length) return
    const { width, height } = containerRef.current.getBoundingClientRect()
    const fitZoom = Math.min((width - 40) / bounds.canvasW, (height - 40) / bounds.canvasH, 1.2) * 0.9
    setZoom(Math.max(0.15, fitZoom))
    setPan({ x: 0, y: 0 })
  }

  useEffect(() => { resetView() }, []) // eslint-disable-line

  useEffect(() => {
    if (!selectedId) return
    const node = nodeMap.get(selectedId)
    if (!node) return
    const { minX, minY, canvasW, canvasH } = bounds
    setPan({ x: -(node.x - minX - canvasW / 2), y: -(node.y - minY - canvasH / 2) })
  }, [selectedId]) // eslint-disable-line

  if (!nodes.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <div className="text-4xl opacity-20">🌳</div>
        <p className="text-zinc-500 text-sm">No persons yet</p>
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
        setPan({ x: dragOrigin.current.px + e.clientX - dragOrigin.current.mx, y: dragOrigin.current.py + e.clientY - dragOrigin.current.my })
      }}
      onMouseUp={() => { dragOrigin.current = null; isDragging.current = false }}
      onMouseLeave={() => { dragOrigin.current = null; isDragging.current = false }}
      onWheel={e => { e.preventDefault(); setZoom(z => clamp(z * (e.deltaY > 0 ? 0.9 : 1.1), 0.15, 3)) }}
    >
      {!panelOpen && (
        <>
          {/* Bottom-right: zoom + depth controls */}
          <div className="absolute bottom-3 right-3 z-10 flex gap-1.5 flex-wrap justify-end">
            <button onClick={() => setZoom(z => clamp(z * 1.2, 0.15, 3))}
              className="w-7 h-7 rounded-lg bg-zinc-800/90 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 flex items-center justify-center text-sm font-bold">+</button>
            <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}
              className="h-7 px-2 rounded-lg bg-zinc-800/90 border border-zinc-700 text-zinc-400 hover:bg-zinc-700 text-xs tabular-nums">{Math.round(zoom * 100)}%</button>
            <button onClick={() => setZoom(z => clamp(z * 0.8, 0.15, 3))}
              className="w-7 h-7 rounded-lg bg-zinc-800/90 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 flex items-center justify-center text-sm font-bold">−</button>
            <button onClick={resetView}
              className="h-7 px-2.5 rounded-lg bg-zinc-800/90 border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 text-xs">Reset</button>
            <div className="flex items-center gap-1 ml-1 bg-zinc-800/90 border border-zinc-700 rounded-lg px-2 h-7">
              <span className="text-[10px] text-zinc-500">Anc</span>
              <button onClick={() => setAncestorDepth(d => Math.max(1, d - 1))}
                className="text-zinc-400 hover:text-zinc-200 text-xs px-0.5">◄</button>
              <span className="text-xs text-zinc-300 tabular-nums w-3 text-center">{ancestorDepth}</span>
              <button onClick={() => setAncestorDepth(d => Math.min(6, d + 1))}
                className="text-zinc-400 hover:text-zinc-200 text-xs px-0.5">►</button>
            </div>
            <div className="flex items-center gap-1 bg-zinc-800/90 border border-zinc-700 rounded-lg px-2 h-7">
              <span className="text-[10px] text-zinc-500">Desc</span>
              <button onClick={() => setDescendantDepth(d => Math.max(1, d - 1))}
                className="text-zinc-400 hover:text-zinc-200 text-xs px-0.5">◄</button>
              <span className="text-xs text-zinc-300 tabular-nums w-3 text-center">{descendantDepth}</span>
              <button onClick={() => setDescendantDepth(d => Math.min(6, d + 1))}
                className="text-zinc-400 hover:text-zinc-200 text-xs px-0.5">►</button>
            </div>
            <div className="flex items-center gap-1 bg-zinc-800/90 border border-zinc-700 rounded-lg px-2 h-7" title="0=direct line only, 1=siblings, 2=first cousins, 3=second cousins">
              <span className="text-[10px] text-zinc-500">Cousins</span>
              <button onClick={() => setLateralDepth(d => Math.max(0, d - 1))}
                className="text-zinc-400 hover:text-zinc-200 text-xs px-0.5">◄</button>
              <span className="text-xs text-zinc-300 tabular-nums w-3 text-center">{lateralDepth}</span>
              <button onClick={() => setLateralDepth(d => Math.min(3, d + 1))}
                className="text-zinc-400 hover:text-zinc-200 text-xs px-0.5">►</button>
            </div>
          </div>
          {/* Bottom-left: legend */}
          <div className="absolute bottom-3 left-3 z-10 flex items-center gap-4 text-[10px] text-zinc-600">
            <span className="flex items-center gap-1.5">
              <svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="#52525b" strokeWidth="1.5"/></svg>
              parent–child
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="#7c3aed" strokeWidth="2" strokeDasharray="5 3"/></svg>
              spouse
            </span>
            <span>Drag · scroll · Shift+click=fókusz</span>
          </div>
        </>
      )}

      <div style={{
        position: 'absolute', left: '50%', top: '50%',
        width: canvasW, height: canvasH,
        transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
        transformOrigin: 'center',
      }}>
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
          const isCollapsed = collapsedIds.has(node.id)
          const visibleChildCount = (fullChildrenOf.get(node.id) ?? []).filter(cid => nodeMap.has(cid)).length
          const hasCollapsibleChildren = visibleChildCount > 0
          const hiddenCount = isCollapsed ? countSubtreeDescendants(node.id, fullChildrenOf) : 0

          return (
            <div key={node.id} data-node style={{
              position: 'absolute',
              left: node.x - minX - NW / 2,
              top:  node.y - minY - NH / 2,
              width: NW, height: NH,
            }} onClick={e => {
              if (isDragging.current) return
              if (e.shiftKey || e.ctrlKey) {
                // Shift/Ctrl+click: set as focus without opening the detail panel
                setProbandId(node.id)
              } else {
                onSelect(node.id)
              }
            }}>
              <PersonCard
                person={node.person}
                selected={node.id === selectedId}
                isProband={node.id === effectiveProbandId}
              />

              {/* Collapse button: visible below nodes that have visible children, but not on direct ancestors */}
              {hasCollapsibleChildren && !isCollapsed && !directAncestorIds.has(node.id) && (
                <button
                  onClick={e => {
                    e.stopPropagation()
                    setCollapsedIds(prev => new Set([...prev, node.id]))
                  }}
                  className="absolute left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-zinc-800 border border-zinc-600 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 text-xs flex items-center justify-center transition-colors cursor-pointer"
                  style={{ top: NH + 4, zIndex: 20 }}
                  title="Collapse subtree"
                >▼</button>
              )}

              {/* Expand button: visible on collapsed nodes */}
              {isCollapsed && (
                <button
                  onClick={e => {
                    e.stopPropagation()
                    setCollapsedIds(prev => { const s = new Set(prev); s.delete(node.id); return s })
                  }}
                  className="absolute left-1/2 -translate-x-1/2 h-5 min-w-[20px] px-1.5 flex items-center justify-center rounded-full font-bold text-[9px] bg-brand-800 border border-brand-500 text-brand-300 hover:bg-brand-700 transition-colors cursor-pointer select-none"
                  style={{ top: NH + 4, zIndex: 20 }}
                  title={`Expand — ${hiddenCount} persons hidden`}
                >▶ +{hiddenCount}</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

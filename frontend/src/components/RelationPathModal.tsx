import { useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { PersonFull, Relation } from '../types'

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

function edgeColor(blood: boolean) {
  return blood ? 'bg-zinc-600' : 'bg-violet-500/40'
}

// ── Person mini-card ───────────────────────────────────────────────────────────

function MiniCard({ person, highlight }: { person: PersonFull; highlight?: boolean }) {
  const [err, setErr] = useState(false)
  const initials = (person.name ?? '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const by = person.birth_date ? person.birth_date.slice(0, 4) : person.birth_year != null ? String(person.birth_year) : null
  const dy = person.death_date ? person.death_date.slice(0, 4) : person.death_year != null ? String(person.death_year) : null
  const years = [by, dy].filter(Boolean).join('–')

  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0" style={{ width: CARD_W }}>
      <div className={[
        'w-10 h-10 rounded-full overflow-hidden flex items-center justify-center',
        highlight ? 'ring-2 ring-violet-500/60 bg-zinc-700' : 'bg-zinc-800 border border-zinc-700',
      ].join(' ')}>
        {person.thumbnail_face_id && !err
          ? <img src={api.faceThumbnailUrl(person.thumbnail_face_id, 80)} className="w-full h-full object-cover" onError={() => setErr(true)} />
          : <span className="text-[10px] font-semibold text-zinc-400">{initials}</span>
        }
      </div>
      <div className="text-center w-full px-1">
        <p className="text-[10px] font-semibold text-zinc-100 leading-tight line-clamp-2">
          {person.name ?? '(névtelen)'}
        </p>
        {years && <p className="text-[9px] text-zinc-500 mt-0.5 tabular-nums">{years}</p>}
      </div>
    </div>
  )
}

// ── Horizontal edge connector ──────────────────────────────────────────────────

function EdgeConnector({ label, blood }: { label: EdgeLabel; blood: boolean }) {
  return (
    <div className="flex flex-col items-center shrink-0" style={{ width: EDGE_W }}>
      <div
        className={['w-full h-px', blood ? 'bg-zinc-600' : ''].join(' ')}
        style={blood ? {} : { borderTop: '1px dashed #7c3aed60' }}
      />
      <span className={[
        'mt-1 px-1 py-0.5 rounded text-[8px] font-medium tracking-wide uppercase whitespace-nowrap',
        blood
          ? 'text-zinc-500 bg-zinc-800/80'
          : 'text-violet-400 bg-violet-950/60 border border-violet-800/40',
      ].join(' ')}>
        {LABEL_TEXT[label]}
      </span>
    </div>
  )
}

// ── Turn connector (vertical, between snake rows) ──────────────────────────────

function TurnConnector({ edge, side }: { edge: PathEdge; side: 'right' | 'left' }) {
  return (
    <div
      className={`flex py-0.5 ${side === 'right' ? 'justify-end' : 'justify-start'}`}
      style={{ width: ROW_W }}
    >
      <div className="flex flex-col items-center" style={{ width: CARD_W }}>
        <div className={`w-px h-3 ${edgeColor(edge.blood)}`} />
        <span className={[
          'px-1 py-0.5 rounded text-[8px] font-medium tracking-wide uppercase whitespace-nowrap',
          edge.blood
            ? 'text-zinc-500 bg-zinc-800/80'
            : 'text-violet-400 bg-violet-950/60 border border-violet-800/40',
        ].join(' ')}>
          {LABEL_TEXT[edge.label]}
        </span>
        <div className={`w-px h-3 ${edgeColor(edge.blood)}`} />
      </div>
    </div>
  )
}

// ── Main modal ─────────────────────────────────────────────────────────────────

interface Props {
  personA: PersonFull
  personB: PersonFull
  persons: PersonFull[]
  relations: Relation[]
  onClose: () => void
}

export default function RelationPathModal({ personA, personB, persons, relations, onClose }: Props) {
  const byId = new Map(persons.map(p => [p.id, p]))

  const path = findPath(personA.id, personB.id, relations)
  const hasPath = path !== null

  // Build display chain
  const chainPersons: PersonFull[] = [personA]
  if (path && path.length > 0) {
    for (const edge of path) {
      const p = byId.get(edge.toId)
      if (p) chainPersons.push(p)
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

  const isBloodOnly = path !== null && path.every(e => e.blood)
  const steps = path?.length ?? 0

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
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-1">Relationship</p>
            <h2 className="text-sm font-semibold text-zinc-100">
              {personA.name ?? '(névtelen)'}
              <span className="text-zinc-500 font-normal mx-2">and</span>
              {personB.name ?? '(névtelen)'}
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
                      const isFirst = ri === 0 && i === 0
                      const isLast  = ri === rows.length - 1 && i === row.persons.length - 1
                      const nodes: ReactNode[] = [
                        <MiniCard key={`c-${ri}-${i}`} person={p} highlight={isFirst || isLast} />,
                      ]
                      if (i < row.persons.length - 1) {
                        nodes.push(
                          <EdgeConnector key={`e-${ri}-${i}`} label={row.edges[i].label} blood={row.edges[i].blood} />
                        )
                      }
                      return nodes
                    })}
                  </div>

                  {row.turnEdge && (
                    <TurnConnector
                      edge={row.turnEdge}
                      side={row.isRTL ? 'left' : 'right'}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {hasPath && steps > 0 && (
          <div className="flex items-center gap-4 px-5 py-3 bg-zinc-950/50 border-t border-zinc-800">
            <div className={[
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium',
              isBloodOnly
                ? 'bg-rose-950/60 text-rose-300 border border-rose-900/50'
                : 'bg-violet-950/60 text-violet-300 border border-violet-900/50',
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
            <span className="text-[11px] text-zinc-600">
              {steps} {steps === 1 ? 'step' : 'steps'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

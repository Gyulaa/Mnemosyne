import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { ConnectionsData, GraphEdge, GraphNode } from '../types'

// ── Simulation types ───────────────────────────────────────────────────────────

interface SimNode extends GraphNode {
  x: number; y: number
  vx: number; vy: number
  fx: number; fy: number
  pinned: boolean
}

// ── Visual helpers ─────────────────────────────────────────────────────────────

const PALETTE = [
  '#60a5fa', '#34d399', '#f472b6', '#fb923c', '#a78bfa',
  '#38bdf8', '#4ade80', '#f87171', '#facc15', '#e879f9',
  '#2dd4bf', '#fb7185',
]
const nodeColor = (id: number) => PALETTE[id % PALETTE.length]

function nodeRadius(n: GraphNode, degree: number): number {
  return Math.min(26, 12 + Math.sqrt(n.photo_count) * 0.55 + degree * 1.6)
}

// ── Force simulation tick ──────────────────────────────────────────────────────

function simTick(
  nodes: SimNode[],
  edges: GraphEdge[],
  nodeMap: Map<number, SimNode>,
  W: number,
  H: number,
) {
  const REP = 9000
  const SPR = 0.035
  const GRA = 0.018
  const DAMP = 0.72

  for (const n of nodes) { n.fx = 0; n.fy = 0 }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j]
      const dx = b.x - a.x, dy = b.y - a.y
      const d2 = Math.max(1, dx * dx + dy * dy)
      const d = Math.sqrt(d2)
      const f = REP / d2
      a.fx -= f * dx / d; a.fy -= f * dy / d
      b.fx += f * dx / d; b.fy += f * dy / d
    }
  }

  for (const e of edges) {
    const a = nodeMap.get(e.source), b = nodeMap.get(e.target)
    if (!a || !b) continue
    const dx = b.x - a.x, dy = b.y - a.y
    const d = Math.sqrt(dx * dx + dy * dy) || 0.1
    const ideal = Math.max(110, 260 - Math.log(e.weight + 1) * 24)
    const f = SPR * (d - ideal)
    a.fx += f * dx / d; a.fy += f * dy / d
    b.fx -= f * dx / d; b.fy -= f * dy / d
  }

  const cx = W / 2, cy = H / 2
  for (const n of nodes) {
    n.fx += GRA * (cx - n.x)
    n.fy += GRA * (cy - n.y)
  }

  for (const n of nodes) {
    if (n.pinned) continue
    n.vx = (n.vx + n.fx) * DAMP
    n.vy = (n.vy + n.fy) * DAMP
    n.x += n.vx
    n.y += n.vy
  }
}

// ── ForceGraph ─────────────────────────────────────────────────────────────────

function ForceGraph({
  nodes,
  edges,
  width,
  height,
  onEdgeClick,
}: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  width: number
  height: number
  onEdgeClick?: (personIds: number[]) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const nodesRef = useRef<SimNode[]>([])
  const [display, setDisplay] = useState<SimNode[]>([])
  const [dragId, setDragId] = useState<number | null>(null)
  const [hoveredNode, setHoveredNode] = useState<number | null>(null)
  const [edgeTip, setEdgeTip] = useState<{
    x: number; y: number
    sourceId: number; targetId: number; weight: number
  } | null>(null)
  const rafRef = useRef<number | null>(null)

  // Pan/zoom state — use refs so wheel handler (non-React event listener) always sees fresh values
  const panRef = useRef({ x: 0, y: 0 })
  const zoomRef = useRef(1)
  const [viewTransform, setViewTransform] = useState({ x: 0, y: 0, scale: 1 })
  const panDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  function applyTransform(x: number, y: number, scale: number) {
    panRef.current = { x, y }
    zoomRef.current = scale
    setViewTransform({ x, y, scale })
  }

  const nameMap = useMemo(() => new Map(nodes.map(n => [n.id, n.name])), [nodes])

  // Degree (number of connections per node)
  const degreeMap = useMemo(() => {
    const deg = new Map<number, number>()
    for (const e of edges) {
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1)
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1)
    }
    return deg
  }, [edges])

  // Non-passive wheel listener for zoom
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = svg!.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = e.deltaY > 0 ? 0.88 : 1.14
      const newScale = Math.min(5, Math.max(0.15, zoomRef.current * factor))
      const newX = mx - (mx - panRef.current.x) * (newScale / zoomRef.current)
      const newY = my - (my - panRef.current.y) * (newScale / zoomRef.current)
      applyTransform(newX, newY, newScale)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  // Initialize positions and run simulation
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (!nodes.length || !width || !height) { setDisplay([]); return }

    // Reset view on new data
    applyTransform(0, 0, 1)

    const R = Math.min(width, height) * 0.3
    const cx = width / 2, cy = height / 2
    nodesRef.current = nodes.map((n, i) => ({
      ...n,
      x: cx + R * Math.cos((2 * Math.PI * i) / nodes.length) + (Math.random() - 0.5) * 20,
      y: cy + R * Math.sin((2 * Math.PI * i) / nodes.length) + (Math.random() - 0.5) * 20,
      vx: 0, vy: 0, fx: 0, fy: 0, pinned: false,
    }))
    const nodeMap = new Map(nodesRef.current.map(n => [n.id, n]))

    let frame = 0
    function animate() {
      simTick(nodesRef.current, edges, nodeMap, width, height)
      frame++
      if (frame % 5 === 0 || frame <= 10) {
        setDisplay(nodesRef.current.map(n => ({ ...n })))
      }
      if (frame < 300) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        setDisplay(nodesRef.current.map(n => ({ ...n })))
      }
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [nodes.length, edges.length, width, height])

  // Convert screen → content coordinates (undoes pan/zoom)
  function screenToContent(clientX: number, clientY: number) {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: (clientX - rect.left - panRef.current.x) / zoomRef.current,
      y: (clientY - rect.top - panRef.current.y) / zoomRef.current,
    }
  }

  function onNodeDown(e: React.PointerEvent, id: number) {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setDragId(id)
    const node = nodesRef.current.find(n => n.id === id)
    if (node) { node.pinned = true; node.vx = 0; node.vy = 0 }
  }

  function onSVGDown(e: React.PointerEvent) {
    // Only start pan if not clicking a node
    if ((e.target as Element).closest('[data-node]')) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    panDragRef.current = {
      startX: e.clientX, startY: e.clientY,
      origX: panRef.current.x, origY: panRef.current.y,
    }
  }

  function onSVGMove(e: React.PointerEvent) {
    if (dragId != null && svgRef.current) {
      const pt = screenToContent(e.clientX, e.clientY)
      const node = nodesRef.current.find(n => n.id === dragId)
      if (!node) return
      node.x = pt.x; node.y = pt.y
      node.vx = 0; node.vy = 0
      setDisplay(nodesRef.current.map(n => ({ ...n })))
    } else if (panDragRef.current) {
      const dx = e.clientX - panDragRef.current.startX
      const dy = e.clientY - panDragRef.current.startY
      applyTransform(panDragRef.current.origX + dx, panDragRef.current.origY + dy, zoomRef.current)
    }
  }

  function onSVGUp() {
    if (dragId != null) {
      const node = nodesRef.current.find(n => n.id === dragId)
      if (node) node.pinned = false
      setDragId(null)
    }
    panDragRef.current = null
  }

  function resetView() {
    applyTransform(0, 0, 1)
  }

  const displayMap = new Map(display.map(n => [n.id, n]))
  const connectedTo = hoveredNode != null
    ? new Set<number>(edges.flatMap(e =>
        e.source === hoveredNode ? [e.target] :
        e.target === hoveredNode ? [e.source] : []
      ))
    : null

  const { x: panX, y: panY, scale } = viewTransform

  return (
    <div className="relative w-full h-full">
      {/* Reset view button */}
      <button
        onClick={resetView}
        className="absolute top-3 right-3 z-10 px-2.5 py-1 bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        title="Reset zoom & pan"
      >
        Reset view
      </button>

      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="select-none"
        style={{ cursor: dragId != null ? 'grabbing' : 'grab' }}
        onPointerDown={onSVGDown}
        onPointerMove={onSVGMove}
        onPointerUp={onSVGUp}
        onPointerLeave={onSVGUp}
      >
        {/* All content inside pan/zoom transform */}
        <g transform={`translate(${panX},${panY}) scale(${scale})`}>
        {/* clipPaths must be in the same coordinate space as the elements they clip.
            With userSpaceOnUse, the clip coords are interpreted in the referencing
            element's coordinate system (content space), so we use n.x/n.y directly. */}
        <defs>
          {display.map(n => {
            const deg = degreeMap.get(n.id) ?? 0
            const r = nodeRadius(n, deg)
            return (
              <clipPath key={n.id} id={`gc-${n.id}`}>
                <circle cx={n.x} cy={n.y} r={r - 2} />
              </clipPath>
            )
          })}
        </defs>
          {/* ── Edges ── */}
          {edges.map(e => {
            const a = displayMap.get(e.source), b = displayMap.get(e.target)
            if (!a || !b) return null
            const active = hoveredNode === e.source || hoveredNode === e.target
            const w = Math.log(e.weight + 1) * 2.2
            return (
              <g key={`${e.source}-${e.target}`}>
                <line
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={active ? '#94a3b8' : '#3f3f46'}
                  strokeWidth={w}
                  strokeOpacity={active ? 0.9 : 0.4}
                  strokeLinecap="round"
                />
                <line
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke="transparent"
                  strokeWidth={Math.max(w + 10, 18)}
                  style={{ cursor: onEdgeClick ? 'pointer' : 'crosshair' }}
                  onPointerDown={onEdgeClick ? ev => ev.stopPropagation() : undefined}
                  onClick={onEdgeClick ? () => onEdgeClick([e.source, e.target]) : undefined}
                  onMouseEnter={ev => setEdgeTip({
                    x: ev.clientX, y: ev.clientY,
                    sourceId: e.source, targetId: e.target, weight: e.weight,
                  })}
                  onMouseLeave={() => setEdgeTip(null)}
                />
              </g>
            )
          })}

          {/* ── Nodes ── */}
          {display.map(n => {
            const deg = degreeMap.get(n.id) ?? 0
            const r = nodeRadius(n, deg)
            const color = nodeColor(n.id)
            const isHov = hoveredNode === n.id
            const dimmed = hoveredNode != null && !isHov && !connectedTo?.has(n.id)

            return (
              <g
                key={n.id}
                data-node={n.id}
                style={{
                  cursor: dragId != null ? 'grabbing' : 'grab',
                  opacity: dimmed ? 0.18 : 1,
                  transition: 'opacity 0.15s',
                }}
                onPointerDown={e => onNodeDown(e, n.id)}
                onMouseEnter={() => setHoveredNode(n.id)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                <circle cx={n.x} cy={n.y} r={r + 5} fill={color} opacity={isHov ? 0.4 : 0.12} />
                <circle cx={n.x} cy={n.y} r={r} fill="#111113" />
                {n.thumbnail_face_id != null ? (
                  <image
                    href={api.faceThumbnailUrl(n.thumbnail_face_id)}
                    x={n.x - r} y={n.y - r}
                    width={r * 2} height={r * 2}
                    clipPath={`url(#gc-${n.id})`}
                    preserveAspectRatio="xMidYMid slice"
                    style={{ pointerEvents: 'none' }}
                  />
                ) : (
                  <text
                    x={n.x} y={n.y + r * 0.32}
                    textAnchor="middle"
                    fontSize={r * 0.85}
                    fill={color}
                    fontWeight="700"
                    style={{ pointerEvents: 'none' }}
                  >
                    {n.name.charAt(0).toUpperCase()}
                  </text>
                )}
                <circle cx={n.x} cy={n.y} r={r} fill="none" stroke={color} strokeWidth={isHov ? 2.5 : 1.5} strokeOpacity={isHov ? 0.9 : 0.5} />

                <text
                  x={n.x} y={n.y + r + 15}
                  textAnchor="middle"
                  fontSize={11}
                  fill={isHov ? '#e4e4e7' : '#71717a'}
                  fontWeight={isHov ? '600' : '400'}
                  style={{ pointerEvents: 'none' }}
                >
                  {n.name.length > 16 ? n.name.slice(0, 14) + '…' : n.name}
                </text>

                {isHov && (
                  <text
                    x={n.x} y={n.y + r + 28}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#52525b"
                    style={{ pointerEvents: 'none' }}
                  >
                    {n.photo_count} photo{n.photo_count !== 1 ? 's' : ''} · {deg} connection{deg !== 1 ? 's' : ''}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      {/* Edge tooltip — screen-space overlay */}
      {edgeTip && (
        <div
          className="fixed z-50 pointer-events-none bg-zinc-800/95 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs shadow-xl whitespace-nowrap space-y-0.5"
          style={{ left: edgeTip.x + 14, top: edgeTip.y - 18 }}
        >
          <div>
            <span className="font-semibold text-zinc-200">{nameMap.get(edgeTip.sourceId)}</span>
            <span className="text-zinc-500 mx-1.5">↔</span>
            <span className="font-semibold text-zinc-200">{nameMap.get(edgeTip.targetId)}</span>
            <span className="text-zinc-500 ml-2 tabular-nums">{edgeTip.weight} shared photo{edgeTip.weight !== 1 ? 's' : ''}</span>
          </div>
          {onEdgeClick && (
            <div className="text-zinc-600 text-[10px]">Click to view shared photos →</div>
          )}
        </div>
      )}
    </div>
  )
}

// ── ConnectionsTab ─────────────────────────────────────────────────────────────

export default function ConnectionsTab({
  onEdgeClick,
}: {
  onEdgeClick?: (personIds: number[]) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [minPhotos, setMinPhotos] = useState(2)   // committed → drives the query
  const [draft, setDraft] = useState(2)            // live slider value → UI only
  const [hiddenPersons, setHiddenPersons] = useState<Set<number>>(new Set())
  const [showFilter, setShowFilter] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    update()
    const obs = new ResizeObserver(update)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const { data, isLoading } = useQuery({
    queryKey: ['connections', minPhotos],
    queryFn: () => api.connections.get(minPhotos),
    staleTime: 30_000,
  })

  // NOTE: intentionally NOT resetting hiddenPersons when data changes —
  // the user wants excluded persons to stay excluded across slider changes.

  const visibleNodes = useMemo(
    () => (data?.nodes ?? []).filter(n => !hiddenPersons.has(n.id)),
    [data?.nodes, hiddenPersons],
  )
  const visibleEdges = useMemo(
    () => (data?.edges ?? []).filter(e => !hiddenPersons.has(e.source) && !hiddenPersons.has(e.target)),
    [data?.edges, hiddenPersons],
  )

  const graphKey = visibleNodes.length > 0
    ? `${visibleNodes.map(n => n.id).sort().join(',')}-${minPhotos}`
    : ''

  function togglePerson(id: number) {
    setHiddenPersons(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  return (
    <div className="flex flex-col gap-3" style={{ height: 'calc(100vh - 80px)' }}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <h2 className="text-sm font-semibold text-zinc-300">Co-occurrence graph</h2>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs text-zinc-500 whitespace-nowrap">Min shared photos</label>
          <input
            type="range"
            min={1} max={20} step={1}
            value={draft}
            onChange={e => setDraft(Number(e.target.value))}
            onMouseUp={() => setMinPhotos(draft)}
            onTouchEnd={() => setMinPhotos(draft)}
            onKeyUp={() => setMinPhotos(draft)}
            className="w-24 accent-brand-400"
          />
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => { const v = Math.max(1, draft - 1); setDraft(v); setMinPhotos(v) }}
              className="w-6 h-6 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 flex items-center justify-center text-base leading-none transition-colors"
              title="Decrease"
            >−</button>
            <input
              type="number"
              min={1} max={20}
              value={draft}
              onChange={e => {
                const v = Math.min(20, Math.max(1, Number(e.target.value) || 1))
                setDraft(v)
                setMinPhotos(v)
              }}
              className="w-10 text-center bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 py-0.5 focus:outline-none focus:border-zinc-500 tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button
              onClick={() => { const v = Math.min(20, draft + 1); setDraft(v); setMinPhotos(v) }}
              className="w-6 h-6 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 flex items-center justify-center text-base leading-none transition-colors"
              title="Increase"
            >+</button>
          </div>
        </div>
        {data && data.nodes.length > 0 && (
          <>
            <span className="text-xs text-zinc-600 tabular-nums">
              {visibleNodes.length}/{data.nodes.length} · {visibleEdges.length} connection{visibleEdges.length !== 1 ? 's' : ''}
            </span>
            <button
              onClick={() => setShowFilter(s => !s)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                showFilter || hiddenPersons.size > 0
                  ? 'bg-brand-400/20 border-brand-400/40 text-brand-300'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
              </svg>
              Filter persons
              {hiddenPersons.size > 0 && (
                <span className="px-1.5 py-0.5 bg-brand-500 text-white rounded-full text-xs leading-none">
                  {hiddenPersons.size} hidden
                </span>
              )}
            </button>
          </>
        )}
      </div>

      {/* Person filter panel */}
      {showFilter && data && data.nodes.length > 0 && (
        <div className="shrink-0 bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">
              {visibleNodes.length} of {data.nodes.length} persons visible
            </span>
            <div className="flex gap-3">
              <button
                onClick={() => setHiddenPersons(new Set())}
                className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
              >
                Show all
              </button>
              <button
                onClick={() => setHiddenPersons(new Set(data.nodes.map(n => n.id)))}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Hide all
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.nodes.map(n => {
              const visible = !hiddenPersons.has(n.id)
              return (
                <button
                  key={n.id}
                  onClick={() => togglePerson(n.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                    visible
                      ? 'bg-zinc-700 border-zinc-600 text-zinc-200 hover:border-zinc-500'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-600 hover:border-zinc-700 hover:text-zinc-500'
                  }`}
                >
                  {n.thumbnail_face_id && (
                    <img
                      src={api.faceThumbnailUrl(n.thumbnail_face_id, 32)}
                      className="w-4 h-4 rounded-full object-cover"
                      alt=""
                    />
                  )}
                  {n.name}
                  {!visible && <span className="text-zinc-700">✕</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Graph container — fills remaining height */}
      <div
        ref={containerRef}
        className="flex-1 w-full bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden"
      >
        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-600 text-sm">Loading…</p>
          </div>
        )}

        {!isLoading && data?.nodes.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-8">
            <p className="text-zinc-500 text-sm">No connections at this threshold.</p>
            <p className="text-zinc-600 text-xs max-w-sm">
              Either no persons share {minPhotos}+ photos, or no clusters have been named yet.
              Try lowering the slider.
            </p>
          </div>
        )}

        {!isLoading && data && visibleNodes.length === 0 && data.nodes.length > 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-600 text-sm">All persons are hidden. Use the filter to show them.</p>
          </div>
        )}

        {!isLoading && data && visibleNodes.length > 0 && size.width > 0 && (
          <ForceGraph
            key={graphKey}
            nodes={visibleNodes}
            edges={visibleEdges}
            width={size.width}
            height={size.height}
            onEdgeClick={onEdgeClick}
          />
        )}
      </div>

      <p className="text-xs text-zinc-700 text-center shrink-0">
        Scroll to zoom · Drag background to pan · Drag nodes to rearrange · Hover to highlight
      </p>
    </div>
  )
}

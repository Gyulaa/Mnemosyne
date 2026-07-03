import { useMemo } from 'react'
import type { PersonFull, Relation } from '../types'
import { api } from '../api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function countTop(items: (string | null | undefined)[], n: number): { label: string; count: number }[] {
  const map = new Map<string, number>()
  for (const v of items) {
    const key = v?.trim()
    if (!key) continue
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }))
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="text-2xl font-bold text-zinc-100 tabular-nums">{value}</div>
      <div className="text-xs text-zinc-400 mt-1">{label}</div>
      {sub && <div className="text-xs text-zinc-600 mt-0.5">{sub}</div>}
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <h3 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </div>
  )
}

function BarList({ items, maxCount, color = 'bg-brand-500' }: {
  items: { label: string; count: number }[]
  maxCount: number
  color?: string
}) {
  if (!items.length) return <p className="text-xs text-zinc-600 py-1">No data</p>
  return (
    <div className="space-y-1.5">
      {items.map(({ label, count }) => (
        <div key={label} className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-zinc-300 w-28 truncate shrink-0 text-right" title={label}>{label}</span>
          <div className="flex-1 min-w-0 bg-zinc-800 rounded-full h-1.5">
            <div
              className={`${color} h-1.5 rounded-full`}
              style={{ width: `${Math.max(2, (count / maxCount) * 100)}%` }}
            />
          </div>
          <span className="text-xs text-zinc-500 w-5 shrink-0 tabular-nums text-right">{count}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StatisticsView({ persons, relations }: { persons: PersonFull[]; relations: Relation[] }) {
  const s = useMemo(() => {
    const total = persons.length
    const maleCount = persons.filter(p => p.sex === 'M').length
    const femaleCount = persons.filter(p => p.sex === 'F').length

    // Lifespans
    const lifespanItems = persons
      .filter(p => p.birth_year != null && p.death_year != null && p.death_year > p.birth_year)
      .map(p => ({ person: p, years: p.death_year! - p.birth_year! }))
      .sort((a, b) => b.years - a.years)
    const avgLifespan = lifespanItems.length
      ? Math.round(lifespanItems.reduce((acc, x) => acc + x.years, 0) / lifespanItems.length)
      : null

    // Names
    const firstNames = countTop(persons.map(p => p.first_name), 10)
    const lastNames = countTop(persons.map(p => p.last_name), 10)

    // Occupations — split by comma / semicolon / slash
    const occupations = countTop(
      persons.flatMap(p =>
        p.occupation ? p.occupation.split(/[,;/]/).map(s => s.trim()) : []
      ),
      8
    )

    // Birth places — only city (first part before comma)
    const birthPlaces = countTop(
      persons.map(p => p.birth_place ? p.birth_place.split(',')[0].trim() : null),
      8
    )

    // Birth decades
    const decadeMap = new Map<number, number>()
    for (const p of persons) {
      if (p.birth_year == null) continue
      const d = Math.floor(p.birth_year / 10) * 10
      decadeMap.set(d, (decadeMap.get(d) ?? 0) + 1)
    }
    const decades = [...decadeMap.entries()].sort((a, b) => a[0] - b[0])
    const maxDecadeCount = Math.max(...decades.map(([, c]) => c), 1)

    // Data completeness
    const withBirthYear  = persons.filter(p => p.birth_year  != null).length
    const withDeathYear  = persons.filter(p => p.death_year  != null).length
    const withPhoto      = persons.filter(p => p.thumbnail_face_id != null).length
    const withFirstName  = persons.filter(p => p.first_name?.trim()).length
    const withLastName   = persons.filter(p => p.last_name?.trim()).length

    // Generation depth via BFS (person_a = parent, person_b = child)
    const childrenOf = new Map<number, number[]>()
    const parentsOf  = new Map<number, number[]>()
    for (const p of persons) { childrenOf.set(p.id, []); parentsOf.set(p.id, []) }
    for (const r of relations) {
      if (r.type !== 'parent') continue
      childrenOf.get(r.person_a_id)?.push(r.person_b_id)
      parentsOf.get(r.person_b_id)?.push(r.person_a_id)
    }
    let maxDepth = 0
    const visited = new Set<number>()
    const queue: [number, number][] = persons
      .filter(p => !(parentsOf.get(p.id)?.length))
      .map(p => [p.id, 0] as [number, number])
    while (queue.length) {
      const [id, d] = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      if (d > maxDepth) maxDepth = d
      for (const cid of childrenOf.get(id) ?? []) {
        if (!visited.has(cid)) queue.push([cid, d + 1])
      }
    }
    const hasParentRelations = relations.some(r => r.type === 'parent')
    const generationDepth = hasParentRelations ? maxDepth + 1 : null

    return {
      total, maleCount, femaleCount, avgLifespan,
      longestLived: lifespanItems.slice(0, 10),
      lifespanCount: lifespanItems.length,
      firstNames, lastNames, occupations, birthPlaces,
      decades, maxDecadeCount,
      withBirthYear, withDeathYear, withPhoto, withFirstName, withLastName,
      generationDepth,
    }
  }, [persons, relations])

  if (!persons.length) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-600 text-sm">
        No persons in this family
      </div>
    )
  }

  const pct = (n: number) => s.total > 0 ? Math.round((n / s.total) * 100) : 0

  const sexLabel = s.maleCount > 0 || s.femaleCount > 0
    ? `${s.maleCount}M / ${s.femaleCount}F`
    : '—'
  const sexSub = s.total - s.maleCount - s.femaleCount > 0
    ? `${s.total - s.maleCount - s.femaleCount} unknown`
    : undefined

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-5 space-y-4">

        {/* ── Summary cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="People" value={s.total} />
          <StatCard label="Sex ratio" value={sexLabel} sub={sexSub} />
          <StatCard
            label="Avg. lifespan"
            value={s.avgLifespan != null ? `${s.avgLifespan} yrs` : '—'}
            sub={s.lifespanCount > 0 ? `from ${s.lifespanCount} people` : undefined}
          />
          <StatCard
            label="Generations"
            value={s.generationDepth ?? '—'}
            sub={!s.generationDepth ? 'no parent links' : undefined}
          />
        </div>

        {/* ── Names ── */}
        <div className="grid grid-cols-2 gap-3">
          <SectionCard title="Most common first names">
            <BarList items={s.firstNames} maxCount={s.firstNames[0]?.count ?? 1} />
          </SectionCard>
          <SectionCard title="Most common last names">
            <BarList items={s.lastNames} maxCount={s.lastNames[0]?.count ?? 1} />
          </SectionCard>
        </div>

        {/* ── Longest lived ── */}
        {s.longestLived.length > 0 && (
          <SectionCard title="Longest lived">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {s.longestLived.map(({ person, years }, i) => (
                <div key={person.id} className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-zinc-600 w-4 shrink-0 tabular-nums text-right">{i + 1}.</span>
                  {person.thumbnail_face_id ? (
                    <img
                      src={api.faceThumbnailUrl(person.thumbnail_face_id, 48)}
                      className="w-6 h-6 rounded-full object-cover shrink-0"
                      alt=""
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-zinc-800 shrink-0" />
                  )}
                  <span className="text-sm text-zinc-200 truncate flex-1 min-w-0">{person.name ?? '(unnamed)'}</span>
                  <span className="text-xs font-semibold text-zinc-400 shrink-0 tabular-nums ml-1">{years}y</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* ── Birth decades ── */}
        {s.decades.length > 0 && (
          <SectionCard title="Births by decade">
            <div className="space-y-1.5">
              {s.decades.map(([decade, count]) => (
                <div key={decade} className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400 w-12 shrink-0 text-right tabular-nums">{decade}s</span>
                  <div className="flex-1 bg-zinc-800 rounded-full h-1.5">
                    <div
                      className="bg-indigo-500 h-1.5 rounded-full"
                      style={{ width: `${Math.max(2, (count / s.maxDecadeCount) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-zinc-500 w-5 shrink-0 tabular-nums text-right">{count}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* ── Occupations + Places ── */}
        {(s.occupations.length > 0 || s.birthPlaces.length > 0) && (
          <div className="grid grid-cols-2 gap-3">
            {s.occupations.length > 0 && (
              <SectionCard title="Most common occupations">
                <BarList
                  items={s.occupations}
                  maxCount={s.occupations[0]?.count ?? 1}
                  color="bg-emerald-600"
                />
              </SectionCard>
            )}
            {s.birthPlaces.length > 0 && (
              <SectionCard title="Most common birth places">
                <BarList
                  items={s.birthPlaces}
                  maxCount={s.birthPlaces[0]?.count ?? 1}
                  color="bg-amber-600"
                />
              </SectionCard>
            )}
          </div>
        )}

        {/* ── Data completeness ── */}
        <SectionCard title="Data completeness">
          <div className="space-y-2">
            {(
              [
                ['Birth year',  s.withBirthYear],
                ['Death year',  s.withDeathYear],
                ['Photo',       s.withPhoto],
                ['First name',  s.withFirstName],
                ['Last name',   s.withLastName],
              ] as [string, number][]
            ).map(([label, count]) => {
              const p = pct(count)
              const barColor = p >= 80 ? '#22c55e' : p >= 50 ? '#eab308' : '#ef4444'
              return (
                <div key={label} className="flex items-center gap-3">
                  <span className="text-xs text-zinc-400 w-20 shrink-0">{label}</span>
                  <div className="flex-1 bg-zinc-800 rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.max(p > 0 ? 1 : 0, p)}%`, backgroundColor: barColor }}
                    />
                  </div>
                  <span className="text-xs text-zinc-500 w-8 shrink-0 tabular-nums text-right">{p}%</span>
                  <span className="text-xs text-zinc-700 w-14 shrink-0 tabular-nums">{count} / {s.total}</span>
                </div>
              )
            })}
          </div>
        </SectionCard>

      </div>
    </div>
  )
}

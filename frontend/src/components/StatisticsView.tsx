import { useMemo } from 'react'
import type { PersonFull, Relation } from '../types'
import { api } from '../api'
import { useT } from '../SettingsContext'
import { usePlaces } from './PlaceInput'
import { placeKey } from '../placeKey'

// ── Helpers ───────────────────────────────────────────────────────────────────

type Bucket = { label: string; count: number; ids: number[] }

function countTopWithIds(items: { id: number; value: string | null | undefined }[], n: number): Bucket[] {
  const map = new Map<string, Set<number>>()
  for (const { id, value } of items) {
    const key = value?.trim()
    if (!key) continue
    if (!map.has(key)) map.set(key, new Set())
    map.get(key)!.add(id)
  }
  return [...map.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, n)
    .map(([label, ids]) => ({ label, count: ids.size, ids: [...ids] }))
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, onClick }: { label: string; value: string | number; sub?: string; onClick?: () => void }) {
  const content = (
    <>
      <div className="text-2xl font-bold text-zinc-100 tabular-nums">{value}</div>
      <div className="text-xs text-zinc-400 mt-1">{label}</div>
      {sub && <div className="text-xs text-zinc-600 mt-0.5">{sub}</div>}
    </>
  )
  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/60 rounded-xl p-4 text-left transition-colors"
      >
        {content}
      </button>
    )
  }
  return <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">{content}</div>
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </div>
  )
}

function BarList({ items, maxCount, color = 'bg-brand-500', onItemClick }: {
  items: Bucket[]
  maxCount: number
  color?: string
  onItemClick?: (item: Bucket) => void
}) {
  const t = useT()
  if (!items.length) return <p className="text-xs text-zinc-600 py-1">{t('stats.noData')}</p>
  return (
    <div className="space-y-1.5">
      {items.map(item => {
        const { label, count } = item
        const row = (
          <>
            <span className="text-xs text-zinc-300 w-28 truncate shrink-0 text-right" title={label}>{label}</span>
            <div className="flex-1 min-w-0 bg-zinc-800 rounded-full h-1.5">
              <div
                className={`${color} h-1.5 rounded-full`}
                style={{ width: `${Math.max(2, (count / maxCount) * 100)}%` }}
              />
            </div>
            <span className="text-xs text-zinc-500 w-5 shrink-0 tabular-nums text-right">{count}</span>
          </>
        )
        return onItemClick ? (
          <button
            key={label}
            onClick={() => onItemClick(item)}
            className="w-full flex items-center gap-2 min-w-0 -mx-1 px-1 py-0.5 rounded hover:bg-zinc-800/60 transition-colors text-left"
          >
            {row}
          </button>
        ) : (
          <div key={label} className="flex items-center gap-2 min-w-0">{row}</div>
        )
      })}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StatisticsView({ persons, relations, onSelectPersons, onSelectPerson }: {
  persons: PersonFull[]
  relations: Relation[]
  /** Jump to the tree with the sidebar isolated to these people — used by every clickable stat. */
  onSelectPersons?: (ids: number[], label: string) => void
  /** Jump straight to one person's profile — used by "Longest lived". */
  onSelectPerson?: (id: number) => void
}) {
  const t = useT()
  const { data: placeRows = [] } = usePlaces()
  // Raw place string → the settlement and what is above it, as split by
  // `backend/places.py`. Taking the first comma part instead — which is what
  // this did before — files "Fő utca 12, Példafalva" under the street, so one
  // village with a house number written in front of it counts as several.
  const canonicalByKey = useMemo(
    () => new Map(placeRows.filter(r => !r.is_settlement).map(r => [r.key, r.canonical])),
    [placeRows],
  )
  const s = useMemo(() => {
    const total = persons.length
    const maleCount = persons.filter(p => p.sex === 'M').length
    const femaleCount = persons.filter(p => p.sex === 'F').length
    const unknownSex = persons.filter(p => p.sex !== 'M' && p.sex !== 'F').map(p => p.id)

    // Lifespans
    const lifespanItems = persons
      .filter(p => p.birth_year != null && p.death_year != null && p.death_year > p.birth_year)
      .map(p => ({ person: p, years: p.death_year! - p.birth_year! }))
      .sort((a, b) => b.years - a.years)
    const avgLifespan = lifespanItems.length
      ? Math.round(lifespanItems.reduce((acc, x) => acc + x.years, 0) / lifespanItems.length)
      : null

    // Names
    const firstNames = countTopWithIds(persons.map(p => ({ id: p.id, value: p.first_name })), 10)
    const lastNames = countTopWithIds(persons.map(p => ({ id: p.id, value: p.last_name })), 10)

    // Occupations — split by comma / semicolon / slash
    const occupations = countTopWithIds(
      persons.flatMap(p =>
        p.occupation ? p.occupation.split(/[,;/]/).map(term => ({ id: p.id, value: term.trim() })) : []
      ),
      8
    )

    // Birth places — the settlement and above, address detail dropped
    const birthPlaces = countTopWithIds(
      persons.map(p => ({ id: p.id, value: canonicalByKey.get(placeKey(p.birth_place)) ?? p.birth_place?.trim() ?? null })),
      8
    )

    // Birth decades
    const decadeMap = new Map<number, number[]>()
    for (const p of persons) {
      if (p.birth_year == null) continue
      const d = Math.floor(p.birth_year / 10) * 10
      if (!decadeMap.has(d)) decadeMap.set(d, [])
      decadeMap.get(d)!.push(p.id)
    }
    const decades = [...decadeMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([decade, ids]) => ({ decade, count: ids.length, ids }))
    const maxDecadeCount = Math.max(...decades.map(d => d.count), 1)

    // Data completeness — count of who *has* each field, plus the ids of who is missing it
    const missingBirthYear = persons.filter(p => p.birth_year == null).map(p => p.id)
    const missingDeathYear = persons.filter(p => p.death_year == null).map(p => p.id)
    const missingPhoto     = persons.filter(p => p.thumbnail_face_id == null).map(p => p.id)
    const missingFirstName = persons.filter(p => !p.first_name?.trim()).map(p => p.id)
    const missingLastName  = persons.filter(p => !p.last_name?.trim()).map(p => p.id)
    const withBirthYear  = total - missingBirthYear.length
    const withDeathYear  = total - missingDeathYear.length
    const withPhoto      = total - missingPhoto.length
    const withFirstName  = total - missingFirstName.length
    const withLastName   = total - missingLastName.length

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
      total, maleCount, femaleCount, unknownSex, avgLifespan,
      longestLived: lifespanItems.slice(0, 10),
      lifespanCount: lifespanItems.length,
      firstNames, lastNames, occupations, birthPlaces,
      decades, maxDecadeCount,
      withBirthYear, withDeathYear, withPhoto, withFirstName, withLastName,
      missingBirthYear, missingDeathYear, missingPhoto, missingFirstName, missingLastName,
      generationDepth,
    }
  }, [persons, relations, canonicalByKey])

  if (!persons.length) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-600 text-sm">
        {t('stats.noPersons')}
      </div>
    )
  }

  const pct = (n: number) => s.total > 0 ? Math.round((n / s.total) * 100) : 0

  const sexLabel = s.maleCount > 0 || s.femaleCount > 0
    ? `${s.maleCount}${t('stats.maleAbbr')} / ${s.femaleCount}${t('stats.femaleAbbr')}`
    : '—'
  const sexSub = s.unknownSex.length > 0
    ? t('stats.unknown', { n: s.unknownSex.length })
    : undefined

  const completenessRows: { label: string; count: number; missingIds: number[] }[] = [
    { label: t('stats.birthYear'), count: s.withBirthYear, missingIds: s.missingBirthYear },
    { label: t('stats.deathYear'), count: s.withDeathYear, missingIds: s.missingDeathYear },
    { label: t('stats.photo'),     count: s.withPhoto,     missingIds: s.missingPhoto },
    { label: t('stats.firstName'), count: s.withFirstName, missingIds: s.missingFirstName },
    { label: t('stats.lastName'),  count: s.withLastName,  missingIds: s.missingLastName },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-5 space-y-4">

        {/* ── Summary cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label={t('stats.people')} value={s.total} />
          <StatCard
            label={t('stats.sexRatio')}
            value={sexLabel}
            sub={sexSub}
            onClick={onSelectPersons && s.unknownSex.length > 0 ? () => onSelectPersons(s.unknownSex, t('stats.filterUnknownSex')) : undefined}
          />
          <StatCard
            label={t('stats.avgLifespan')}
            value={s.avgLifespan != null ? t('stats.yrs', { n: s.avgLifespan }) : '—'}
            sub={s.lifespanCount > 0 ? t('stats.fromPeople', { n: s.lifespanCount }) : undefined}
          />
          <StatCard
            label={t('stats.generations')}
            value={s.generationDepth ?? '—'}
            sub={!s.generationDepth ? t('stats.noParentLinks') : undefined}
          />
        </div>

        {/* ── Names ── */}
        <div className="grid grid-cols-2 gap-3">
          <SectionCard title={t('stats.firstNames')}>
            <BarList
              items={s.firstNames}
              maxCount={s.firstNames[0]?.count ?? 1}
              onItemClick={onSelectPersons ? item => onSelectPersons(item.ids, t('stats.filterFirstName', { name: item.label })) : undefined}
            />
          </SectionCard>
          <SectionCard title={t('stats.lastNames')}>
            <BarList
              items={s.lastNames}
              maxCount={s.lastNames[0]?.count ?? 1}
              onItemClick={onSelectPersons ? item => onSelectPersons(item.ids, t('stats.filterLastName', { name: item.label })) : undefined}
            />
          </SectionCard>
        </div>

        {/* ── Longest lived ── */}
        {s.longestLived.length > 0 && (
          <SectionCard title={t('stats.longestLived')}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {s.longestLived.map(({ person, years }, i) => {
                const row = (
                  <>
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
                    <span className="text-sm text-zinc-200 truncate flex-1 min-w-0">{person.name ?? t('images.unnamed')}</span>
                    <span className="text-xs font-semibold text-zinc-400 shrink-0 tabular-nums ml-1">{years}{t('stats.lifespanSuffix')}</span>
                  </>
                )
                return onSelectPerson ? (
                  <button
                    key={person.id}
                    onClick={() => onSelectPerson(person.id)}
                    className="flex items-center gap-2 min-w-0 -mx-1 px-1 py-0.5 rounded hover:bg-zinc-800/60 transition-colors text-left"
                  >
                    {row}
                  </button>
                ) : (
                  <div key={person.id} className="flex items-center gap-2 min-w-0">{row}</div>
                )
              })}
            </div>
          </SectionCard>
        )}

        {/* ── Birth decades ── */}
        {s.decades.length > 0 && (
          <SectionCard title={t('stats.birthsByDecade')}>
            <div className="space-y-1.5">
              {s.decades.map(({ decade, count, ids }) => {
                const row = (
                  <>
                    <span className="text-xs text-zinc-400 w-12 shrink-0 text-right tabular-nums">{decade}{t('stats.decadeSuffix')}</span>
                    <div className="flex-1 bg-zinc-800 rounded-full h-1.5">
                      <div
                        className="bg-indigo-500 h-1.5 rounded-full"
                        style={{ width: `${Math.max(2, (count / s.maxDecadeCount) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-zinc-500 w-5 shrink-0 tabular-nums text-right">{count}</span>
                  </>
                )
                return onSelectPersons ? (
                  <button
                    key={decade}
                    onClick={() => onSelectPersons(ids, t('stats.filterDecade', { decade: `${decade}${t('stats.decadeSuffix')}` }))}
                    className="w-full flex items-center gap-2 -mx-1 px-1 py-0.5 rounded hover:bg-zinc-800/60 transition-colors text-left"
                  >
                    {row}
                  </button>
                ) : (
                  <div key={decade} className="flex items-center gap-2">{row}</div>
                )
              })}
            </div>
          </SectionCard>
        )}

        {/* ── Occupations + Places ── */}
        {(s.occupations.length > 0 || s.birthPlaces.length > 0) && (
          <div className="grid grid-cols-2 gap-3">
            {s.occupations.length > 0 && (
              <SectionCard title={t('stats.occupations')}>
                <BarList
                  items={s.occupations}
                  maxCount={s.occupations[0]?.count ?? 1}
                  color="bg-emerald-600"
                  onItemClick={onSelectPersons ? item => onSelectPersons(item.ids, t('stats.filterOccupation', { name: item.label })) : undefined}
                />
              </SectionCard>
            )}
            {s.birthPlaces.length > 0 && (
              <SectionCard title={t('stats.birthPlaces')}>
                <BarList
                  items={s.birthPlaces}
                  maxCount={s.birthPlaces[0]?.count ?? 1}
                  color="bg-amber-600"
                  onItemClick={onSelectPersons ? item => onSelectPersons(item.ids, t('stats.filterBirthPlace', { name: item.label })) : undefined}
                />
              </SectionCard>
            )}
          </div>
        )}

        {/* ── Data completeness ── */}
        <SectionCard title={t('stats.completeness')}>
          <div className="space-y-2">
            {completenessRows.map(({ label, count, missingIds }) => {
              const p = pct(count)
              const barColor = p >= 80 ? '#22c55e' : p >= 50 ? '#eab308' : '#ef4444'
              const row = (
                <>
                  <span className="text-xs text-zinc-400 w-20 shrink-0">{label}</span>
                  <div className="flex-1 bg-zinc-800 rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.max(p > 0 ? 1 : 0, p)}%`, backgroundColor: barColor }}
                    />
                  </div>
                  <span className="text-xs text-zinc-500 w-8 shrink-0 tabular-nums text-right">{p}%</span>
                  <span className="text-xs text-zinc-700 w-14 shrink-0 tabular-nums">{count} / {s.total}</span>
                </>
              )
              return onSelectPersons && missingIds.length > 0 ? (
                <button
                  key={label}
                  onClick={() => onSelectPersons(missingIds, t('stats.filterMissing', { field: label }))}
                  className="w-full flex items-center gap-3 -mx-1 px-1 py-0.5 rounded hover:bg-zinc-800/60 transition-colors text-left"
                >
                  {row}
                </button>
              ) : (
                <div key={label} className="flex items-center gap-3">{row}</div>
              )
            })}
          </div>
        </SectionCard>

      </div>
    </div>
  )
}

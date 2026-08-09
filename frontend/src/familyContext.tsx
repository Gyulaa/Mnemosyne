/**
 * Close-relative context for person pickers.
 *
 * Several screens let you pick a person out of a long list, and a bare name is
 * often not enough to tell four "Miklós Anna"s apart. The convention across the
 * app is a couple of very short lines under the name — ♥ spouse, ↑ parents,
 * ↓ children — so this module owns both the lookup and the rendering, and every
 * picker shows the same thing in the same shape.
 */
import { useMemo } from 'react'
import type { PersonFull, Relation } from './types'
import { displayPersonName, type NameOrder } from './SettingsContext'

export interface FamilyEntry {
  spouses: string[]
  parents: string[]
  children: string[]
  siblings: string[]
}

const EMPTY: FamilyEntry = { spouses: [], parents: [], children: [], siblings: [] }

/**
 * Map person id → names of their closest relatives, already rendered in the
 * user's configured name order.
 */
export function useFamilyContext(
  persons: PersonFull[],
  relations: Relation[],
  nameOrder: NameOrder,
): Map<number, FamilyEntry> {
  return useMemo(() => {
    const map = new Map<number, FamilyEntry>()
    const byId = new Map(persons.map(p => [p.id, p]))
    const nameOf = (id: number) => {
      const p = byId.get(id)
      return p ? (displayPersonName(p, nameOrder, '') || null) : null
    }
    const entry = (id: number): FamilyEntry => {
      let e = map.get(id)
      if (!e) { e = { spouses: [], parents: [], children: [], siblings: [] }; map.set(id, e) }
      return e
    }
    for (const r of relations) {
      const nA = nameOf(r.person_a_id)
      const nB = nameOf(r.person_b_id)
      if (r.type === 'spouse') {
        if (nB) entry(r.person_a_id).spouses.push(nB)
        if (nA) entry(r.person_b_id).spouses.push(nA)
      } else if (r.type === 'parent') {
        // person_a is the parent of person_b
        if (nA) entry(r.person_b_id).parents.push(nA)
        if (nB) entry(r.person_a_id).children.push(nB)
      } else if (r.type === 'sibling') {
        if (nB) entry(r.person_a_id).siblings.push(nB)
        if (nA) entry(r.person_b_id).siblings.push(nA)
      }
    }
    return map
  }, [persons, relations, nameOrder])
}

export function hasFamilyContext(fam: FamilyEntry | undefined): fam is FamilyEntry {
  return !!fam && (fam.spouses.length > 0 || fam.parents.length > 0 || fam.children.length > 0 || fam.siblings.length > 0)
}

function joinCapped(names: string[], cap: number): string {
  if (names.length <= cap) return names.join(', ')
  return `${names.slice(0, cap).join(', ')} +${names.length - cap}`
}

/**
 * The relative lines themselves. Deliberately terse — at most one line per
 * relation kind, each capped — so a scrolling list stays readable.
 * Siblings only appear when there is nothing closer to show.
 */
export function FamilyContextLines({ fam, dim = false }: { fam: FamilyEntry | undefined; dim?: boolean }) {
  const f = fam ?? EMPTY
  const showSiblings = f.spouses.length === 0 && f.parents.length === 0 && f.children.length === 0
  if (!hasFamilyContext(f)) return null
  const muted = dim ? 'text-zinc-600' : 'text-zinc-500'
  return (
    <span className="block mt-0.5 space-y-0.5">
      {f.spouses.length > 0 && (
        <span className={`block text-xs truncate ${dim ? 'text-brand-400/60' : 'text-brand-400/80'}`}>
          ♥ {joinCapped(f.spouses, 2)}
        </span>
      )}
      {f.parents.length > 0 && (
        <span className={`block text-xs truncate ${muted}`}>↑ {joinCapped(f.parents, 2)}</span>
      )}
      {f.children.length > 0 && (
        <span className={`block text-xs truncate ${muted}`}>↓ {joinCapped(f.children, 2)}</span>
      )}
      {showSiblings && f.siblings.length > 0 && (
        <span className={`block text-xs truncate ${muted}`}>~ {joinCapped(f.siblings, 2)}</span>
      )}
    </span>
  )
}

/** Years + place/occupation one-liner used above the relative lines. */
export function personLifeSummary(p: PersonFull): string | null {
  const by = p.birth_date ? p.birth_date.slice(0, 4) : p.birth_year != null ? String(p.birth_year) : null
  const dy = p.death_date ? p.death_date.slice(0, 4) : p.death_year != null ? String(p.death_year) : null
  const parts: string[] = []
  if (by && dy)   parts.push(`${by}–${dy}`)
  else if (by)    parts.push(`* ${by}`)
  else if (dy)    parts.push(`† ${dy}`)
  if (p.birth_place) parts.push(p.birth_place)
  if (p.occupation)  parts.push(p.occupation)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** Does this person match a free-text query? Matches display name, parts and nickname. */
export function personMatches(p: PersonFull, query: string, nameOrder: NameOrder): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [
    displayPersonName(p, nameOrder, ''),
    p.name, p.first_name, p.last_name, p.middle_name, p.nickname,
  ].some(v => (v ?? '').toLowerCase().includes(q))
}

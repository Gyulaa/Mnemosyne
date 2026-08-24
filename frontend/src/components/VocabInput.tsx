/**
 * A small-vocabulary text field — occupation, religion, nationality,
 * education, cause of death, academic title.
 *
 * `SuggestInput` fed from `GET /api/field-values`, keyed by the field name the
 * server registered in `backend/field_values.py`. The frontend never names a
 * column: adding a field to the registry there is what makes it suggest, and
 * this component is passed that same name.
 *
 * These values repeat across a whole family, so retyping them is pure cost —
 * and typing one slightly differently the second time quietly splits one group
 * into two everywhere the field is counted or searched.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useT } from '../SettingsContext'
import SuggestInput from './SuggestInput'
import { foldPlace } from '../placeKey'

/**
 * Every registered field's values, fetched once and shared by every field on
 * the screen — a person's details form alone holds five of them.
 */
export function useFieldValues() {
  return useQuery({
    queryKey: ['field-values'],
    queryFn: api.fieldValues.list,
    staleTime: 60_000,
  })
}

export interface VocabInputProps {
  /** Registry key from `FIELD_SOURCES` — e.g. `occupation`, `religion`. */
  field: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className: string
  limit?: number
  autoFocus?: boolean
  onBlur?: () => void
  /**
   * Values offered before the project has any of its own — the handful of
   * academic titles the name editor has always suggested. They are merged in
   * with no count, so a project value always outranks them.
   */
  seed?: readonly string[]
}

export default function VocabInput({ field, seed, ...rest }: VocabInputProps) {
  const t = useT()
  const { data: all } = useFieldValues()
  const rows = all?.[field]
  const partLabel = t('vocab.oneOfSeveral')

  const options = useMemo(() => {
    const used = (rows ?? []).map(r => ({
      value: r.value,
      key: r.key,
      count: r.count,
      hint: r.is_part ? partLabel : undefined,
      rowId: `${r.key}-${r.is_part}`,
    }))
    if (!seed?.length) return used
    // A seed value the project already uses is dropped rather than shown twice;
    // the project's own row carries the count and wins the ordering.
    const known = new Set(used.map(o => o.key))
    const extra = seed
      .filter(v => !known.has(foldPlace(v)))
      .map(v => ({ value: v, key: foldPlace(v), count: 0, rowId: `seed-${v}` }))
    return [...used, ...extra]
  }, [rows, seed, partLabel])

  return <SuggestInput {...rest} options={options} />
}

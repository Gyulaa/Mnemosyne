/**
 * A place field: `SuggestInput` fed with the places the project already uses.
 *
 * Every place in the app goes through here rather than through a bare
 * `<input>`. Nothing else offered what had already been typed, so the same
 * village accumulated a spelling per typist, and no later cleanup fixes that
 * retroactively.
 *
 * What is specific to places, and so lives here rather than in `SuggestInput`:
 * the settlement-only rows, which let someone take the village out of an
 * address without first deleting a stranger's house number.
 *
 * **It never parses a place string.** The comma levels arrive already split
 * from `GET /api/places`, decided once in `backend/places.py`. A second
 * heuristic in the browser is how the tree card sizes drifted from the PNG
 * export, and a house number is a subtler judgement than a card width.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useT } from '../SettingsContext'
import SuggestInput from './SuggestInput'

/** Places, fetched once per screen and shared by every field on it. */
export function usePlaces() {
  return useQuery({
    queryKey: ['places'],
    queryFn: api.places.list,
    staleTime: 60_000,
  })
}

export interface PlaceInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className: string
  limit?: number
  autoFocus?: boolean
  onBlur?: () => void
}

export default function PlaceInput(props: PlaceInputProps) {
  const t = useT()
  const { data: places = [] } = usePlaces()
  const settlementLabel = t('place.settlementOnly')

  const options = useMemo(
    () => places.map(p => ({
      value: p.value,
      key: p.key,
      count: p.count,
      hint: p.is_settlement ? settlementLabel : undefined,
      // `key` alone is not unique: a settlement row and a plain full string can
      // fold to the same thing. The pair is what the server guarantees.
      rowId: `${p.key}-${p.is_settlement}`,
    })),
    [places, settlementLabel],
  )

  return <SuggestInput {...props} options={options} />
}

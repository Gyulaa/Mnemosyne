import { useT } from '../SettingsContext'
import VocabInput from './VocabInput'

export interface NameParts {
  title: string
  last_name: string
  first_name: string
  middle_name: string
  nickname: string
}

export function deriveDisplayName(parts: NameParts): string {
  return [parts.title, parts.first_name, parts.middle_name, parts.last_name]
    .map(s => s.trim())
    .filter(Boolean)
    .join(' ')
}

export function namePartsFromPerson(p: {
  title?: string | null
  last_name?: string | null
  first_name?: string | null
  middle_name?: string | null
  nickname?: string | null
}): NameParts {
  return {
    title: p.title ?? '',
    last_name: p.last_name ?? '',
    first_name: p.first_name ?? '',
    middle_name: p.middle_name ?? '',
    nickname: p.nickname ?? '',
  }
}

// Offered before the project has any titles of its own; a title already used
// here outranks them, because it carries a count and these do not.
const TITLE_SUGGESTIONS = ['Dr.', 'Prof.', 'Sr.', 'Jr.', 'Rev.', 'PhD', 'MD', 'Esq.'] as const

const SIZES = {
  sm: {
    input: 'w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400',
    label: 'text-xs text-zinc-500 block mb-0.5',
    gap: 'space-y-1.5',
    grid: 'grid grid-cols-2 gap-1.5',
  },
  md: {
    input: 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400',
    label: 'text-xs text-zinc-400 block mb-1',
    gap: 'space-y-3',
    grid: 'grid grid-cols-2 gap-3',
  },
}

export default function NameEditor({
  value,
  onChange,
  autoFocus = false,
  size = 'sm',
}: {
  value: NameParts
  onChange: (v: NameParts) => void
  autoFocus?: boolean
  size?: 'sm' | 'md'
}) {
  const s = SIZES[size]
  const t = useT()

  function set(field: keyof NameParts) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      onChange({ ...value, [field]: e.target.value })
  }

  return (
    <div className={s.gap}>
      <div className={s.grid}>
        <div>
          <label className={s.label}>{t('nameEditor.firstName')}</label>
          <input
            autoFocus={autoFocus}
            value={value.first_name}
            onChange={set('first_name')}
            placeholder={t('nameEditor.firstName')}
            className={s.input}
          />
        </div>
        <div>
          <label className={s.label}>{t('nameEditor.lastName')}</label>
          <input
            value={value.last_name}
            onChange={set('last_name')}
            placeholder={t('nameEditor.lastName')}
            className={s.input}
          />
        </div>
        <div>
          <label className={s.label}>{t('nameEditor.middleName')}</label>
          <input
            value={value.middle_name}
            onChange={set('middle_name')}
            placeholder={t('nameEditor.middleName')}
            className={s.input}
          />
        </div>
        <div>
          <label className={s.label}>{t('nameEditor.nickname')}</label>
          <input
            value={value.nickname}
            onChange={set('nickname')}
            placeholder={t('nameEditor.nicknamePh')}
            className={s.input}
          />
        </div>
      </div>
      <div>
        <label className={s.label}>{t('nameEditor.titleSuffix')}</label>
        <VocabInput
          field="title"
          seed={TITLE_SUGGESTIONS}
          value={value.title}
          onChange={v => onChange({ ...value, title: v })}
          placeholder={t('nameEditor.titlePh')}
          className={s.input}
        />
      </div>
    </div>
  )
}

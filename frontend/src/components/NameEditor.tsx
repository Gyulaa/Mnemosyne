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

const TITLE_SUGGESTIONS = ['Dr.', 'Prof.', 'Sr.', 'Jr.', 'Rev.', 'PhD', 'MD', 'Esq.']

const SIZES = {
  sm: {
    input: 'w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400',
    label: 'text-[10px] text-zinc-500 block mb-0.5',
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

  function set(field: keyof NameParts) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      onChange({ ...value, [field]: e.target.value })
  }

  return (
    <div className={s.gap}>
      <div className={s.grid}>
        <div>
          <label className={s.label}>First name</label>
          <input
            autoFocus={autoFocus}
            value={value.first_name}
            onChange={set('first_name')}
            placeholder="First name"
            className={s.input}
          />
        </div>
        <div>
          <label className={s.label}>Last name</label>
          <input
            value={value.last_name}
            onChange={set('last_name')}
            placeholder="Last name"
            className={s.input}
          />
        </div>
        <div>
          <label className={s.label}>Middle name(s)</label>
          <input
            value={value.middle_name}
            onChange={set('middle_name')}
            placeholder="Middle name(s)"
            className={s.input}
          />
        </div>
        <div>
          <label className={s.label}>Nickname</label>
          <input
            value={value.nickname}
            onChange={set('nickname')}
            placeholder='"Billy"'
            className={s.input}
          />
        </div>
      </div>
      <div>
        <label className={s.label}>Title / Suffix</label>
        <input
          list="name-editor-titles"
          value={value.title}
          onChange={set('title')}
          placeholder="e.g. Dr., Prof., Jr."
          className={s.input}
        />
        <datalist id="name-editor-titles">
          {TITLE_SUGGESTIONS.map(t => <option key={t} value={t} />)}
        </datalist>
      </div>
    </div>
  )
}

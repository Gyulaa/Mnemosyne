import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, downloadViaBrowser } from '../api'
import { useT, useSettings, useDateLocale, formatPartialDate } from '../SettingsContext'
import { useFamilyContext } from '../familyContext'
import { PersonFilterCombobox } from './PersonSelect'
import { useBackdropClose } from '../modalBackdrop'
import { plainMentions } from '../markdown'
import type {
  PersonFull, Relation, ShareProfile, ShareRule, ShareRules, ShareOptions,
  SharePreview, LivingPolicy, ShareContentKind, PhotoKinship,
  PersonDocument, PersonEvent,
} from '../types'

// Which rules take which fields. The backend is the authority on the shape
// (`backend/share_filter.py`); this table only decides what the editor draws,
// so a rule gaining a parameter means adding it in both places.
const RULE_FIELDS: Record<ShareRule['rule'], {
  person?: boolean; generations?: boolean; steps?: boolean; text?: boolean
  /** The rule names records of this kind rather than people. */
  records?: 'documents' | 'events'
}> = {
  everyone:         {},
  persons:          {},
  only_person:      { person: true },
  surname:          { text: true },
  documents:        { records: 'documents' },
  events:           { records: 'events' },
  family_group_of:  { person: true },
  ancestors_of:     { person: true, generations: true },
  descendants_of:   { person: true, generations: true },
  relatives_of:     { person: true, steps: true },
  common_line_with: { person: true },
}

const RULE_ORDER: ShareRule['rule'][] = [
  'common_line_with', 'descendants_of', 'ancestors_of', 'relatives_of',
  'family_group_of', 'only_person', 'surname', 'everyone',
  // Rules that name records instead of people. Last, because everything else
  // in a profile is expressed through the tree and these are the exception.
  'documents', 'events',
]

const CONTENT_KINDS: ShareContentKind[] = ['documents', 'images', 'notes', 'events']

// What one exclusion row can leave out. `persons` removes them from the tree
// entirely; the rest keep them and hold back one body of their material.
// Mirrors EXCLUDABLE_KINDS in share_filter.py.
const EXCLUDABLE_KINDS: ShareContentKind[] = ['persons', ...CONTENT_KINDS]

// Degrees of kinship worth offering, each labelled by the relationship it
// reaches. The number is the ordinary genealogical degree — the shortest path
// over parent and child links — so 4 is a first cousin and 5 is their child.
// Nobody picks "4" from a bare number list; they pick "first cousins".
const KINSHIP_DEGREES = [1, 2, 3, 4, 5, 6] as const

const emptyRules = (): ShareRules => ({
  include: [{ rule: 'common_line_with', person_id: null }],
  exclude: [],
  closure: { spouses: true, parents_of_included: false },
})

const defaultOptions = (): ShareOptions => ({
  living_policy: 'redact',
  lifespan_years: 100,
  include_notes: true,
  include_sources: true,
  include_events: true,
  include_documents: true,
  include_images: true,
  include_faceless: true,
})

// ── Small pieces ──────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  )
}

function Toggle({ checked, onChange, label, desc }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; desc?: string
}) {
  return (
    <label className="flex items-start gap-2.5 py-1.5 cursor-pointer group">
      <input
        type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-brand-500 focus:ring-brand-400 focus:ring-offset-0"
      />
      <span className="flex flex-col">
        <span className="text-xs text-zinc-200 group-hover:text-zinc-100">{label}</span>
        {desc && <span className="text-[11px] text-zinc-500 leading-tight">{desc}</span>}
      </span>
    </label>
  )
}

function CountPill({ n, label, tone = 'default' }: {
  n: number; label: string; tone?: 'default' | 'warn'
}) {
  const colour = tone === 'warn'
    ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
    : 'bg-zinc-800/80 text-zinc-300 border-zinc-700'
  return (
    <span className={`inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] ${colour}`}>
      <span className="tabular-nums font-medium">{n}</span>
      <span className="opacity-70">{label}</span>
    </span>
  )
}

// ── Record picker ─────────────────────────────────────────────────────────────

/** The list a document or event rule picks from, loaded only when one exists. */
function useRecordOptions(kind: 'documents' | 'events' | undefined) {
  const docs = useQuery({
    queryKey: ['docs-all'], queryFn: api.documents.listAll,
    enabled: kind === 'documents',
  })
  const events = useQuery({
    queryKey: ['events'], queryFn: () => api.events.list(),
    enabled: kind === 'events',
  })
  if (kind === 'documents') {
    return {
      loading: docs.isLoading,
      rows: (docs.data ?? []).map((d: PersonDocument) => ({
        id: d.id,
        // A stored title holds mention markup, so it is never printed raw.
        label: plainMentions(d.title || '') || d.filename,
        hint: [d.doc_type, d.date || (d.year ? String(d.year) : '')]
          .filter(Boolean).join(' · '),
      })),
    }
  }
  if (kind === 'events') {
    return {
      loading: events.isLoading,
      rows: (events.data ?? []).map((e: PersonEvent) => ({
        id: e.id,
        label: plainMentions(e.title || ''),
        hint: [e.event_type, e.date || (e.year ? String(e.year) : ''), e.place]
          .filter(Boolean).join(' · '),
      })),
    }
  }
  return { loading: false, rows: [] as { id: number; label: string; hint: string }[] }
}

function RecordPicker({ kind, ids, onChange }: {
  kind: 'documents' | 'events'
  ids: number[]
  onChange: (ids: number[]) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(ids.length === 0)
  const [search, setSearch] = useState('')
  const { loading, rows } = useRecordOptions(kind)
  const chosen = new Set(ids)

  const shown = search.trim()
    ? rows.filter(r => (r.label + ' ' + r.hint).toLowerCase().includes(search.toLowerCase()))
    : rows

  function toggle(id: number, on: boolean) {
    onChange(on ? [...ids, id] : ids.filter(x => x !== id))
  }

  return (
    <div className="w-full flex flex-col gap-1.5">
      <button
        onClick={() => setOpen(o => !o)}
        className="self-start text-[11px] text-brand-300 hover:text-brand-200 transition-colors"
      >
        {t('share.recordsChosen', { n: ids.length })} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-2 px-2 py-1.5 border-b border-zinc-800">
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder={t('common.search')}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100 placeholder-zinc-500 outline-none focus:border-brand-400"
            />
            {/* Select-all applies to what the search is showing, which is what
                makes this a bulk picker rather than a long list of ticks. */}
            <button
              onClick={() => onChange([...new Set([...ids, ...shown.map(r => r.id)])])}
              className="text-[11px] text-brand-300 hover:text-brand-200 whitespace-nowrap">
              {t('share.selectAll')}
            </button>
            <button
              onClick={() => onChange(ids.filter(x => !shown.some(r => r.id === x)))}
              className="text-[11px] text-zinc-400 hover:text-zinc-200 whitespace-nowrap">
              {t('share.selectNone')}
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {loading && <p className="px-2.5 py-1.5 text-[11px] text-zinc-500">{t('common.loading')}</p>}
            {!loading && shown.length === 0 && (
              <p className="px-2.5 py-1.5 text-[11px] text-zinc-600 italic">{t('docs.noResults')}</p>
            )}
            {shown.map(r => (
              <label key={r.id}
                className="flex items-start gap-2 px-2.5 py-1 cursor-pointer hover:bg-zinc-800/60">
                <input
                  type="checkbox" checked={chosen.has(r.id)}
                  onChange={e => toggle(r.id, e.target.checked)}
                  className="mt-0.5 w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 text-brand-500 focus:ring-brand-400 focus:ring-offset-0"
                />
                <span className="flex flex-col min-w-0">
                  <span className="text-[11px] text-zinc-200 truncate">
                    {r.label || t('share.untitledRecord')}
                  </span>
                  {r.hint && <span className="text-[10px] text-zinc-500 truncate">{r.hint}</span>}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Rule row ──────────────────────────────────────────────────────────────────

function RuleRow({ rule, persons, familyMap, onChange, onRemove }: {
  rule: ShareRule
  persons: PersonFull[]
  familyMap: ReturnType<typeof useFamilyContext>
  onChange: (r: ShareRule) => void
  onRemove: () => void
}) {
  const t = useT()
  const fields = RULE_FIELDS[rule.rule] ?? {}

  return (
    <div className="flex flex-wrap items-end gap-2 p-2.5 rounded-xl bg-zinc-900/60 border border-zinc-800">
      <Field label={t('share.rule')}>
        <select
          value={rule.rule}
          onChange={e => onChange({ rule: e.target.value as ShareRule['rule'], person_id: null })}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-brand-400"
        >
          {RULE_ORDER.map(r => (
            <option key={r} value={r}>{t(`share.rule.${r}`)}</option>
          ))}
        </select>
      </Field>

      {fields.person && (
        <Field label={t('share.rulePerson')}>
          <PersonFilterCombobox
            persons={persons}
            familyMap={familyMap}
            value={rule.person_id ?? null}
            onChange={id => onChange({ ...rule, person_id: id })}
            emptyLabel={t('share.pickSomeone')}
          />
        </Field>
      )}

      {fields.records && (
        <RecordPicker
          kind={fields.records}
          ids={rule.ids ?? []}
          onChange={next => onChange({ ...rule, ids: next })}
        />
      )}

      {fields.text && (
        <Field label={t('share.ruleSurname')}>
          <input
            value={rule.value ?? ''}
            onChange={e => onChange({ ...rule, value: e.target.value })}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-brand-400 w-40"
          />
        </Field>
      )}

      {fields.generations && (
        <Field label={t('share.ruleGenerations')}>
          <input
            type="number" min={1} max={40}
            value={rule.max_generations ?? ''}
            placeholder={t('share.noLimit')}
            onChange={e => onChange({
              ...rule,
              max_generations: e.target.value === '' ? null : Number(e.target.value),
            })}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400 w-28"
          />
        </Field>
      )}

      {fields.steps && (
        <Field label={t('share.ruleSteps')}>
          <input
            type="number" min={1} max={20}
            value={rule.max_steps ?? ''}
            placeholder={t('share.noLimit')}
            onChange={e => onChange({
              ...rule,
              max_steps: e.target.value === '' ? null : Number(e.target.value),
            })}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400 w-28"
          />
        </Field>
      )}

      <button
        onClick={onRemove}
        title={t('share.removeRule')}
        className="ml-auto text-zinc-500 hover:text-rose-400 transition-colors p-1.5"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

/** One exclusion: who, and what of theirs is left out. */
function ExcludeRow({ rule, persons, familyMap, onChange, onRemove }: {
  rule: ShareRule
  persons: PersonFull[]
  familyMap: ReturnType<typeof useFamilyContext>
  onChange: (r: ShareRule) => void
  onRemove: () => void
}) {
  const t = useT()
  // A row written before the two lists were merged has no `content` and meant
  // "leave these people out"; that is still what it means.
  const kinds = rule.content ?? ['persons']
  const wholePerson = kinds.includes('persons')
  // A row naming documents or events already says what it leaves out. Offering
  // "leave out: documents, photos, notes…" beside it would be asking which
  // parts of a document to withhold, which is not a thing.
  const namesRecords = !!RULE_FIELDS[rule.rule]?.records

  function toggle(kind: ShareContentKind, on: boolean) {
    onChange({
      ...rule,
      content: on ? [...kinds, kind] : kinds.filter(k => k !== kind),
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <RuleRow
        rule={rule} persons={persons} familyMap={familyMap}
        onChange={r => onChange({ ...r, content: kinds })}
        onRemove={onRemove}
      />
      {!namesRecords && (
      <div className="flex flex-wrap items-center gap-3 pl-3 -mt-1">
        <span className="text-[11px] text-zinc-500">{t('share.excludeWhat')}</span>
        {EXCLUDABLE_KINDS.map(kind => {
          // Ticking the people covers everything of theirs, so the rest stop
          // being separate choices rather than silently doing nothing.
          const dimmed = wholePerson && kind !== 'persons'
          return (
            <label key={kind}
              className={`flex items-center gap-1.5 ${dimmed ? 'opacity-40 cursor-default' : 'cursor-pointer group'}`}>
              <input
                type="checkbox"
                checked={dimmed ? true : kinds.includes(kind)}
                disabled={dimmed}
                onChange={e => toggle(kind, e.target.checked)}
                className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 text-brand-500 focus:ring-brand-400 focus:ring-offset-0"
              />
              <span className={`text-[11px] ${kind === 'persons' ? 'text-zinc-200 font-medium' : 'text-zinc-300'} group-hover:text-zinc-100`}>
                {t(`share.content.${kind}`)}
              </span>
            </label>
          )
        })}
        {kinds.length === 0 && (
          <span className="text-[11px] text-amber-400/80">{t('share.stripNothing')}</span>
        )}
      </div>
      )}
    </div>
  )
}

// ── Editor ────────────────────────────────────────────────────────────────────

function ProfileEditor({ profile, persons, familyMap, onSaved, onCancel, onPreviewOnTree }: {
  profile: ShareProfile | null
  persons: PersonFull[]
  familyMap: ReturnType<typeof useFamilyContext>
  onSaved: (p: ShareProfile) => void
  onCancel: () => void
  onPreviewOnTree?: (ids: number[], label: string) => void
}) {
  const t = useT()
  const qc = useQueryClient()

  const [name, setName] = useState(profile?.name ?? '')
  const [rules, setRules] = useState<ShareRules>(profile?.rules ?? emptyRules())
  const [options, setOptions] = useState<ShareOptions>({ ...defaultOptions(), ...(profile?.options ?? {}) })
  const [preview, setPreview] = useState<SharePreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const policy: LivingPolicy = options.living_policy ?? 'redact'
  const kinship = options.photo_kinship ?? null

  function patchKinship(next: Partial<PhotoKinship>) {
    setOptions(o => ({
      ...o,
      photo_kinship: { ...(o.photo_kinship ?? { person_id: null, max_degree: 4 }), ...next },
    }))
  }

  // Debounced so a rule set is resolved as it is typed rather than on a button.
  // A selection nobody previewed is a selection nobody checked.
  useEffect(() => {
    let cancelled = false
    setPreviewing(true)
    const id = window.setTimeout(() => {
      api.share.preview(rules, policy, options.lifespan_years ?? 100, kinship)
        .then(r => { if (!cancelled) { setPreview(r); setError(null) } })
        .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
        .finally(() => { if (!cancelled) setPreviewing(false) })
    }, 350)
    return () => { cancelled = true; window.clearTimeout(id) }
  }, [rules, policy, options.lifespan_years, JSON.stringify(kinship)])

  const save = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim() || t('share.untitled'), rules, options }
      return profile ? api.share.update(profile.id, body) : api.share.create(body)
    },
    onSuccess: p => { qc.invalidateQueries({ queryKey: ['share-profiles'] }); onSaved(p) },
    onError: e => setError(String((e as Error).message)),
  })

  function patchRules(next: Partial<ShareRules>) { setRules(r => ({ ...r, ...next })) }

  function updateList(key: 'include' | 'exclude', idx: number, r: ShareRule) {
    const list = [...(rules[key] ?? [])]
    list[idx] = r
    patchRules({ [key]: list } as Partial<ShareRules>)
  }
  function removeFrom(key: 'include' | 'exclude', idx: number) {
    patchRules({ [key]: (rules[key] ?? []).filter((_, i) => i !== idx) } as Partial<ShareRules>)
  }
  function addTo(key: 'include' | 'exclude') {
    const seed: ShareRule = key === 'exclude'
      // An exclusion starts by leaving the people out — the strongest reading,
      // and the one to soften rather than the one to reach for.
      ? { rule: 'descendants_of', person_id: null, content: ['persons'] }
      : { rule: 'descendants_of', person_id: null }
    patchRules({ [key]: [...(rules[key] ?? []), seed] } as Partial<ShareRules>)
  }

  const counts = preview?.counts
  return (
    <div className="flex flex-col gap-4 overflow-y-auto pr-1">
      <Field label={t('share.name')}>
        <input
          value={name} onChange={e => setName(e.target.value)}
          placeholder={t('share.namePlaceholder')}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400"
        />
      </Field>

      {/* ── who is included ── */}
      <section className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold text-zinc-300">{t('share.include')}</h4>
        {(rules.include ?? []).map((r, i) => (
          <RuleRow
            key={i} rule={r} persons={persons} familyMap={familyMap}
            onChange={nr => updateList('include', i, nr)}
            onRemove={() => removeFrom('include', i)}
          />
        ))}
        <button onClick={() => addTo('include')}
          className="self-start text-xs text-brand-300 hover:text-brand-200 transition-colors">
          + {t('share.addRule')}
        </button>
      </section>

      {/* ── what is left out: people, or just some of their material ── */}
      <section className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold text-zinc-300">{t('share.exclude')}</h4>
        <p className="text-[11px] text-zinc-500 -mt-1 leading-snug">{t('share.excludeDesc')}</p>
        {(rules.exclude ?? []).map((r, i) => (
          <ExcludeRow
            key={i} rule={r} persons={persons} familyMap={familyMap}
            onChange={nr => updateList('exclude', i, nr)}
            onRemove={() => removeFrom('exclude', i)}
          />
        ))}
        <button onClick={() => addTo('exclude')}
          className="self-start text-xs text-brand-300 hover:text-brand-200 transition-colors">
          + {t('share.addRule')}
        </button>
      </section>

      <section className="flex flex-col gap-1 border-t border-zinc-800 pt-3">
        <h4 className="text-xs font-semibold text-zinc-300 mb-1">{t('share.closure')}</h4>
        <Toggle
          checked={rules.closure?.spouses ?? true}
          onChange={v => patchRules({ closure: { ...rules.closure, spouses: v } })}
          label={t('share.closureSpouses')} desc={t('share.closureSpousesDesc')}
        />
        <Toggle
          checked={rules.closure?.parents_of_included ?? false}
          onChange={v => patchRules({ closure: { ...rules.closure, parents_of_included: v } })}
          label={t('share.closureParents')} desc={t('share.closureParentsDesc')}
        />
      </section>

      {/* ── living people ── */}
      <section className="flex flex-col gap-2 border-t border-zinc-800 pt-3">
        <h4 className="text-xs font-semibold text-zinc-300">{t('share.living')}</h4>
        <div className="flex flex-col gap-1">
          {(['redact', 'exclude', 'include'] as LivingPolicy[]).map(p => (
            <label key={p} className="flex items-start gap-2.5 py-1 cursor-pointer group">
              <input
                type="radio" name="living-policy" checked={policy === p}
                onChange={() => setOptions(o => ({ ...o, living_policy: p }))}
                className="mt-0.5 w-4 h-4 border-zinc-600 bg-zinc-800 text-brand-500 focus:ring-brand-400 focus:ring-offset-0"
              />
              <span className="flex flex-col">
                <span className="text-xs text-zinc-200 group-hover:text-zinc-100">{t(`share.living.${p}`)}</span>
                <span className="text-[11px] text-zinc-500 leading-tight">{t(`share.living.${p}.desc`)}</span>
              </span>
            </label>
          ))}
        </div>
        {policy !== 'include' && (
          <Field label={t('share.lifespan')}>
            <input
              type="number" min={20} max={130}
              value={options.lifespan_years ?? 100}
              onChange={e => setOptions(o => ({ ...o, lifespan_years: Number(e.target.value) || 100 }))}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-brand-400 w-28"
            />
          </Field>
        )}
        <p className="text-[11px] text-zinc-500 leading-snug">{t('share.lifespanDesc')}</p>
      </section>

      {/* ── what travels ── */}
      <section className="flex flex-col gap-0 border-t border-zinc-800 pt-3">
        <h4 className="text-xs font-semibold text-zinc-300 mb-1">{t('share.contents')}</h4>
        {([
          ['include_documents', 'export.documents'],
          ['include_notes', 'export.notes'],
          ['include_sources', 'export.sources'],
          ['include_events', 'export.events'],
          ['include_images', 'export.includePhotos'],
        ] as [keyof ShareOptions, string][]).map(([key, label]) => (
          <Toggle
            key={key}
            checked={options[key] !== false}
            onChange={v => setOptions(o => ({ ...o, [key]: v }))}
            label={t(label)}
          />
        ))}

        {/* Which photographs, as opposed to which people. A branch selection is
            about the tree; a photo library is not, and the two want different
            widths — everyone in an ancestral line belongs in the tree, while a
            picture of somebody four generations sideways is a stranger's album
            to the recipient. Nested under the photos toggle because it is
            meaningless without it. */}
        {options.include_images !== false && (
          <div className="mt-1.5 ml-6 pl-3 border-l border-zinc-800 flex flex-col gap-2">
            <Toggle
              checked={!!kinship}
              onChange={v => setOptions(o => ({
                ...o,
                photo_kinship: v ? { person_id: null, max_degree: 4, include_spouses: true } : null,
              }))}
              label={t('share.photoScope')}
              desc={t('share.photoScopeDesc')}
            />
            {kinship && (
              <div className="flex flex-wrap items-end gap-2">
                <Field label={t('share.photoScopeAnchor')}>
                  <PersonFilterCombobox
                    persons={persons} familyMap={familyMap}
                    value={kinship.person_id ?? null}
                    onChange={id => patchKinship({ person_id: id })}
                    emptyLabel={t('share.pickSomeone')}
                  />
                </Field>
                <Field label={t('share.photoScopeDegree')}>
                  <select
                    value={kinship.max_degree ?? 4}
                    onChange={e => patchKinship({ max_degree: Number(e.target.value) })}
                    className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-brand-400"
                  >
                    {KINSHIP_DEGREES.map(d => (
                      <option key={d} value={d}>{t(`share.degree.${d}`)}</option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
            {kinship && (
              <Toggle
                checked={kinship.include_spouses !== false}
                onChange={v => patchKinship({ include_spouses: v })}
                label={t('share.photoScopeSpouses')}
                desc={t('share.photoScopeSpousesDesc')}
              />
            )}
            {kinship && kinship.person_id == null && (
              <p className="text-[11px] text-amber-400/80">{t('share.photoScopeNoPerson')}</p>
            )}
          </div>
        )}
      </section>

      {/* ── what this actually selects ── */}
      <section className="border-t border-zinc-800 pt-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-zinc-300">{t('share.preview')}</h4>
          {previewing && <span className="text-[11px] text-zinc-500">{t('share.previewing')}</span>}
        </div>
        {counts && (
          <div className="flex flex-wrap gap-1.5">
            <CountPill n={counts.persons} label={t('share.countPersons')} />
            {counts.redacted > 0 && (
              <CountPill n={counts.redacted} label={t('share.countRedacted')} tone="warn" />
            )}
            <CountPill n={counts.relations} label={t('share.countRelations')} />
            <CountPill n={counts.documents} label={t('share.countDocuments')} />
            <CountPill n={counts.events} label={t('share.countEvents')} />
            <CountPill n={counts.notes} label={t('share.countNotes')} />
            <CountPill n={counts.images} label={t('share.countImages')} />
          </div>
        )}
        {counts?.persons === 0 && (
          <p className="text-[11px] text-amber-400/90">{t('share.selectsNobody')}</p>
        )}
        {preview?.photo_person_ids && (
          <p className="text-[11px] text-zinc-500 leading-snug">
            {t('share.photoScopeSummary', { n: preview.photo_person_ids.length })}
          </p>
        )}
        {preview && CONTENT_KINDS.some(k => (preview.strips?.[k] ?? []).length > 0) && (
          <p className="text-[11px] text-zinc-500 leading-snug">
            {CONTENT_KINDS
              .filter(k => (preview.strips?.[k] ?? []).length > 0)
              .map(k => t('share.stripSummary', {
                n: preview.strips[k].length, what: t(`share.content.${k}`).toLowerCase(),
              }))
              .join(' · ')}
          </p>
        )}
        {preview && onPreviewOnTree && preview.person_ids.length > 0 && (
          <button
            onClick={() => onPreviewOnTree(preview.person_ids, name.trim() || t('share.preview'))}
            className="self-start text-xs text-brand-300 hover:text-brand-200 transition-colors"
          >
            {t('share.showOnTree')}
          </button>
        )}
      </section>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <div className="flex items-center justify-end gap-2 border-t border-zinc-800 pt-3">
        <button onClick={onCancel}
          className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
          {t('common.cancel')}
        </button>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending || !name.trim()}
          className="px-4 py-1.5 text-xs font-medium rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
        >
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export default function ShareModal({ persons, relations, onClose, onPreviewOnTree }: {
  persons: PersonFull[]
  relations: Relation[]
  onClose: () => void
  onPreviewOnTree?: (ids: number[], label: string) => void
}) {
  const t = useT()
  const { nameOrder } = useSettings()
  const dateLocale = useDateLocale()
  const qc = useQueryClient()
  const backdrop = useBackdropClose(onClose)
  const familyMap = useFamilyContext(persons, relations, nameOrder)

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ['share-profiles'],
    queryFn: api.share.list,
  })

  const [editing, setEditing] = useState<ShareProfile | null | 'new'>(null)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  const del = useMutation({
    mutationFn: (id: number) => api.share.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['share-profiles'] }); setConfirmDelete(null) },
  })

  return (
    <div
      className="fixed inset-0 z-[500] flex items-start justify-center pt-[5vh] bg-black/70 backdrop-blur-sm p-4"
      {...backdrop}
    >
      {/* `useBackdropClose` closes on any click whose mousedown and click share
          a target — it does not check that the target *is* the backdrop. So the
          panel has to stop the bubble itself, or every button inside the modal
          closes it. Every other modal in this codebase does the same. */}
      <div
        className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl flex flex-col"
        style={{ width: 720, maxWidth: '96vw', maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-zinc-800">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">{t('share.title')}</h3>
            <p className="text-[11px] text-zinc-500 mt-0.5 max-w-lg leading-snug">{t('share.intro')}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {editing !== null ? (
            <ProfileEditor
              profile={editing === 'new' ? null : editing}
              persons={persons}
              familyMap={familyMap}
              onSaved={() => setEditing(null)}
              onCancel={() => setEditing(null)}
              onPreviewOnTree={onPreviewOnTree && ((ids, label) => {
                onPreviewOnTree(ids, label)
                onClose()
              })}
            />
          ) : isLoading ? (
            <p className="text-xs text-zinc-500">{t('common.loading')}</p>
          ) : profiles.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-xs text-zinc-500 mb-3">{t('share.empty')}</p>
              <button onClick={() => setEditing('new')}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-brand-500 hover:bg-brand-400 text-white transition-colors">
                {t('share.newProfile')}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {profiles.map(p => {
                return (
                  <div key={p.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-zinc-100 truncate">{p.name}</p>
                      <p className="text-[11px] text-zinc-500 truncate">
                        {p.last_export_counts
                          ? t('share.lastSent', {
                              persons: p.last_export_counts.persons,
                              date: p.last_exported_at ? formatPartialDate(p.last_exported_at.slice(0, 10), dateLocale) : '',
                            })
                          : t('share.neverSent')}
                      </p>
                    </div>
                    {confirmDelete === p.id ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button onClick={() => del.mutate(p.id)}
                          className="px-2.5 py-1.5 text-[11px] rounded-lg bg-rose-500/90 hover:bg-rose-500 text-white transition-colors">
                          {t('common.delete')}
                        </button>
                        <button onClick={() => setConfirmDelete(null)}
                          className="px-2 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors">
                          {t('common.cancel')}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => setEditing(p)}
                          className="px-2.5 py-1.5 text-[11px] text-zinc-300 hover:text-zinc-100 rounded-lg hover:bg-zinc-800 transition-colors">
                          {t('common.edit')}
                        </button>
                        <button onClick={() => downloadViaBrowser(api.share.exportUrl(p.id))}
                          className="px-3 py-1.5 text-[11px] font-medium rounded-lg bg-brand-500 hover:bg-brand-400 text-white transition-colors">
                          {t('share.export')}
                        </button>
                        <button onClick={() => setConfirmDelete(p.id)}
                          title={t('common.delete')}
                          className="p-1.5 text-zinc-600 hover:text-rose-400 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" d="M19 7l-.9 12.1a2 2 0 01-2 1.9H7.9a2 2 0 01-2-1.9L5 7m5 4v6m4-6v6M4 7h16M9 7V4h6v3" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
              <button onClick={() => setEditing('new')}
                className="self-start mt-1 text-xs text-brand-300 hover:text-brand-200 transition-colors">
                + {t('share.newProfile')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

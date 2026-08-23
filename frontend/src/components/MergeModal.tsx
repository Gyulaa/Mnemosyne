import { useState, useRef } from 'react'
import { api } from '../api'
import { useT } from '../SettingsContext'
import { useBackdropClose } from '../modalBackdrop'
import type {
  MergePreviewResponse, MergePersonEntry,
  MergeDecision, MergeOptions, MergeStats, MergeAction,
} from '../types'

type Step = 'upload' | 'review' | 'options' | 'confirm' | 'done'
type LocalDecision = { action: MergeAction; merge_with_id: number | null }
type Decisions = Record<number, LocalDecision>

function getFieldLabels(t: (k: string) => string): Record<string, string> {
  return {
    title: t('merge.fieldTitle'), first_name: t('merge.fieldFirstName'), last_name: t('merge.fieldLastName'),
    middle_name: t('merge.fieldMiddleName'), nickname: t('merge.fieldNickname'), sex: t('merge.fieldSex'),
    occupation: t('merge.fieldOccupation'),
    birth_date: t('merge.fieldBirthDate'), birth_year: t('merge.fieldBirthYear'), birth_place: t('merge.fieldBirthPlace'),
    christening_date: t('merge.fieldChristeningDate'), christening_year: t('merge.fieldChristeningYear'), christening_place: t('merge.fieldChristeningPlace'),
    death_date: t('merge.fieldDeathDate'), death_year: t('merge.fieldDeathYear'), death_place: t('merge.fieldDeathPlace'),
    burial_date: t('merge.fieldBurialDate'), burial_year: t('merge.fieldBurialYear'), burial_place: t('merge.fieldBurialPlace'),
  }
}

function incomingName(p: Pick<MergePersonEntry, 'name' | 'first_name' | 'last_name'>, unnamed = '(unnamed)'): string {
  if (p.first_name || p.last_name) return [p.first_name, p.last_name].filter(Boolean).join(' ')
  return p.name ?? unnamed
}

function yearsStr(birthYear: number | null | undefined, deathYear: number | null | undefined): string {
  const parts: string[] = []
  if (birthYear) parts.push(`*${birthYear}`)
  if (deathYear) parts.push(`†${deathYear}`)
  return parts.join(' ')
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepDots({ step }: { step: Step }) {
  const steps: Step[] = ['review', 'options', 'confirm']
  return (
    <div className="flex items-center gap-1.5">
      {steps.map(s => (
        <div key={s} className={`w-2 h-2 rounded-full transition-colors ${step === s ? 'bg-brand-400' : 'bg-zinc-700'}`} />
      ))}
    </div>
  )
}

function Chip({ color, count, label }: { color: 'green' | 'blue' | 'yellow' | 'gray'; count: number; label: string }) {
  const cls = {
    green:  'bg-emerald-900/50 text-emerald-300 border-emerald-800/60',
    blue:   'bg-blue-900/50 text-blue-300 border-blue-800/60',
    yellow: 'bg-amber-900/50 text-amber-300 border-amber-800/60',
    gray:   'bg-zinc-800/60 text-zinc-400 border-zinc-700',
  }[color]
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-xs font-medium ${cls}`}>
      <span className="font-bold tabular-nums">{count}</span> {label}
    </span>
  )
}

function SectionHeader({ title, color, open, onToggle }: {
  title: string; color: 'blue' | 'green' | 'yellow'; open: boolean; onToggle: () => void
}) {
  const dot = { blue: 'bg-blue-400', green: 'bg-emerald-400', yellow: 'bg-amber-400' }[color]
  return (
    <button onClick={onToggle} className="w-full flex items-center gap-2 py-1 group">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
      <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{title}</span>
      <svg
        className={`w-3.5 h-3.5 text-zinc-600 ml-auto transition-transform ${open ? '' : '-rotate-90'}`}
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
      >
        <path strokeLinecap="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  )
}

function ActionPill({ current, hasSuggestion, onChange }: {
  current: MergeAction; hasSuggestion: boolean; onChange: (a: MergeAction) => void
}) {
  const t = useT()
  return (
    <div className="shrink-0 flex gap-0.5 bg-zinc-800 rounded-md p-0.5">
      {hasSuggestion && (
        <button
          onClick={() => onChange('merge')}
          className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${current === 'merge' ? 'bg-brand-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          {t('merge.actionMerge')}
        </button>
      )}
      <button
        onClick={() => onChange('create')}
        className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${current === 'create' ? 'bg-zinc-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
      >
        {t('merge.actionNew')}
      </button>
      <button
        onClick={() => onChange('skip')}
        className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${current === 'skip' ? 'bg-red-900/70 text-red-300' : 'text-zinc-500 hover:text-zinc-300'}`}
      >
        {t('merge.actionSkip')}
      </button>
    </div>
  )
}

function MatchedPersonRow({ person: p, decision, onActionChange }: {
  person: MergePersonEntry
  decision: LocalDecision
  onActionChange: (a: MergeAction) => void
}) {
  const t = useT()
  const fieldLabels = getFieldLabels(t)
  const newFieldCount = Object.keys(p.new_fields ?? {}).length
  const newFieldNames = Object.keys(p.new_fields ?? {}).map(f => fieldLabels[f] ?? f).join(', ')
  const skipped   = decision.action === 'skip'
  const isConflict = p.context_status === 'conflict'
  const isConfirmed = p.context_status === 'confirmed'

  const borderCls = skipped
    ? 'border-zinc-800 opacity-40'
    : isConflict
    ? 'border-amber-700/60 bg-amber-950/10'
    : 'border-zinc-700/50'

  const familyLine = (p.incoming_family ?? [])
    .map(f => `${f.role === 'parent' ? 'P' : 'S'}: ${f.name}${f.birth_year ? ` *${f.birth_year}` : ''}`)
    .join(' · ')

  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 rounded-lg bg-zinc-800/40 border transition-opacity ${borderCls}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-zinc-100">{incomingName(p, t('merge.unnamed'))}</span>
          <span className="text-zinc-500 text-xs">{yearsStr(p.birth_year, p.death_year)}</span>
          {p.suggested_match && (
            <>
              <span className="text-zinc-600 text-xs">→</span>
              <span className="text-zinc-400 text-xs">
                {p.suggested_match.name ?? incomingName(p.suggested_match, t('merge.unnamed'))}
                {p.suggested_match.birth_year ? ` *${p.suggested_match.birth_year}` : ''}
              </span>
              {p.suggested_match.match_source === 'family' && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-brand-500/15 text-brand-400 font-medium">{t('merge.viaFamily')}</span>
              )}
            </>
          )}
          {isConfirmed && (
            <span className="text-xs text-emerald-500 font-medium">{t('merge.confirmed')}</span>
          )}
          {isConflict && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 font-medium">{t('merge.checkMatch')}</span>
          )}
        </div>
        {familyLine && (
          <p className="text-xs text-zinc-600 mt-0.5">{familyLine}</p>
        )}
        {decision.action === 'merge' && newFieldCount > 0 && (
          <p className="text-xs text-zinc-500 mt-0.5">{t('merge.willFill', { fields: newFieldNames })}</p>
        )}
        {decision.action === 'merge' && newFieldCount === 0 && (
          <p className="text-xs text-zinc-600 mt-0.5">{t('merge.alreadyComplete')}</p>
        )}
        {decision.action === 'create' && isConflict && (
          <p className="text-xs text-amber-600 mt-0.5">{t('merge.conflictDefaultNew')}</p>
        )}
        {decision.action === 'create' && !isConflict && (
          <p className="text-xs text-zinc-500 mt-0.5">{t('merge.addAsNew')}</p>
        )}
      </div>
      <ActionPill current={decision.action} hasSuggestion={!!p.suggested_match} onChange={onActionChange} />
    </div>
  )
}

function NewPersonRow({ person: p, decision, onToggle }: {
  person: MergePersonEntry
  decision: LocalDecision
  onToggle: () => void
}) {
  const t = useT()
  const included = decision.action !== 'skip'
  return (
    <label className={`flex items-center gap-3 px-3 py-2.5 rounded-lg bg-zinc-800/40 border cursor-pointer transition-opacity ${included ? 'border-zinc-700/50' : 'border-zinc-800 opacity-40'}`}>
      <input
        type="checkbox"
        checked={included}
        onChange={onToggle}
        className="w-3.5 h-3.5 rounded accent-brand-500 shrink-0"
      />
      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-zinc-100">{incomingName(p, t('merge.unnamed'))}</span>
        <span className="text-zinc-500 text-xs">{yearsStr(p.birth_year, p.death_year)}</span>
        {p.occupation && <span className="text-zinc-600 text-xs">{p.occupation}</span>}
        {p.birth_place && <span className="text-zinc-600 text-xs">{p.birth_place}</span>}
      </div>
    </label>
  )
}

function ToggleRow({ checked, onChange, label, sublabel }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; sublabel?: string
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm text-zinc-200">{label}</p>
        {sublabel && <p className="text-xs text-zinc-500 mt-0.5">{sublabel}</p>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? 'bg-brand-500' : 'bg-zinc-700'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </button>
    </div>
  )
}

function RadioRow({ value, current, onChange, label, sublabel }: {
  value: string; current: string; onChange: (v: string) => void; label: string; sublabel?: string
}) {
  const active = value === current
  return (
    <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${active ? 'border-brand-500/50 bg-brand-500/5' : 'border-zinc-700/50 hover:border-zinc-600'}`}>
      <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${active ? 'border-brand-400' : 'border-zinc-600'}`}>
        {active && <div className="w-1.5 h-1.5 rounded-full bg-brand-400" />}
      </div>
      <input type="radio" value={value} checked={active} onChange={() => onChange(value)} className="hidden" />
      <div>
        <p className="text-sm text-zinc-200">{label}</p>
        {sublabel && <p className="text-xs text-zinc-500 mt-0.5">{sublabel}</p>}
      </div>
    </label>
  )
}

function SummaryLine({ icon, color, text }: { icon: string; color: string; text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`w-4 text-center font-bold shrink-0 ${color}`}>{icon}</span>
      <span className="text-zinc-300">{text}</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
  onDone: () => void
}

export default function MergeModal({ onClose, onDone }: Props) {
  const t = useT()
  const backdrop = useBackdropClose(onClose)
  const [step, setStep]         = useState<Step>('upload')
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [preview, setPreview]   = useState<MergePreviewResponse | null>(null)
  const [decisions, setDecisions] = useState<Decisions>({})
  const [options, setOptions]   = useState<MergeOptions>({
    include_documents: true,
    include_events: true,
    include_sources: true,
    merge_strategy: 'fill_missing',
    include_images: true,
  })
  const [executing, setExecuting] = useState(false)
  const [stats, setStats]       = useState<MergeStats | null>(null)
  const [rollbackState, setRollbackState] = useState<'idle' | 'pending' | 'done' | 'error'>('idle')
  const [dragOver, setDragOver] = useState(false)
  const [openSections, setOpenSections] = useState({ matched: true, uncertain: true, newp: true })
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setAnalyzing(true)
    setError(null)
    try {
      const data = await api.project.previewMerge(file)
      setPreview(data)
      const dec: Decisions = {}
      for (const p of data.persons) {
        dec[p.incoming_id] = { action: p.action, merge_with_id: p.merge_with_id }
      }
      setDecisions(dec)
      setStep('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAnalyzing(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function setDecisionAction(incoming_id: number, action: MergeAction) {
    setDecisions(prev => ({
      ...prev,
      [incoming_id]: {
        action,
        merge_with_id: action === 'merge'
          ? (preview?.persons.find(p => p.incoming_id === incoming_id)?.merge_with_id ?? null)
          : null,
      },
    }))
  }

  async function handleExecute() {
    if (!preview) return
    setExecuting(true)
    setError(null)
    try {
      const decs: MergeDecision[] = preview.persons.map(p => ({
        incoming_id:   p.incoming_id,
        action:        decisions[p.incoming_id]?.action ?? 'skip',
        merge_with_id: decisions[p.incoming_id]?.merge_with_id ?? null,
      }))
      const result = await api.project.confirmMerge(preview.token, decs, options)
      setStats(result)
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setExecuting(false)
    }
  }

  // Person groups
  const matched   = preview?.persons.filter(p => p.suggested_match && p.suggested_match.confidence !== 'low') ?? []
  const uncertain = preview?.persons.filter(p => p.suggested_match?.confidence === 'low') ?? []
  const newP      = preview?.persons.filter(p => !p.suggested_match) ?? []

  const counts = {
    create: Object.values(decisions).filter(d => d.action === 'create').length,
    merge:  Object.values(decisions).filter(d => d.action === 'merge').length,
    skip:   Object.values(decisions).filter(d => d.action === 'skip').length,
  }

  const prevStep = (): Step =>
    step === 'options' ? 'review' : step === 'confirm' ? 'options' : 'upload'

  return (
    <div
      className="fixed inset-0 z-[500] flex items-start justify-center pt-[5vh] bg-black/70 backdrop-blur-sm p-4"
      {...backdrop}
    >
      <div
        className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl flex flex-col"
        style={{ width: 660, maxWidth: '96vw', maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 pt-5 pb-4 border-b border-zinc-800">
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold mb-0.5">{t('merge.importLabel')}</p>
            <h2 className="text-sm font-semibold text-zinc-100">{t('merge.heading')}</h2>
          </div>
          <div className="flex items-center gap-4">
            {step !== 'upload' && step !== 'done' && <StepDots step={step} />}
            <button onClick={onClose} className="w-7 h-7 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* ── UPLOAD ──────────────────────────────────────────────────── */}
          {step === 'upload' && (
            <div className="px-6 py-8">
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => !analyzing && fileInputRef.current?.click()}
                className={[
                  'flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed py-16 cursor-pointer transition-colors select-none',
                  dragOver ? 'border-brand-400 bg-brand-500/5' : 'border-zinc-700 hover:border-zinc-500',
                ].join(' ')}
              >
                {analyzing ? (
                  <>
                    <svg className="w-8 h-8 animate-spin text-brand-400" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    <p className="text-sm text-zinc-400">{t('merge.analyzing')}</p>
                  </>
                ) : (
                  <>
                    <svg className="w-10 h-10 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    <div className="text-center">
                      <p className="text-sm font-medium text-zinc-300">{t('merge.dropZone')}</p>
                      <p className="text-xs text-zinc-500 mt-1">{t('merge.clickBrowse')}</p>
                    </div>
                  </>
                )}
                <input ref={fileInputRef} type="file" accept=".zip" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
              </div>
              {error && (
                <p className="mt-4 text-xs text-red-400 bg-red-950/50 border border-red-900/50 rounded-lg px-3 py-2">{error}</p>
              )}
              <p className="mt-4 text-xs text-zinc-600 text-center leading-relaxed">
                {t('merge.acceptsZip')}
              </p>
            </div>
          )}

          {/* ── REVIEW ──────────────────────────────────────────────────── */}
          {step === 'review' && preview && (
            <div className="px-6 py-5 space-y-5">
              {/* Summary chips */}
              <div className="flex flex-wrap gap-2">
                <Chip color="green" count={counts.create} label={t('merge.chipNew')} />
                <Chip color="blue"  count={counts.merge}  label={t('merge.chipMatched')} />
                {uncertain.length > 0 && <Chip color="yellow" count={uncertain.length} label={t('merge.chipUncertain')} />}
                {counts.skip > 0 && <Chip color="gray" count={counts.skip} label={t('merge.chipSkipped')} />}
              </div>

              {/* Matched */}
              {matched.length > 0 && (
                <div>
                  <SectionHeader
                    title={t('merge.sectionMatched', { n: matched.length })} color="blue"
                    open={openSections.matched}
                    onToggle={() => setOpenSections(s => ({ ...s, matched: !s.matched }))}
                  />
                  {openSections.matched && (
                    <div className="mt-2 space-y-1.5">
                      {matched.map(p => (
                        <MatchedPersonRow
                          key={p.incoming_id} person={p}
                          decision={decisions[p.incoming_id] ?? { action: p.action, merge_with_id: p.merge_with_id }}
                          onActionChange={a => setDecisionAction(p.incoming_id, a)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Uncertain / conflicts — shown before New so conflicts are hard to miss */}
              {uncertain.length > 0 && (
                <div>
                  <SectionHeader
                    title={t('merge.sectionUncertain', { n: uncertain.length })} color="yellow"
                    open={openSections.uncertain}
                    onToggle={() => setOpenSections(s => ({ ...s, uncertain: !s.uncertain }))}
                  />
                  {openSections.uncertain && (
                    <div className="mt-2 space-y-1.5">
                      {uncertain.map(p => (
                        <MatchedPersonRow
                          key={p.incoming_id} person={p}
                          decision={decisions[p.incoming_id] ?? { action: p.action, merge_with_id: p.merge_with_id }}
                          onActionChange={a => setDecisionAction(p.incoming_id, a)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* New persons */}
              {newP.length > 0 && (
                <div>
                  <SectionHeader
                    title={t('merge.sectionNew', { n: newP.length })} color="green"
                    open={openSections.newp}
                    onToggle={() => setOpenSections(s => ({ ...s, newp: !s.newp }))}
                  />
                  {openSections.newp && (
                    <div className="mt-2 space-y-1.5">
                      {newP.map(p => (
                        <NewPersonRow
                          key={p.incoming_id} person={p}
                          decision={decisions[p.incoming_id] ?? { action: 'create', merge_with_id: null }}
                          onToggle={() => setDecisionAction(p.incoming_id,
                            decisions[p.incoming_id]?.action === 'skip' ? 'create' : 'skip')}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── OPTIONS ─────────────────────────────────────────────────── */}
          {step === 'options' && (
            <div className="px-6 py-6 space-y-6">
              <div>
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">{t('merge.optImportContent')}</p>
                <div className="space-y-4">
                  <ToggleRow
                    checked={options.include_documents}
                    onChange={v => setOptions(o => ({ ...o, include_documents: v }))}
                    label={t('gedcom.documents')}
                    sublabel={t('merge.countFiles', { n: preview?.documents_count ?? 0 })}
                  />
                  <ToggleRow
                    checked={options.include_events}
                    onChange={v => setOptions(o => ({ ...o, include_events: v }))}
                    label={t('gedcom.events')}
                    sublabel={t('merge.countEvents', { n: preview?.events_count ?? 0 })}
                  />
                  <ToggleRow
                    checked={options.include_sources}
                    onChange={v => setOptions(o => ({ ...o, include_sources: v }))}
                    label={t('gedcom.sources')}
                    sublabel={t('merge.countSources', { n: preview?.sources_count ?? 0 })}
                  />
                  <ToggleRow
                    checked={options.include_images}
                    onChange={v => setOptions(o => ({ ...o, include_images: v }))}
                    label={t('export.sectionPhotos')}
                    sublabel={t('merge.countImagesAndClusters', { images: String(preview?.images_count ?? 0), clusters: String(preview?.clusters_count ?? 0) })}
                  />
                  {(preview?.notes_count ?? 0) > 0 && (
                    <p className="text-xs text-zinc-500 pt-1">
                      {t('merge.optNotesAlways', { n: preview?.notes_count ?? 0 })}
                    </p>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">{t('merge.optStrategy')}</p>
                <div className="space-y-2">
                  <RadioRow
                    value="fill_missing" current={options.merge_strategy}
                    onChange={v => setOptions(o => ({ ...o, merge_strategy: v as MergeOptions['merge_strategy'] }))}
                    label={t('merge.stratFillMissing')}
                    sublabel={t('merge.stratFillMissingDesc')}
                  />
                  <RadioRow
                    value="incoming_priority" current={options.merge_strategy}
                    onChange={v => setOptions(o => ({ ...o, merge_strategy: v as MergeOptions['merge_strategy'] }))}
                    label={t('merge.stratIncoming')}
                    sublabel={t('merge.stratIncomingDesc')}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── CONFIRM ─────────────────────────────────────────────────── */}
          {step === 'confirm' && preview && (
            <div className="px-6 py-6 space-y-5">
              <div className="bg-zinc-800/50 rounded-xl p-4 space-y-2">
                {counts.create > 0 && (
                  <SummaryLine icon="+" color="text-emerald-400"
                    text={t('merge.summaryNew', { n: counts.create })} />
                )}
                {counts.merge > 0 && (
                  <SummaryLine icon="↔" color="text-blue-400"
                    text={t('merge.summaryMerged', { n: counts.merge })} />
                )}
                {counts.skip > 0 && (
                  <SummaryLine icon="–" color="text-zinc-500"
                    text={t('merge.summarySkipped', { n: counts.skip })} />
                )}
                {preview.relations_count > 0 && (
                  <SummaryLine icon="~" color="text-zinc-500"
                    text={t('merge.summaryRelations', { n: preview.relations_count })} />
                )}
                {options.include_events && preview.events_count > 0 && (
                  <SummaryLine icon="~" color="text-zinc-500"
                    text={t('merge.summaryEvents', { n: preview.events_count })} />
                )}
                {options.include_documents && preview.documents_count > 0 && (
                  <SummaryLine icon="~" color="text-zinc-500"
                    text={t('merge.summaryDocuments', { n: preview.documents_count })} />
                )}
                {(preview.notes_count ?? 0) > 0 && (
                  <SummaryLine icon="~" color="text-zinc-500"
                    text={t('merge.summaryNotes', { n: preview.notes_count ?? 0 })} />
                )}
                {options.include_sources && (preview.sources_count ?? 0) > 0 && (
                  <SummaryLine icon="~" color="text-zinc-500"
                    text={t('merge.summarySources', { n: preview.sources_count ?? 0 })} />
                )}
                {options.include_images && (preview.images_count ?? 0) > 0 && (
                  <SummaryLine icon="~" color="text-zinc-500"
                    text={t('merge.summaryPhotos', { n: preview.images_count ?? 0, clusters: String(preview.clusters_count ?? 0) })} />
                )}
              </div>
              <p className="text-xs text-zinc-600 leading-relaxed">
                {t('merge.txNote')}
              </p>
              {error && (
                <p className="text-xs text-red-400 bg-red-950/50 border border-red-900/50 rounded-lg px-3 py-2">{error}</p>
              )}
            </div>
          )}

          {/* ── DONE ────────────────────────────────────────────────────── */}
          {step === 'done' && stats && (
            <div className="px-6 py-10 flex flex-col items-center gap-4 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-100">{t('merge.done')}</p>
                <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
                  {t('merge.statsLine', { created: String(stats.persons_created), merged: String(stats.persons_merged), skipped: String(stats.persons_skipped) })}
                  {stats.relations_added > 0 ? ` · ${stats.relations_added} ${t('merge.statsRelations')}` : ''}
                  {stats.events_added > 0 ? ` · ${stats.events_added} ${t('merge.statsEvents')}` : ''}
                  {stats.documents_added > 0 ? ` · ${stats.documents_added} ${t('merge.statsDocs')}` : ''}
                  {(stats.sources_added ?? 0) > 0 ? ` · ${stats.sources_added} ${t('merge.statsSources')}` : ''}
                  {(stats.images_imported ?? 0) > 0 ? ` · ${stats.images_imported} ${t('merge.statsPhotos')}` : ''}
                  {(stats.clusters_linked ?? 0) > 0 ? ` · ${stats.clusters_linked} ${t('merge.statsClusters')}` : ''}
                </p>
              </div>
              {stats.rollback_available && rollbackState !== 'done' && (
                <button
                  onClick={async () => {
                    setRollbackState('pending')
                    try {
                      await api.project.rollbackMerge()
                      setRollbackState('done')
                    } catch {
                      setRollbackState('error')
                    }
                  }}
                  disabled={rollbackState === 'pending'}
                  className="mt-2 px-4 py-1.5 text-xs text-amber-400 border border-amber-800/60 rounded-lg hover:bg-amber-950/40 disabled:opacity-50 transition-colors"
                >
                  {rollbackState === 'pending' ? t('merge.undoing') : rollbackState === 'error' ? t('merge.undoFailed') : t('merge.undo')}
                </button>
              )}
              {rollbackState === 'done' && (
                <p className="text-xs text-zinc-500">{t('merge.undoDone')}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-zinc-800">
          {step === 'upload' || step === 'done' ? (
            <div />
          ) : (
            <button
              onClick={() => setStep(prevStep())}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M15 19l-7-7 7-7" />
              </svg>
              {t('merge.back')}
            </button>
          )}

          {step === 'review' && (
            <button onClick={() => setStep('options')}
              className="px-5 py-2 bg-brand-500 hover:bg-brand-400 text-white text-xs font-semibold rounded-lg transition-colors">
              {t('merge.optionsBtn')}
            </button>
          )}
          {step === 'options' && (
            <button onClick={() => setStep('confirm')}
              className="px-5 py-2 bg-brand-500 hover:bg-brand-400 text-white text-xs font-semibold rounded-lg transition-colors">
              {t('merge.reviewSummary')}
            </button>
          )}
          {step === 'confirm' && (
            <button onClick={handleExecute} disabled={executing}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-2">
              {executing && (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              )}
              {executing ? t('merge.merging') : t('merge.execute')}
            </button>
          )}
          {step === 'done' && (
            <button onClick={() => { onDone(); onClose() }}
              className="px-5 py-2 bg-brand-500 hover:bg-brand-400 text-white text-xs font-semibold rounded-lg transition-colors">
              {t('merge.btnDone')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

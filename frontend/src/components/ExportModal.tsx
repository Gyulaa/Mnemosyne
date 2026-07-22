import { useState, useMemo } from 'react'
import type { PersonFull } from '../types'
import { useT } from '../SettingsContext'

export type ExportSettings = {
  name: string
  includeGenealogy: boolean
  includeFaceless: boolean
  excludeLiving: boolean
  includeNotes: boolean
  includeSources: boolean
  includeEvents: boolean
  includeDocuments: boolean
  includeImages: boolean
}

type Props = {
  defaultName: string
  clusterCount?: number
  subtitle?: string
  hideGenealogyOption?: boolean
  showFacelessOption?: boolean
  persons?: PersonFull[]
  onExport: (settings: ExportSettings) => void
  onClose: () => void
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      } ${checked && !disabled ? 'bg-brand-500' : 'bg-zinc-600'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  )
}

function Row({
  label,
  desc,
  checked,
  onChange,
  indent,
  disabled,
}: {
  label: string
  desc?: string
  checked: boolean
  onChange: (v: boolean) => void
  indent?: boolean
  disabled?: boolean
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 py-2 ${indent ? 'pl-4 border-l border-zinc-700/60' : ''} ${disabled ? 'opacity-40' : ''}`}
    >
      <div className="min-w-0">
        <p className="text-sm text-zinc-200 leading-snug">{label}</p>
        {desc && <p className="text-xs text-zinc-500 mt-0.5 leading-snug">{desc}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-1 mt-4 first:mt-0">
      {children}
    </p>
  )
}

function isLiving(p: PersonFull) {
  return p.death_year == null && p.death_date == null
}

export default function ExportModal({
  defaultName,
  clusterCount,
  subtitle,
  hideGenealogyOption,
  showFacelessOption,
  persons,
  onExport,
  onClose,
}: Props) {
  const t = useT()
  const [name, setName] = useState(defaultName)
  const [includeGenealogy, setIncludeGenealogy] = useState(true)
  const [includeNotes, setIncludeNotes] = useState(true)
  const [includeSources, setIncludeSources] = useState(true)
  const [includeEvents, setIncludeEvents] = useState(true)
  const [includeDocuments, setIncludeDocuments] = useState(true)
  const [includeImages, setIncludeImages] = useState(true)
  const [includeFaceless, setIncludeFaceless] = useState(true)
  const [excludeLiving, setExcludeLiving] = useState(false)

  const { livingCount, deceasedCount } = useMemo(() => {
    if (!persons) return { livingCount: 0, deceasedCount: 0 }
    const living = persons.filter(isLiving).length
    return { livingCount: living, deceasedCount: persons.length - living }
  }, [persons])

  const showExcludeLivingOption = livingCount > 0 && deceasedCount > 0
  const showGenealogy = !hideGenealogyOption

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onExport({
      name: name.trim() || defaultName,
      includeGenealogy: showGenealogy ? includeGenealogy : true,
      includeFaceless: showFacelessOption ? includeFaceless : true,
      excludeLiving: showExcludeLivingOption ? excludeLiving : false,
      includeNotes: !showGenealogy || includeGenealogy ? includeNotes : true,
      includeSources: !showGenealogy || includeGenealogy ? includeSources : true,
      includeEvents: !showGenealogy || includeGenealogy ? includeEvents : true,
      includeDocuments: !showGenealogy || includeGenealogy ? includeDocuments : true,
      includeImages,
    })
  }

  const subtitleText =
    subtitle ?? (clusterCount != null ? t(clusterCount !== 1 ? 'export.clusterPlural' : 'export.clusterSingle', { n: clusterCount }) : null)

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-zinc-100 mb-0.5">{t('export.title')}</h2>
        {subtitleText && <p className="text-xs text-zinc-500 mb-1">{subtitleText}</p>}

        <div className="mt-4 space-y-0.5">
          {/* Archive name */}
          <SectionLabel>{t('export.sectionArchive')}</SectionLabel>
          <div className="pb-1">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={defaultName}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-brand-400 mt-1"
            />
          </div>

          {/* Genealogy */}
          <SectionLabel>{t('export.sectionGenealogy')}</SectionLabel>
          {showGenealogy && (
            <Row
              label={t('export.includeTree')}
              desc={t('export.includeTreeDesc')}
              checked={includeGenealogy}
              onChange={setIncludeGenealogy}
            />
          )}
          <div className={`space-y-0 ${!showGenealogy || includeGenealogy ? '' : 'opacity-40 pointer-events-none'}`}>
            <Row label={t('export.notes')} indent={showGenealogy} checked={includeNotes} onChange={setIncludeNotes} disabled={showGenealogy && !includeGenealogy} />
            <Row label={t('export.sources')} indent={showGenealogy} checked={includeSources} onChange={setIncludeSources} disabled={showGenealogy && !includeGenealogy} />
            <Row label={t('export.events')} indent={showGenealogy} checked={includeEvents} onChange={setIncludeEvents} disabled={showGenealogy && !includeGenealogy} />
            <Row label={t('export.documents')} indent={showGenealogy} checked={includeDocuments} onChange={setIncludeDocuments} disabled={showGenealogy && !includeGenealogy} />
          </div>

          {/* Photos */}
          <SectionLabel>{t('export.sectionPhotos')}</SectionLabel>
          <Row
            label={t('export.includePhotos')}
            desc={t('export.includePhotosDesc')}
            checked={includeImages}
            onChange={setIncludeImages}
          />
          {showFacelessOption && (
            <Row
              label={t('export.includeFaceless')}
              desc={t('export.includeFacelessDesc')}
              indent
              checked={includeFaceless}
              onChange={setIncludeFaceless}
              disabled={!includeImages}
            />
          )}

          {/* Privacy */}
          {showExcludeLivingOption && (
            <>
              <SectionLabel>{t('export.sectionPrivacy')}</SectionLabel>
              <Row
                label={t('export.excludeLiving')}
                desc={t('export.excludeLivingDesc', { living: livingCount, deceased: deceasedCount })}
                checked={excludeLiving}
                onChange={setExcludeLiving}
              />
            </>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
          >
            {t('export.cancel')}
          </button>
          <button
            type="submit"
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-brand-500 hover:bg-brand-400 rounded-lg transition-colors"
          >
            {t('export.export')}
          </button>
        </div>
      </form>
    </div>
  )
}

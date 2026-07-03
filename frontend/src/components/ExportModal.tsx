import { useState, useMemo } from 'react'
import type { PersonFull } from '../types'

export type ExportSettings = {
  name: string
  includeGenealogy: boolean
  includeFaceless: boolean
  excludeLiving: boolean
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

function isLiving(p: PersonFull) {
  return p.death_year == null && p.death_date == null
}

export default function ExportModal({ defaultName, clusterCount, subtitle, hideGenealogyOption, showFacelessOption, persons, onExport, onClose }: Props) {
  const [name, setName] = useState(defaultName)
  const [includeGenealogy, setIncludeGenealogy] = useState(true)
  const [includeFaceless, setIncludeFaceless] = useState(true)
  const [excludeLiving, setExcludeLiving] = useState(false)

  const { livingCount, deceasedCount } = useMemo(() => {
    if (!persons) return { livingCount: 0, deceasedCount: 0 }
    const living = persons.filter(isLiving).length
    return { livingCount: living, deceasedCount: persons.length - living }
  }, [persons])

  const showExcludeLivingOption = livingCount > 0 && deceasedCount > 0

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onExport({
      name: name.trim() || defaultName,
      includeGenealogy: hideGenealogyOption ? true : includeGenealogy,
      includeFaceless: showFacelessOption ? includeFaceless : true,
      excludeLiving: showExcludeLivingOption ? excludeLiving : false,
    })
  }

  const subtitleText = subtitle ?? (clusterCount != null ? `${clusterCount} cluster${clusterCount !== 1 ? 's' : ''} selected` : null)

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
        <h2 className="text-sm font-semibold text-zinc-100 mb-1">Export settings</h2>
        {subtitleText && (
          <p className="text-xs text-zinc-500 mb-4">{subtitleText}</p>
        )}

        <div className="space-y-4 mt-4">
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Collection name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-brand-400"
            />
          </div>

          {!hideGenealogyOption && (
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeGenealogy}
                onChange={e => setIncludeGenealogy(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-brand-500 shrink-0"
              />
              <div>
                <p className="text-sm text-zinc-200">Include genealogy data</p>
                <p className="text-xs text-zinc-500">Family tree relationships between persons</p>
              </div>
            </label>
          )}

          {showFacelessOption && (
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeFaceless}
                onChange={e => setIncludeFaceless(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-brand-500 shrink-0"
              />
              <div>
                <p className="text-sm text-zinc-200">Include images without faces</p>
                <p className="text-xs text-zinc-500">Photos where no face was detected</p>
              </div>
            </label>
          )}

          {showExcludeLivingOption && (
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={excludeLiving}
                onChange={e => setExcludeLiving(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-brand-500 shrink-0"
              />
              <div>
                <p className="text-sm text-zinc-200">Exclude living persons</p>
                <p className="text-xs text-zinc-500">{livingCount} living · {deceasedCount} deceased in this export</p>
              </div>
            </label>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-brand-500 hover:bg-brand-400 rounded-lg transition-colors"
          >
            Export
          </button>
        </div>
      </form>
    </div>
  )
}

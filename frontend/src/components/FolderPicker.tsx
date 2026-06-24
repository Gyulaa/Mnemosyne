import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { FsItem } from '../types'

interface Props {
  value: string
  onChange: (path: string) => void
}

export default function FolderPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="D:\Photos\Family"
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-brand-400 transition-colors"
        />
        <button
          onClick={() => setOpen(true)}
          className="px-3 py-2.5 bg-zinc-800 border border-zinc-700 hover:border-zinc-500 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors text-base"
          title="Browse folders"
        >
          📁
        </button>
      </div>

      {open && (
        <FsBrowserModal
          initialPath={value}
          onSelect={p => { onChange(p); setOpen(false) }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function FsBrowserModal({
  initialPath,
  onSelect,
  onClose,
}: {
  initialPath: string
  onSelect: (path: string) => void
  onClose: () => void
}) {
  const [path, setPath] = useState(initialPath)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['fs', path],
    queryFn: () => api.fs.list(path),
    retry: false,
    staleTime: 15_000,
  })

  const navigate = (item: FsItem) => setPath(item.path)

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg flex flex-col shadow-2xl"
        style={{ maxHeight: '70vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <button
            onClick={() => data?.parent != null ? setPath(data.parent) : setPath('')}
            disabled={!path}
            className="px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 transition-colors"
          >
            ← Up
          </button>
          <span className="flex-1 text-xs font-mono text-zinc-400 truncate min-w-0">
            {path || 'My Computer'}
          </span>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 text-lg leading-none p-1 rounded hover:bg-zinc-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Listing */}
        <div className="overflow-y-auto flex-1 p-2">
          {isLoading && (
            <p className="text-center text-zinc-600 py-10 text-sm">Loading…</p>
          )}
          {isError && (
            <div className="text-center py-10 space-y-2">
              <p className="text-red-400 text-sm">Cannot read directory</p>
              <button
                onClick={() => setPath('')}
                className="text-xs text-zinc-500 hover:text-zinc-300 underline"
              >
                Go to My Computer
              </button>
            </div>
          )}
          {!isLoading && !isError && data?.items.length === 0 && (
            <p className="text-center text-zinc-600 py-10 text-sm">No subdirectories</p>
          )}
          {data?.items.map(item => (
            <button
              key={item.path}
              onClick={() => navigate(item)}
              className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800 transition-colors group"
            >
              <span className="text-base flex-shrink-0">{item.is_drive ? '💾' : '📁'}</span>
              <span className="text-sm text-zinc-200 group-hover:text-white font-mono truncate">
                {item.name}
              </span>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800 gap-3">
          <span className="text-xs text-zinc-500 font-mono truncate min-w-0">
            {path || 'Select a drive'}
          </span>
          <button
            onClick={() => path && onSelect(path)}
            disabled={!path}
            className="flex-shrink-0 px-4 py-1.5 bg-brand-500 hover:bg-brand-400 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
          >
            Select folder
          </button>
        </div>
      </div>
    </div>
  )
}

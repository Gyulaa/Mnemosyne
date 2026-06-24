import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'

export default function ProjectSwitcher() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: api.project.list,
    staleTime: 10_000,
  })
  const active = projects.find(p => p.is_active)

  // Close dropdown on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setCreating(false)
        setRenamingId(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const switchMut = useMutation({
    mutationFn: (id: string) => api.project.activate(id),
    onSuccess: () => {
      setOpen(false)
      // Invalidate everything — new project has different data
      qc.invalidateQueries()
    },
  })

  const createMut = useMutation({
    mutationFn: (name: string) => api.project.create(name),
    onSuccess: () => {
      setCreating(false)
      setNewName('')
      setOpen(false)
      qc.invalidateQueries()
    },
  })

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.project.rename(id, name),
    onSuccess: () => {
      setRenamingId(null)
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.project.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (newName.trim()) createMut.mutate(newName.trim())
  }

  function handleRename(e: React.FormEvent) {
    e.preventDefault()
    if (renamingId && renameVal.trim()) {
      renameMut.mutate({ id: renamingId, name: renameVal.trim() })
    }
  }

  function startRename(id: string, currentName: string) {
    setRenamingId(id)
    setRenameVal(currentName)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(o => !o); setCreating(false); setRenamingId(null) }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors text-sm text-zinc-200"
      >
        <svg className="w-3.5 h-3.5 text-zinc-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
        </svg>
        <span className="max-w-32 truncate">{active?.name ?? 'Projects'}</span>
        <svg className="w-3 h-3 text-zinc-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-72 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Project list */}
          <div className="p-1.5 max-h-72 overflow-y-auto">
            {projects.length === 0 && (
              <p className="px-3 py-2 text-xs text-zinc-500">No projects yet</p>
            )}
            {projects.map(p => (
              <div key={p.id}>
                {renamingId === p.id ? (
                  <form onSubmit={handleRename} className="flex gap-1.5 px-2 py-1.5">
                    <input
                      autoFocus
                      value={renameVal}
                      onChange={e => setRenameVal(e.target.value)}
                      className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="submit"
                      disabled={!renameVal.trim() || renameMut.isPending}
                      className="px-2 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs rounded"
                    >
                      OK
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                      className="px-2 py-1 text-zinc-500 hover:text-zinc-300 text-xs"
                    >
                      ✕
                    </button>
                  </form>
                ) : (
                  <div className={`group flex items-center gap-1 px-2 py-1.5 rounded-lg ${
                    p.is_active ? 'bg-blue-600/15' : 'hover:bg-zinc-800'
                  }`}>
                    <button
                      className="flex-1 flex items-center gap-2 text-left text-sm min-w-0"
                      onClick={() => !p.is_active && switchMut.mutate(p.id)}
                      disabled={p.is_active || switchMut.isPending}
                    >
                      <span className={`truncate ${p.is_active ? 'text-blue-300 font-medium' : 'text-zinc-300'}`}>
                        {p.name}
                      </span>
                      {p.is_active && (
                        <span className="shrink-0 text-xs text-blue-500 font-medium">active</span>
                      )}
                    </button>
                    <div className="hidden group-hover:flex items-center gap-0.5">
                      <button
                        onClick={() => startRename(p.id, p.name)}
                        title="Rename"
                        className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors rounded"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2.414a2 2 0 01.586-1.414z" />
                        </svg>
                      </button>
                      {!p.is_active && (
                        <button
                          onClick={() => {
                            if (confirm(`Delete project "${p.name}"? This cannot be undone.`))
                              deleteMut.mutate(p.id)
                          }}
                          title="Delete"
                          className="p-1 text-zinc-600 hover:text-red-400 transition-colors rounded"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0a2 2 0 012-2h4a2 2 0 012 2M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Create project */}
          <div className="border-t border-zinc-800 p-2">
            {creating ? (
              <form onSubmit={handleCreate} className="flex gap-1.5">
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Project name…"
                  autoFocus
                  className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  disabled={!newName.trim() || createMut.isPending}
                  className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs rounded-lg transition-colors"
                >
                  {createMut.isPending ? '…' : 'Create'}
                </button>
              </form>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="w-full px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors text-left flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New project
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

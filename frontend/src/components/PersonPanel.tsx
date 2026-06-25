import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { PersonFull, Relation, ImageItem } from '../types'

// ── Lightbox ──────────────────────────────────────────────────────────────────

function Lightbox({ images, idx, onClose, onChange }: {
  images: ImageItem[]
  idx: number
  onClose: () => void
  onChange: (i: number) => void
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft')  onChange(Math.max(0, idx - 1))
      if (e.key === 'ArrowRight') onChange(Math.min(images.length - 1, idx + 1))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [idx, images.length, onClose, onChange])

  const img = images[idx]

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/95" onClick={onClose}>
      <button onClick={onClose}
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-zinc-800/80 hover:bg-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white text-lg transition-colors">✕</button>
      <button onClick={e => { e.stopPropagation(); onChange(idx - 1) }} disabled={idx === 0}
        className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-zinc-800/70 hover:bg-zinc-700 disabled:opacity-20 flex items-center justify-center text-zinc-200 text-2xl transition-colors">‹</button>
      <img src={api.imageViewUrl(img.id, 1800)} alt=""
        className="max-w-[85vw] max-h-[85vh] object-contain rounded-lg shadow-2xl" onClick={e => e.stopPropagation()} />
      <button onClick={e => { e.stopPropagation(); onChange(idx + 1) }} disabled={idx === images.length - 1}
        className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-zinc-800/70 hover:bg-zinc-700 disabled:opacity-20 flex items-center justify-center text-zinc-200 text-2xl transition-colors">›</button>
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
        <span className="text-zinc-500 text-sm tabular-nums">{idx + 1} / {images.length}</span>
        {img.exif_date && <span className="text-zinc-600 text-xs">{new Date(img.exif_date).toLocaleDateString('hu-HU')}</span>}
      </div>
    </div>
  )
}

// ── PhotoGallery ──────────────────────────────────────────────────────────────

function PhotoGallery({ images }: { images: ImageItem[] }) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  return (
    <>
      <div className="grid grid-cols-3 gap-1.5">
        {images.map((img, i) => (
          <button key={img.id} onClick={() => setLightboxIdx(i)}
            className="aspect-square rounded-lg overflow-hidden bg-zinc-800 hover:ring-2 hover:ring-brand-400 transition-all group">
            <img src={api.imageViewUrl(img.id, 360)} alt=""
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
          </button>
        ))}
      </div>
      {lightboxIdx !== null && (
        <Lightbox images={images} idx={lightboxIdx} onClose={() => setLightboxIdx(null)} onChange={setLightboxIdx} />
      )}
    </>
  )
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ person, size }: { person: PersonFull; size: number }) {
  const [err, setErr] = useState(false)
  const init = (person.name ?? '?').trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'
  if (person.thumbnail_face_id && !err) {
    return (
      <img src={api.faceThumbnailUrl(person.thumbnail_face_id, size * 2)} alt=""
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }} onError={() => setErr(true)} />
    )
  }
  return (
    <div className="rounded-full bg-zinc-700 flex items-center justify-center shrink-0 font-bold text-zinc-300"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
      {init}
    </div>
  )
}

// ── PersonPicker ──────────────────────────────────────────────────────────────

function PersonPicker({ persons, excludeIds, label, onSelect, onClose }: {
  persons: PersonFull[]
  excludeIds: Set<number>
  label: string
  onSelect: (p: PersonFull) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const filtered = persons
    .filter(p => !excludeIds.has(p.id))
    .filter(p => (p.name ?? '').toLowerCase().includes(search.toLowerCase()))
    .slice(0, 12)

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-zinc-800 border border-zinc-700 rounded-2xl shadow-2xl w-72 flex flex-col overflow-hidden"
        style={{ maxHeight: 360 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 pt-3 pb-2 border-b border-zinc-700">
          <p className="text-xs font-semibold text-zinc-300 mb-2">{label}</p>
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Keresés..."
            className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none" />
        </div>
        <div className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-4 italic">Nincs találat</p>
          ) : filtered.map(p => (
            <button key={p.id} onClick={() => { onSelect(p); onClose() }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left hover:bg-zinc-700 transition-colors">
              <Avatar person={p} size={28} />
              <span className="text-sm text-zinc-200 truncate flex-1">{p.name ?? '(névtelen)'}</span>
              {p.birth_year && <span className="text-xs text-zinc-500 shrink-0">* {p.birth_year}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── RelRow ────────────────────────────────────────────────────────────────────

type PickerMode = 'parent' | 'spouse' | 'child' | 'sibling' | null

function RelRow({
  label, persons, editing, onNavigate, onRemove, addLabel, onAdd,
}: {
  label: string
  persons: PersonFull[]
  editing: boolean
  onNavigate: (id: number) => void
  onRemove?: (p: PersonFull) => void
  addLabel: string
  onAdd: () => void
}) {
  if (!editing && persons.length === 0) return null

  return (
    <div>
      <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5 items-center">
        {persons.map(p => (
          <div key={p.id} className="inline-flex items-center group">
            <button
              onClick={() => onNavigate(p.id)}
              className="inline-flex items-center gap-1.5 pl-1.5 pr-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/60 hover:border-zinc-500 rounded-full transition-colors max-w-[160px]"
            >
              <Avatar person={p} size={20} />
              <span className="text-xs text-zinc-200 truncate leading-none">{p.name ?? '(névtelen)'}</span>
            </button>
            {editing && onRemove && (
              <button onClick={() => onRemove(p)}
                className="ml-0.5 w-4 h-4 rounded-full bg-zinc-700 hover:bg-red-700 flex items-center justify-center text-[10px] text-zinc-400 hover:text-white transition-colors shrink-0"
                title="Kapcsolat eltávolítása">✕</button>
            )}
          </div>
        ))}
        {editing && (
          <button onClick={onAdd}
            className="inline-flex items-center gap-1 h-7 px-2.5 text-xs text-zinc-500 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-dashed border-zinc-700 hover:border-zinc-500 rounded-full transition-colors shrink-0">
            + {addLabel}
          </button>
        )}
      </div>
    </div>
  )
}

// ── PersonPanel ───────────────────────────────────────────────────────────────

interface Props {
  person: PersonFull
  persons: PersonFull[]
  relations: Relation[]
  onClose: () => void
  onNavigateTo: (id: number) => void
}

export default function PersonPanel({ person, persons, relations, onClose, onNavigateTo }: Props) {
  const qc = useQueryClient()
  const [visible, setVisible] = useState(false)
  const [editingHeader, setEditingHeader] = useState(false)
  const [headerData, setHeaderData] = useState({ name: '', birth: '', death: '' })
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesVal, setNotesVal] = useState('')
  const [editingRelations, setEditingRelations] = useState(false)
  const [pickerMode, setPickerMode] = useState<PickerMode>(null)

  useEffect(() => {
    const t = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(t)
  }, [])

  const { data: imagesPage, isLoading: loadingImgs } = useQuery({
    queryKey: ['person-images', person.id],
    queryFn: () => api.images.list(1, 60, 'all', '', 'exif_date_desc', [person.id]),
    staleTime: 60_000,
  })

  const saveMut = useMutation({
    mutationFn: (patch: Parameters<typeof api.persons.update>[1]) => api.persons.update(person.id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] })
      setEditingHeader(false); setEditingNotes(false)
    },
  })

  const addRelMut = useMutation({
    mutationFn: ({ type, a, b }: { type: 'parent' | 'spouse' | 'sibling'; a: number; b: number }) =>
      api.relations.create(type, a, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['relations'] }),
  })

  const delRelMut = useMutation({
    mutationFn: (id: number) => api.relations.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['relations'] }),
  })

  const byId = new Map(persons.map(p => [p.id, p]))

  const parents = relations
    .filter(r => r.type === 'parent' && r.person_b_id === person.id)
    .map(r => byId.get(r.person_a_id)).filter(Boolean) as PersonFull[]
  const children = relations
    .filter(r => r.type === 'parent' && r.person_a_id === person.id)
    .map(r => byId.get(r.person_b_id)).filter(Boolean) as PersonFull[]
  const spouses = relations
    .filter(r => r.type === 'spouse' && (r.person_a_id === person.id || r.person_b_id === person.id))
    .map(r => byId.get(r.person_a_id === person.id ? r.person_b_id : r.person_a_id))
    .filter(Boolean) as PersonFull[]
  const siblings = relations
    .filter(r => r.type === 'sibling' && (r.person_a_id === person.id || r.person_b_id === person.id))
    .map(r => byId.get(r.person_a_id === person.id ? r.person_b_id : r.person_a_id))
    .filter(Boolean) as PersonFull[]

  const allRelatedIds = new Set([
    person.id,
    ...parents.map(p => p.id),
    ...children.map(p => p.id),
    ...spouses.map(p => p.id),
    ...siblings.map(p => p.id),
  ])

  function findRelationId(type: 'parent' | 'spouse' | 'sibling', otherPersonId: number): number | null {
    for (const r of relations) {
      if (r.type !== type) continue
      if (type === 'parent') {
        // parent: a=parent, b=child
        // removing a parent: a=other, b=current
        // removing a child: a=current, b=other
        if ((r.person_a_id === otherPersonId && r.person_b_id === person.id) ||
            (r.person_a_id === person.id && r.person_b_id === otherPersonId)) {
          return r.id
        }
      } else {
        if ((r.person_a_id === person.id && r.person_b_id === otherPersonId) ||
            (r.person_a_id === otherPersonId && r.person_b_id === person.id)) {
          return r.id
        }
      }
    }
    return null
  }

  function handleAdd(p: PersonFull) {
    if (!pickerMode) return
    switch (pickerMode) {
      case 'parent':  addRelMut.mutate({ type: 'parent',  a: p.id,      b: person.id }); break
      case 'child':   addRelMut.mutate({ type: 'parent',  a: person.id, b: p.id });      break
      case 'spouse':  addRelMut.mutate({ type: 'spouse',  a: person.id, b: p.id });      break
      case 'sibling': addRelMut.mutate({ type: 'sibling', a: person.id, b: p.id });      break
    }
  }

  function handleRemove(type: 'parent' | 'spouse' | 'sibling', other: PersonFull) {
    const rid = findRelationId(type, other.id)
    if (rid != null) delRelMut.mutate(rid)
  }

  const span = person.birth_year
    ? person.death_year ? `${person.birth_year}–${person.death_year}` : `* ${person.birth_year}`
    : null
  const images = imagesPage?.items ?? []

  function startHeaderEdit() {
    setHeaderData({ name: person.name ?? '', birth: person.birth_year ? String(person.birth_year) : '', death: person.death_year ? String(person.death_year) : '' })
    setEditingHeader(true)
  }
  function saveHeader() {
    saveMut.mutate({
      name: headerData.name.trim() || undefined,
      birth_year: headerData.birth ? parseInt(headerData.birth) : null,
      death_year: headerData.death ? parseInt(headerData.death) : null,
    })
  }

  const pickerLabels: Record<NonNullable<PickerMode>, string> = {
    parent:  'Szülő hozzáadása',
    child:   'Gyerek hozzáadása',
    spouse:  'Házastárs hozzáadása',
    sibling: 'Testvér hozzáadása',
  }

  return (
    <>
      <div className="absolute inset-0 transition-opacity duration-300"
        style={{ background: 'rgba(0,0,0,0.5)', opacity: visible ? 1 : 0 }}
        onClick={onClose} />

      <div
        className="absolute right-0 top-0 bottom-0 flex flex-col bg-zinc-900 shadow-2xl transition-transform duration-300 ease-out overflow-hidden"
        style={{ width: 440, borderLeft: '1px solid rgba(63,63,70,0.6)', transform: visible ? 'translateX(0)' : 'translateX(100%)' }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose}
          className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center text-zinc-300 hover:text-white transition-colors text-sm">✕</button>

        {/* ── Header ── */}
        <div className="shrink-0 px-5 pt-5 pb-4 border-b border-zinc-800">
          <div className="flex gap-4 items-start pr-10">
            <Avatar person={person} size={72} />
            <div className="flex-1 min-w-0 pt-0.5">
              {editingHeader ? (
                <input autoFocus value={headerData.name}
                  onChange={e => setHeaderData(d => ({ ...d, name: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && saveHeader()}
                  placeholder="Név"
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-2.5 py-1 text-base font-bold text-zinc-100 outline-none focus:border-brand-400 mb-2" />
              ) : (
                <h2 className="text-lg font-bold text-zinc-100 leading-snug">{person.name ?? '(névtelen)'}</h2>
              )}
              {editingHeader ? (
                <div className="flex items-center gap-2">
                  <input type="number" value={headerData.birth}
                    onChange={e => setHeaderData(d => ({ ...d, birth: e.target.value }))} placeholder="Szül. év"
                    className="w-24 bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-xs text-zinc-200 outline-none focus:border-brand-400" />
                  <span className="text-zinc-600">–</span>
                  <input type="number" value={headerData.death}
                    onChange={e => setHeaderData(d => ({ ...d, death: e.target.value }))} placeholder="Halál. év"
                    className="w-24 bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-xs text-zinc-200 outline-none focus:border-brand-400" />
                </div>
              ) : (
                <>
                  {span && <p className="text-sm text-zinc-400 mt-0.5">{span}</p>}
                  <p className="text-xs text-zinc-600 mt-0.5">{person.face_count > 0 ? `${person.face_count} fotó az appban` : 'Nincs fotó az appban'}</p>
                </>
              )}
            </div>
          </div>
          <div className="flex gap-2 mt-3 ml-[88px]">
            {editingHeader ? (
              <>
                <button onClick={saveHeader} disabled={saveMut.isPending}
                  className="px-3 py-1 text-xs font-medium bg-brand-500 hover:bg-brand-600 text-white rounded-lg transition-colors">Mentés</button>
                <button onClick={() => setEditingHeader(false)}
                  className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 rounded-lg transition-colors">Mégsem</button>
              </>
            ) : (
              <button onClick={startHeaderEdit}
                className="px-3 py-1 text-xs text-zinc-500 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors">Szerkesztés</button>
            )}
          </div>
        </div>

        {/* ── Scroll body ── */}
        <div className="flex-1 overflow-y-auto">

          {/* Notes */}
          <section className="px-5 py-4 border-b border-zinc-800/80">
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Megjegyzés</h3>
              {!editingNotes ? (
                <button onClick={() => { setNotesVal(person.notes ?? ''); setEditingNotes(true) }}
                  className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors">
                  {person.notes ? 'Szerkesztés' : '+ Hozzáadás'}
                </button>
              ) : (
                <div className="flex gap-3">
                  <button onClick={() => saveMut.mutate({ notes: notesVal.trim() || null })} disabled={saveMut.isPending}
                    className="text-xs text-brand-400 hover:text-brand-300 font-medium transition-colors">Mentés</button>
                  <button onClick={() => setEditingNotes(false)}
                    className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">Mégsem</button>
                </div>
              )}
            </div>
            {editingNotes ? (
              <textarea autoFocus value={notesVal} onChange={e => setNotesVal(e.target.value)} rows={3}
                placeholder="Megjegyzés a személyről..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-brand-400/60 resize-none leading-relaxed" />
            ) : person.notes ? (
              <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{person.notes}</p>
            ) : (
              <p className="text-sm text-zinc-600 italic">Nincs megjegyzés</p>
            )}
          </section>

          {/* Relations */}
          <section className="px-5 py-4 border-b border-zinc-800/80">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Kapcsolatok</h3>
              {!editingRelations ? (
                <button onClick={() => setEditingRelations(true)}
                  className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors">Szerkesztés</button>
              ) : (
                <button onClick={() => setEditingRelations(false)}
                  className="text-xs text-brand-400 hover:text-brand-300 font-medium transition-colors">Kész</button>
              )}
            </div>
            <div className="space-y-3.5">
              <RelRow
                label="Szülők"
                persons={parents}
                editing={editingRelations}
                onNavigate={onNavigateTo}
                onRemove={p => handleRemove('parent', p)}
                addLabel="Szülő"
                onAdd={() => setPickerMode('parent')}
              />
              <RelRow
                label="Házastárs / Partner"
                persons={spouses}
                editing={editingRelations}
                onNavigate={onNavigateTo}
                onRemove={p => handleRemove('spouse', p)}
                addLabel="Házastárs"
                onAdd={() => setPickerMode('spouse')}
              />
              <RelRow
                label="Gyerekek"
                persons={children}
                editing={editingRelations}
                onNavigate={onNavigateTo}
                onRemove={p => handleRemove('parent', p)}
                addLabel="Gyerek"
                onAdd={() => setPickerMode('child')}
              />
              <RelRow
                label="Testvérek"
                persons={siblings}
                editing={editingRelations}
                onNavigate={onNavigateTo}
                onRemove={p => handleRemove('sibling', p)}
                addLabel="Testvér"
                onAdd={() => setPickerMode('sibling')}
              />
              {!editingRelations && parents.length === 0 && spouses.length === 0 && children.length === 0 && siblings.length === 0 && (
                <p className="text-sm text-zinc-600 italic">Nincsenek rögzített kapcsolatok</p>
              )}
            </div>
          </section>

          {/* Photos */}
          <section className="px-5 py-4">
            <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">
              Fotók{imagesPage ? ` (${imagesPage.total})` : ''}
            </h3>
            {loadingImgs ? (
              <div className="grid grid-cols-3 gap-1.5">
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="aspect-square rounded-lg bg-zinc-800 animate-pulse" />)}
              </div>
            ) : images.length === 0 ? (
              <p className="text-sm text-zinc-600 italic">Nincs fotó</p>
            ) : (
              <>
                <PhotoGallery images={images} />
                {imagesPage && imagesPage.total > images.length && (
                  <p className="text-xs text-zinc-600 text-center mt-3">+ {imagesPage.total - images.length} további fotó</p>
                )}
              </>
            )}
          </section>

          <div className="h-8" />
        </div>
      </div>

      {pickerMode && (
        <PersonPicker
          persons={persons}
          excludeIds={allRelatedIds}
          label={pickerLabels[pickerMode]}
          onSelect={handleAdd}
          onClose={() => setPickerMode(null)}
        />
      )}
    </>
  )
}

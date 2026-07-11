import { useState, useEffect, useRef } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ScanTab from './components/ScanTab'
import ClustersTab from './components/ClustersTab'
import ConnectionsTab from './components/ConnectionsTab'
import ImagesTab from './components/ImagesTab'
import FamilyTreeTab from './components/FamilyTreeTab'
import EventsTab from './components/EventsTab'
import DocumentsTab from './components/DocumentsTab'
import ProjectSwitcher from './components/ProjectSwitcher'
import SearchPalette from './components/SearchPalette'
import DocumentViewer from './components/DocumentViewer'
import UpdateBanner from './components/UpdateBanner'
import type { PersonDocument } from './types'
import { SettingsProvider, useSettings } from './SettingsContext'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
})

type Tab = 'scan' | 'clusters' | 'images' | 'events' | 'genealogy' | 'documents' | 'connections'

const TAB_LABELS: Record<Tab, string> = {
  scan: 'Scan',
  clusters: 'Clusters',
  images: 'Images',
  events: 'Events',
  genealogy: 'Genealogy',
  documents: 'Documents',
  connections: 'Connections',
}

function AppInner() {
  const [tab, setTab] = useState<Tab>('scan')
  const [imageNavFilter, setImageNavFilter] = useState<{ personIds: number[]; key: number } | null>(null)
  const [imageOpenTarget, setImageOpenTarget] = useState<{ imageId: number; personIds: number[]; key: number } | null>(null)
  const [clusterNavTarget, setClusterNavTarget] = useState<{ clusterId: number; key: number } | null>(null)
  const [genealogyNavTarget, setGenealogyNavTarget] = useState<{ personId: number; key: number } | null>(null)
  const [eventNavTarget, setEventNavTarget] = useState<{ eventId: number; key: number } | null>(null)
  const [documentsNavTarget, setDocumentsNavTarget] = useState<{ docId: number; editMode?: boolean; key: number } | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportCancel, setExportCancel] = useState<(() => void) | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [viewingDoc, setViewingDoc] = useState<PersonDocument | null>(null)
  const [aboutOpen,    setAboutOpen]    = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const aboutRef    = useRef<HTMLDivElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const { nameOrder, setNameOrder, autoCheckUpdates, setAutoCheckUpdates } = useSettings()

  useEffect(() => {
    if (!aboutOpen) return
    const handler = (e: MouseEvent) => {
      if (aboutRef.current && !aboutRef.current.contains(e.target as Node)) setAboutOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [aboutOpen])

  useEffect(() => {
    if (!settingsOpen) return
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [settingsOpen])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(o => !o)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  function navToImages(personIds: number[]) {
    setTab('images')
    setImageNavFilter({ personIds, key: Date.now() })
  }

  function navToImage(imageId: number, personIds: number[]) {
    setTab('images')
    setImageOpenTarget({ imageId, personIds, key: Date.now() })
  }

  function navToCluster(clusterId: number) {
    setTab('clusters')
    setClusterNavTarget({ clusterId, key: Date.now() })
  }

  function navToGenealogy(personId: number) {
    setTab('genealogy')
    setGenealogyNavTarget({ personId, key: Date.now() })
  }

  function navToEvent(eventId: number) {
    setTab('events')
    setEventNavTarget({ eventId, key: Date.now() })
  }

  function navToDocument(docId: number, editMode = false) {
    setTab('documents')
    setDocumentsNavTarget({ docId, editMode, key: Date.now() })
  }

  function onExportStart(cancelFn: () => void) {
    setExportBusy(true)
    setExportError(null)
    setExportCancel(() => cancelFn)
  }

  function onExportEnd(err?: string) {
    setExportBusy(false)
    setExportCancel(null)
    if (err) setExportError(err)
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
        <header className="shrink-0 bg-zinc-900 border-b border-zinc-800 px-6 py-3 z-40 relative">
          <div className="max-w-6xl mx-auto flex items-center gap-6">
            <div className="flex items-center gap-2">
              <img
                src="/favicon.png"
                alt=""
                className="w-6 h-6 object-contain"
                onError={e => { e.currentTarget.style.display = 'none' }}
              />
              <span className="text-sm font-semibold text-zinc-100 tracking-tight">Mnemosyne</span>
            </div>
            <nav className="flex gap-1">
              {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={[
                    'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                    tab === t
                      ? 'bg-zinc-700 text-white'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800',
                  ].join(' ')}
                >
                  {TAB_LABELS[t]}
                </button>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <UpdateBanner />
              <button
                onClick={() => setSearchOpen(true)}
                title="Search (Ctrl+K)"
                className="w-8 h-8 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <circle cx="11" cy="11" r="7" />
                  <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
                </svg>
              </button>

              {/* Settings */}
              <div ref={settingsRef} className="relative">
                <button
                  onClick={() => setSettingsOpen(o => !o)}
                  title="Settings"
                  className="w-8 h-8 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
                {settingsOpen && (
                  <div className="absolute right-0 top-full mt-2 w-64 bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl p-4 z-50">
                    <p className="text-xs font-semibold text-zinc-300 mb-3">Settings</p>
                    <div>
                      <p className="text-[11px] text-zinc-500 mb-2">Name display order</p>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => setNameOrder('en')}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${nameOrder === 'en' ? 'bg-brand-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'}`}
                        >
                          Given · Family
                          <span className="block text-[10px] font-normal opacity-70">e.g. Jane Doe</span>
                        </button>
                        <button
                          onClick={() => setNameOrder('hu')}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${nameOrder === 'hu' ? 'bg-brand-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'}`}
                        >
                          Family · Given
                          <span className="block text-[10px] font-normal opacity-70">e.g. Doe Jane</span>
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-zinc-800">
                      <p className="text-[11px] text-zinc-500 mb-2">Updates</p>
                      <label className="flex items-center justify-between cursor-pointer gap-3">
                        <span className="text-xs text-zinc-300">Auto-check on startup</span>
                        <button
                          role="switch"
                          aria-checked={autoCheckUpdates}
                          onClick={() => setAutoCheckUpdates(!autoCheckUpdates)}
                          className={`inline-flex items-center rounded-full transition-colors shrink-0 ${autoCheckUpdates ? 'bg-brand-500' : 'bg-zinc-700'}`}
                          style={{ width: '32px', height: '18px' }}
                        >
                          <span
                            className="inline-block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform"
                            style={{ transform: autoCheckUpdates ? 'translateX(16px)' : 'translateX(2px)' }}
                          />
                        </button>
                      </label>
                      {!autoCheckUpdates && (
                        <p className="text-[10px] text-zinc-600 mt-1.5 leading-snug">
                          Click the cloud icon in the header to check manually.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* About */}
              <div ref={aboutRef} className="relative">
                <button
                  onClick={() => setAboutOpen(o => !o)}
                  title="About"
                  className="w-8 h-8 rounded-md flex items-center justify-center text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="9" />
                    <path strokeLinecap="round" d="M12 8h.01M12 11v5" />
                  </svg>
                </button>
                {aboutOpen && (
                  <div className="absolute right-0 top-full mt-2 w-52 bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl p-4 z-50">
                    <p className="text-sm font-semibold text-zinc-100 mb-0.5">Mnemosyne</p>
                    <p className="text-[11px] text-zinc-500 leading-relaxed">Personal photo &amp; genealogy organizer</p>
                    <div className="my-3 border-t border-zinc-800" />
                    <p className="text-xs text-zinc-400">by <span className="text-zinc-200 font-medium">Gyula Miklós</span></p>
                    <p className="text-[11px] text-zinc-600 mt-0.5">© 2026 · MIT License</p>
                  </div>
                )}
              </div>

              <ProjectSwitcher onExportStart={onExportStart} onExportEnd={onExportEnd} />
            </div>
          </div>
        </header>

        <main className={[
          'flex-1 min-h-0',
          tab === 'genealogy' ? 'overflow-hidden' : 'overflow-auto',
          tab === 'documents' ? 'overflow-hidden' : '',
        ].join(' ')}>
          {tab === 'genealogy' ? (
            <FamilyTreeTab onExportStart={onExportStart} onExportEnd={onExportEnd} navTarget={genealogyNavTarget} onNavConsumed={() => setGenealogyNavTarget(null)} onNavToEvent={navToEvent} onNavToDocument={navToDocument} />
          ) : tab === 'events' ? (
            <EventsTab navTarget={eventNavTarget} onNavConsumed={() => setEventNavTarget(null)} onExportStart={onExportStart} onExportEnd={onExportEnd} />
          ) : tab === 'documents' ? (
            <DocumentsTab onNavToGenealogy={navToGenealogy} navTarget={documentsNavTarget} onNavConsumed={() => setDocumentsNavTarget(null)} />
          ) : (
            <div className={tab === 'connections' ? 'px-4 py-4' : 'max-w-6xl mx-auto px-6 py-8'}>
              {tab === 'scan'        ? <ScanTab /> :
               tab === 'clusters'   ? <ClustersTab navTarget={clusterNavTarget} onNavToCluster={navToCluster} onNavToImage={navToImage} onNavConsumed={() => setClusterNavTarget(null)} onNavToGenealogy={navToGenealogy} onExportStart={onExportStart} onExportEnd={onExportEnd} /> :
               tab === 'images'     ? <ImagesTab navFilter={imageNavFilter} openImageTarget={imageOpenTarget} onImageTargetConsumed={() => setImageOpenTarget(null)} onNavToCluster={navToCluster} onExportStart={onExportStart} onExportEnd={onExportEnd} /> :
               <ConnectionsTab onEdgeClick={navToImages} onNodeClick={navToCluster} />}
            </div>
          )}
        </main>
      </div>

      {/* Global export progress — persists across tab switches */}
      {exportBusy && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 pl-4 pr-2 py-2 bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl text-sm text-zinc-300">
          <svg className="w-4 h-4 animate-spin text-brand-400 shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Building ZIP…
          <button
            onClick={() => exportCancel?.()}
            title="Cancel export"
            className="ml-1 w-6 h-6 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {exportError && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 bg-red-900/90 border border-red-700 rounded-xl shadow-2xl text-sm text-red-200">
          Export failed: {exportError}
          <button onClick={() => setExportError(null)} className="ml-1 underline text-red-300 hover:text-red-100">
            Dismiss
          </button>
        </div>
      )}
      <SearchPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavToGenealogy={navToGenealogy}
        onNavToEvent={navToEvent}
        onViewDocument={doc => setViewingDoc(doc)}
      />

      {viewingDoc && (
        <DocumentViewer
          doc={viewingDoc}
          onClose={() => setViewingDoc(null)}
          onNavToPerson={id => { setViewingDoc(null); navToGenealogy(id) }}
        />
      )}
    </QueryClientProvider>
  )
}

export default function App() {
  return (
    <SettingsProvider>
      <AppInner />
    </SettingsProvider>
  )
}

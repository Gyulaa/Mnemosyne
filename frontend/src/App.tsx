import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ScanTab from './components/ScanTab'
import ClustersTab from './components/ClustersTab'
import ConnectionsTab from './components/ConnectionsTab'
import ImagesTab from './components/ImagesTab'
import ProjectSwitcher from './components/ProjectSwitcher'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
})

type Tab = 'scan' | 'clusters' | 'images' | 'connections'

const TAB_LABELS: Record<Tab, string> = {
  scan: 'Scan',
  clusters: 'Clusters',
  images: 'Images',
  connections: 'Connections',
}

export default function App() {
  const [tab, setTab] = useState<Tab>('scan')
  // When navigating from Connections → Images with a person co-occurrence filter
  const [imageNavFilter, setImageNavFilter] = useState<{ personIds: number[]; key: number } | null>(null)

  function navToImages(personIds: number[]) {
    setTab('images')
    setImageNavFilter({ personIds, key: Date.now() })
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <header className="bg-zinc-900 border-b border-zinc-800 px-6 py-3 sticky top-0 z-10">
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
            <div className="ml-auto">
              <ProjectSwitcher />
            </div>
          </div>
        </header>

        <main className={tab === 'connections' ? 'px-4 py-4' : 'max-w-6xl mx-auto px-6 py-8'}>
          {tab === 'scan'        ? <ScanTab /> :
           tab === 'clusters'   ? <ClustersTab /> :
           tab === 'images'     ? <ImagesTab navFilter={imageNavFilter} /> :
           <ConnectionsTab onEdgeClick={navToImages} />}
        </main>
      </div>
    </QueryClientProvider>
  )
}

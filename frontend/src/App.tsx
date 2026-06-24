import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ScanTab from './components/ScanTab'
import ClustersTab from './components/ClustersTab'
import ProjectSwitcher from './components/ProjectSwitcher'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
})

type Tab = 'scan' | 'clusters'

export default function App() {
  const [tab, setTab] = useState<Tab>('scan')

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <header className="bg-zinc-900 border-b border-zinc-800 px-6 py-3 sticky top-0 z-10">
          <div className="max-w-6xl mx-auto flex items-center gap-6">
            <span className="text-sm font-semibold text-zinc-100 tracking-tight">
              📷 Photo Organizer
            </span>
            <nav className="flex gap-1">
              {(['scan', 'clusters'] as Tab[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={[
                    'px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize',
                    tab === t
                      ? 'bg-zinc-700 text-white'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800',
                  ].join(' ')}
                >
                  {t}
                </button>
              ))}
            </nav>
            <div className="ml-auto">
              <ProjectSwitcher />
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-6 py-8">
          {tab === 'scan' ? <ScanTab /> : <ClustersTab />}
        </main>
      </div>
    </QueryClientProvider>
  )
}

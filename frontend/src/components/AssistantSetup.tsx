import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useT } from '../SettingsContext'
import type { AiModel, AiSettings, WebResearchSettings } from '../types'

/** Not a real AI provider id — a pseudo-tab so the search provider sits in the
 *  same picker row as Anthropic/OpenAI instead of its own section the user has
 *  to scroll past a (potentially long, for OpenAI) model list to reach. */
const TAVILY_TAB = 'tavily'

/**
 * Provider, API key and model configuration.
 *
 * Keys are stored per provider, so switching between Anthropic and OpenAI does
 * not mean re-entering credentials. The key itself is write-only: the server
 * returns it masked and this component never holds the real value after saving.
 *
 * Web research (Tavily) is a second, independent opt-in — its own key, its
 * own daily quota, sent to a different destination than the AI provider above
 * — but shares the same tab row and the same "a dot on the pill means a key
 * is already stored" convention, so its configured state is never something
 * you have to infer from a password field's placeholder alone.
 */
export default function AssistantSetup({ settings, onDone }: { settings: AiSettings; onDone?: () => void }) {
  const t = useT()
  const qc = useQueryClient()

  const { data: webSettings } = useQuery<WebResearchSettings>({
    queryKey: ['ai-web-settings'],
    queryFn: api.ai.getWebSettings,
  })

  const [activeTab, setActiveTab] = useState<string>(settings.provider)
  const isTavily = activeTab === TAVILY_TAB

  const [provider, setProvider] = useState(settings.provider)
  const [key, setKey] = useState('')
  const [model, setModel] = useState(settings.model)
  const [customModel, setCustomModel] = useState('')
  const [error, setError] = useState<string | null>(null)

  // The server refreshes the list from the provider by itself when its cache is
  // stale, so simply asking for it keeps new models appearing over time.
  const { data: catalog, isFetching: loadingModels } = useQuery({
    queryKey: ['ai-models', provider],
    queryFn: () => api.ai.listModels(provider),
    enabled: !isTavily,
  })

  const refresh = useMutation({
    mutationFn: () => api.ai.listModels(provider, true),
    onSuccess: (c) => {
      qc.setQueryData(['ai-models', provider], c)
      setError(c.error)
    },
    onError: (e: Error) => setError(e.message),
  })

  // Switching provider must not leave the previous provider's model selected —
  // "claude-opus-5" on OpenAI is a 404, not a fallback.
  useEffect(() => {
    if (isTavily) return
    if (provider === settings.provider) {
      setModel(settings.model)
    } else if (catalog?.default) {
      setModel(catalog.default)
    }
    setCustomModel('')
  }, [provider, catalog?.default, isTavily])

  function selectTab(id: string) {
    setActiveTab(id)
    if (id !== TAVILY_TAB) {
      setProvider(id)
      setError(null)
      refresh.reset()
    }
  }

  const providerHasKey = settings.configured_providers?.[provider] ?? false

  const save = useMutation({
    mutationFn: () =>
      api.ai.saveSettings({
        provider,
        model: (customModel.trim() || model),
        // Only send a key when one was typed, so re-saving the model alone
        // does not wipe a stored key.
        ...(key.trim() ? { api_key: key.trim() } : {}),
      }),
    onSuccess: (s) => {
      setKey('')
      setError(null)
      qc.setQueryData(['ai-settings'], s)
      qc.invalidateQueries({ queryKey: ['ai-settings'] })
      if (s.configured) onDone?.()
    },
    onError: (e: Error) => setError(e.message),
  })

  const disconnect = useMutation({
    mutationFn: () => api.ai.saveSettings({ provider, api_key: '' }),
    onSuccess: (s) => {
      qc.setQueryData(['ai-settings'], s)
      qc.invalidateQueries({ queryKey: ['ai-settings'] })
    },
  })

  const togglePrivate = useMutation({
    mutationFn: (v: boolean) => api.ai.saveSettings({ allow_private: v }),
    onSuccess: (s) => {
      qc.setQueryData(['ai-settings'], s)
      qc.invalidateQueries({ queryKey: ['ai-settings'] })
    },
  })

  const [webEnabled, setWebEnabled] = useState(false)
  const [webKey, setWebKey] = useState('')
  const [webDailyLimit, setWebDailyLimit] = useState('20')
  const [webError, setWebError] = useState<string | null>(null)

  useEffect(() => {
    if (!webSettings) return
    setWebEnabled(webSettings.enabled)
    setWebDailyLimit(String(webSettings.daily_limit))
  }, [webSettings])

  const saveWeb = useMutation({
    mutationFn: () =>
      api.ai.saveWebSettings({
        enabled: webEnabled,
        daily_limit: parseInt(webDailyLimit) || undefined,
        ...(webKey.trim() ? { api_key: webKey.trim() } : {}),
      }),
    onSuccess: (s) => {
      setWebKey('')
      setWebError(null)
      qc.setQueryData(['ai-web-settings'], s)
      qc.invalidateQueries({ queryKey: ['ai-web-settings'] })
    },
    onError: (e: Error) => setWebError(e.message),
  })

  const disconnectWeb = useMutation({
    mutationFn: () => api.ai.saveWebSettings({ api_key: '', enabled: false }),
    onSuccess: (s) => {
      qc.setQueryData(['ai-web-settings'], s)
      qc.invalidateQueries({ queryKey: ['ai-web-settings'] })
    },
  })

  const providerInfo = settings.providers?.find(p => p.id === provider)
  const models = catalog?.models ?? []
  const curated = models.filter(m => m.curated !== false)
  const extra = models.filter(m => m.curated === false)

  // One row, one "already configured" convention (a dot on the pill) for
  // every provider — an LLM one or the search one.
  const providerTabs = [
    ...(settings.providers ?? []).map(p => ({
      id: p.id, label: p.label, hasKey: !!settings.configured_providers?.[p.id],
    })),
    { id: TAVILY_TAB, label: 'Tavily', hasKey: !!webSettings?.configured },
  ]

  return (
    // flex-1 + min-h-0 make this the scrolling region of the panel column;
    // pb-8 keeps the Save button clear of the very bottom edge.
    <div className="flex-1 min-h-0 overflow-y-auto p-5 pb-8 space-y-5">
      <div>
        <h3 className="text-base font-semibold font-display text-zinc-100">{t('chat.setup.title')}</h3>
        <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">{t('chat.setup.intro')}</p>
      </div>

      {/* The app is local-first; sending data to a cloud provider is a real
          change in posture, so it is stated plainly rather than buried in
          settings. Swaps content per tab rather than stacking two boxes,
          since Tavily is a materially different disclosure from the LLM one. */}
      <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2.5">
        <p className="text-[11px] text-amber-200/90 leading-relaxed">
          {isTavily ? t('chat.setup.web.privacy') : t('chat.setup.privacy')}
        </p>
      </div>

      {/* Provider */}
      <div>
        <label className="block text-[11px] text-zinc-500 mb-1.5">{t('chat.setup.provider')}</label>
        <div className="flex gap-1.5">
          {providerTabs.map(p => (
            <button
              key={p.id}
              onClick={() => selectTab(p.id)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors relative ${
                activeTab === p.id
                  ? 'bg-brand-500 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
              }`}
            >
              {p.label}
              {p.hasKey && (
                <span
                  title={t('chat.setup.keyStored')}
                  className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${activeTab === p.id ? 'bg-white/80' : 'bg-emerald-500'}`}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {isTavily ? (
        <>
          <p className="text-xs text-zinc-500 leading-relaxed">{t('chat.setup.web.intro')}</p>

          <label className="flex items-start justify-between gap-3 cursor-pointer">
            <span className="text-xs text-zinc-300">{t('chat.setup.web.enable')}</span>
            <Toggle checked={webEnabled} onChange={setWebEnabled} />
          </label>

          <div>
            <label className="block text-[11px] text-zinc-500 mb-1.5">{t('chat.setup.web.apiKey')}</label>
            <input
              type="password"
              value={webKey}
              onChange={e => setWebKey(e.target.value)}
              placeholder={webSettings?.configured ? webSettings.api_key_masked : 'tvly-…'}
              spellCheck={false}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 font-mono focus:outline-none focus:border-brand-500/60"
            />
            <p className="text-[10px] text-zinc-600 mt-1.5 leading-relaxed">
              {t('chat.setup.web.apiKeyHint')}{' '}
              <a href="https://tavily.com" target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">tavily.com</a>
            </p>
          </div>

          <div>
            <label className="block text-[11px] text-zinc-500 mb-1.5">{t('chat.setup.web.dailyLimit')}</label>
            <input
              type="number"
              min={1}
              value={webDailyLimit}
              onChange={e => setWebDailyLimit(e.target.value)}
              className="w-24 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-brand-500/60"
            />
            {webSettings?.configured && (
              <p className="text-[10px] text-zinc-600 mt-1.5">
                {t('chat.setup.web.usageToday', { used: webSettings.usage_today, limit: webSettings.daily_limit })}
              </p>
            )}
          </div>

          {webError && <p className="text-xs text-red-400 break-words">{webError}</p>}

          <div className="flex gap-2">
            <button
              onClick={() => saveWeb.mutate()}
              disabled={saveWeb.isPending}
              className="flex-1 py-2 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #9333ea 0%, #7e22ce 100%)' }}
            >
              {saveWeb.isPending ? t('chat.setup.web.saving') : t('chat.setup.web.save')}
            </button>
            {webSettings?.configured && (
              <button
                onClick={() => disconnectWeb.mutate()}
                className="px-3 py-2 rounded-lg text-sm text-zinc-400 border border-zinc-700 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
              >
                {t('chat.setup.web.disconnect')}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {/* API key */}
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1.5">
              {t('chat.setup.apiKey')} · {providerInfo?.label ?? provider}
            </label>
            <input
              type="password"
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder={
                providerHasKey && provider === settings.provider
                  ? settings.api_key_masked
                  : providerHasKey
                    ? t('chat.setup.keyStored')
                    : (providerInfo?.key_hint ?? 'sk-…')
              }
              spellCheck={false}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 font-mono focus:outline-none focus:border-brand-500/60"
            />
            <p className="text-[10px] text-zinc-600 mt-1.5 leading-relaxed">
              {t('chat.setup.apiKeyHint')}
              {providerInfo?.console && (
                <> <a href={providerInfo.console} target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">{providerInfo.console.replace(/^https?:\/\//, '')}</a></>
              )}
            </p>
          </div>

          {/* Above the model list on purpose — OpenAI's list alone is long
              enough that a setting placed below it reads as buried. */}
          <label className="flex items-start justify-between gap-3 cursor-pointer">
            <span>
              <span className="block text-xs text-zinc-300">{t('chat.setup.allowPrivate')}</span>
              <span className="block text-[10px] text-zinc-600 mt-0.5 leading-relaxed">{t('chat.setup.allowPrivateHint')}</span>
            </span>
            <Toggle checked={settings.allow_private} onChange={v => togglePrivate.mutate(v)} />
          </label>

          {/* Model */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] text-zinc-500">{t('chat.setup.model')}</label>
              {providerHasKey && (
                <button
                  onClick={() => refresh.mutate()}
                  disabled={refresh.isPending || loadingModels}
                  className="text-[10px] text-zinc-500 hover:text-brand-300 transition-colors disabled:opacity-50"
                >
                  {refresh.isPending || loadingModels ? t('chat.setup.refreshing') : t('chat.setup.refresh')}
                </button>
              )}
            </div>

            <div className="space-y-1.5">
              {curated.map(m => (
                <ModelRow key={m.id} m={m} selected={model === m.id && !customModel.trim()}
                          onSelect={() => { setModel(m.id); setCustomModel('') }} t={t} />
              ))}
            </div>

            {extra.length > 0 && (
              <div className="mt-2">
                <p className="text-[10px] text-zinc-600 mb-1">{t('chat.setup.alsoAvailable')}</p>
                <div className="flex flex-wrap gap-1">
                  {extra.map(m => (
                    <button
                      key={m.id}
                      onClick={() => { setCustomModel(''); setModel(m.id) }}
                      className={`text-[10px] font-mono px-1.5 py-1 rounded border transition-colors ${
                        model === m.id && !customModel.trim()
                          ? 'border-brand-500/60 bg-brand-500/10 text-brand-200'
                          : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
                      }`}
                    >
                      {m.id}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Free-text id, so a model newer than this app is never blocked. */}
            <input
              value={customModel}
              onChange={e => setCustomModel(e.target.value)}
              placeholder={t('chat.setup.customModel')}
              spellCheck={false}
              className="mt-2 w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-300 placeholder-zinc-700 font-mono focus:outline-none focus:border-brand-500/60"
            />

            <p className="text-[10px] text-zinc-700 mt-1.5">
              {catalog?.live
                ? `${t('chat.setup.liveList')}${catalog.fetched_at ? ` · ${new Date(catalog.fetched_at).toLocaleDateString()}` : ''}`
                : providerHasKey ? t('chat.setup.builtinList') : t('chat.setup.listNeedsKey')}
            </p>
          </div>

          {error && <p className="text-xs text-red-400 break-words">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending || (!key.trim() && !providerHasKey)}
              className="flex-1 py-2 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #9333ea 0%, #7e22ce 100%)' }}
            >
              {save.isPending ? t('chat.setup.saving') : t('chat.setup.save')}
            </button>
            {providerHasKey && (
              <button
                onClick={() => disconnect.mutate()}
                className="px-3 py-2 rounded-lg text-sm text-zinc-400 border border-zinc-700 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
              >
                {t('chat.setup.disconnect')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center rounded-full transition-colors shrink-0 mt-0.5 ${checked ? 'bg-brand-500' : 'bg-zinc-700'}`}
      style={{ width: '32px', height: '18px' }}
    >
      <span
        className="inline-block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? 'translateX(16px)' : 'translateX(2px)' }}
      />
    </button>
  )
}

function ModelRow({ m, selected, onSelect, t }: {
  m: AiModel
  selected: boolean
  onSelect: () => void
  t: (k: string) => string
}) {
  return (
    <button
      onClick={onSelect}
      className={[
        'w-full text-left rounded-lg border px-3 py-2 transition-colors',
        selected ? 'border-brand-500/60 bg-brand-500/10' : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-zinc-200 font-medium">{m.label}</span>
        {m.pricing && (
          <span className="text-[10px] text-zinc-600 tabular-nums shrink-0">
            ${m.pricing.in} / ${m.pricing.out} {t('chat.setup.perMillion')}
          </span>
        )}
      </div>
      {m.note && <p className="text-[10px] text-zinc-500 mt-0.5">{m.note}</p>}
    </button>
  )
}

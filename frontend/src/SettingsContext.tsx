import { createContext, useContext, useState } from 'react'
import { translations, type Lang } from './i18n/translations'

export type NameOrder = 'en' | 'hu'
export type { Lang }

interface Settings {
  nameOrder: NameOrder
  setNameOrder: (o: NameOrder) => void
  autoCheckUpdates: boolean
  setAutoCheckUpdates: (v: boolean) => void
  lang: Lang
  setLang: (l: Lang) => void
}

const SettingsContext = createContext<Settings>({
  nameOrder: 'en',
  setNameOrder: () => {},
  autoCheckUpdates: true,
  setAutoCheckUpdates: () => {},
  lang: 'en',
  setLang: () => {},
})

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [nameOrder, setNameOrderState] = useState<NameOrder>(
    () => (localStorage.getItem('mnemosyne_nameOrder') as NameOrder) ?? 'en'
  )
  const [autoCheckUpdates, setAutoCheckUpdatesState] = useState<boolean>(
    () => localStorage.getItem('mnemosyne_autoCheckUpdates') !== 'false'
  )
  const [lang, setLangState] = useState<Lang>(
    () => (localStorage.getItem('mnemosyne_lang') as Lang) ?? 'en'
  )

  function setNameOrder(o: NameOrder) {
    setNameOrderState(o)
    localStorage.setItem('mnemosyne_nameOrder', o)
  }

  function setAutoCheckUpdates(v: boolean) {
    setAutoCheckUpdatesState(v)
    localStorage.setItem('mnemosyne_autoCheckUpdates', String(v))
  }

  function setLang(l: Lang) {
    setLangState(l)
    localStorage.setItem('mnemosyne_lang', l)
  }

  return (
    <SettingsContext.Provider value={{ nameOrder, setNameOrder, autoCheckUpdates, setAutoCheckUpdates, lang, setLang }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
}

export function useT() {
  const { lang } = useSettings()
  return (key: string, vars?: Record<string, string | number>) => {
    const dict = translations[lang]
    let str = dict[key] ?? translations.en[key] ?? key
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
      }
    }
    return str
  }
}

/** BCP-47 locale for the UI language — use for every Intl / toLocale* call. */
export const DATE_LOCALE: Record<Lang, string> = { en: 'en-GB', hu: 'hu-HU' }

export function useDateLocale() {
  const { lang } = useSettings()
  return DATE_LOCALE[lang] ?? 'en-GB'
}

/**
 * Formats a partial genealogy date — `YYYY`, `YYYY-MM` or `YYYY-MM-DD` — in the
 * UI language. Intl handles the part ordering, so Hungarian gets
 * "1950. március 12." where English gets "12 March 1950".
 */
export function formatPartialDate(date: string, locale: string, month: 'long' | 'short' = 'long'): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!Number.isFinite(y)) return date
  if (Number.isFinite(m) && Number.isFinite(d)) {
    return new Date(y, m - 1, d).toLocaleDateString(locale, { year: 'numeric', month, day: 'numeric' })
  }
  if (Number.isFinite(m)) {
    return new Date(y, m - 1, 1).toLocaleDateString(locale, { year: 'numeric', month })
  }
  return String(y)
}

/** Month names in the UI language, January first. */
export function monthNames(locale: string, style: 'long' | 'short' = 'long'): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { month: style })
  return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(2000, i, 1)))
}

type NameLike = {
  name?: string | null
  title?: string | null
  first_name?: string | null
  last_name?: string | null
  middle_name?: string | null
}

export function displayPersonName(person: NameLike, order: NameOrder, fallback = '(unnamed)'): string {
  if (person.first_name || person.last_name) {
    const parts = order === 'en'
      ? [person.title, person.first_name, person.middle_name, person.last_name]
      : [person.title, person.last_name, person.first_name, person.middle_name]
    const result = parts.map(s => s?.trim() ?? '').filter(Boolean).join(' ')
    if (result) return result
  }
  return person.name?.trim() || fallback
}

export function displayInitials(person: NameLike): string {
  if (person.first_name && person.last_name) {
    return (person.first_name[0] + person.last_name[0]).toUpperCase()
  }
  if (person.first_name) return person.first_name.slice(0, 2).toUpperCase()
  if (person.last_name)  return person.last_name.slice(0, 2).toUpperCase()
  return (person.name ?? '?').trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'
}

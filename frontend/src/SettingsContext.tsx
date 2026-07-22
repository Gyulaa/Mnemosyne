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

import { createContext, useContext, useState } from 'react'

export type NameOrder = 'en' | 'hu'

interface Settings {
  nameOrder: NameOrder
  setNameOrder: (o: NameOrder) => void
}

const SettingsContext = createContext<Settings>({ nameOrder: 'en', setNameOrder: () => {} })

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [nameOrder, setNameOrderState] = useState<NameOrder>(
    () => (localStorage.getItem('mnemosyne_nameOrder') as NameOrder) ?? 'en'
  )

  function setNameOrder(o: NameOrder) {
    setNameOrderState(o)
    localStorage.setItem('mnemosyne_nameOrder', o)
  }

  return (
    <SettingsContext.Provider value={{ nameOrder, setNameOrder }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
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

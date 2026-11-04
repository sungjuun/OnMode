import { useSyncExternalStore } from 'react'
import { appearanceStorageKey, readAppearance, saveAppearance, type Appearance } from '../data/appearance'

const system = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

let preference = readAppearance()

function apply() {
  const dark = preference === 'dark' || (preference === 'system' && system.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#131320' : '#f7f8fc')
}
function update(value: Appearance) {
  preference = value
  apply()
  listeners.forEach(listener => listener())
}
export function setAppearance(value: Appearance) {
  saveAppearance(value)
  update(value)
}
export function trackAppearance() {
  apply()
  const sync = (event: StorageEvent) => { if (event.key === appearanceStorageKey || event.key === null) update(readAppearance()) }
  system.addEventListener('change', apply)
  window.addEventListener('storage', sync)
  return () => {
    system.removeEventListener('change', apply)
    window.removeEventListener('storage', sync)
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export const useAppearance = () => useSyncExternalStore(subscribe, () => preference)

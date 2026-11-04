export type Appearance = 'light' | 'dark' | 'system'
// Keep this key in sync with the pre-paint script in index.html.
export const appearanceStorageKey = 'onmode:appearance'

export function readAppearance(): Appearance {
  try {
    const value = localStorage.getItem(appearanceStorageKey)
    if (value === 'light' || value === 'dark') return value
  } catch { /* System appearance remains available with storage disabled. */ }
  return 'system'
}

export function saveAppearance(value: Appearance) {
  try {
    if (value === 'system') localStorage.removeItem(appearanceStorageKey)
    else localStorage.setItem(appearanceStorageKey, value)
  } catch { /* The UI can still apply the choice for this tab. */ }
}

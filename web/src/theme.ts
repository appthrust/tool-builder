// Colour theme: `light`, `dark`, or `system` (follow the OS). The choice is a
// cookie like the language (`appthrust-theme`, one year) and is applied as the
// `dark` class on <html> (`@custom-variant dark` in styles.css). index.html
// applies the cookie before the first paint; this module keeps it in sync
// afterwards and follows OS changes while the choice is `system`.
import { Store, useSelector } from '@tanstack/react-store'

export type Theme = 'light' | 'dark' | 'system'

export const THEMES: readonly Theme[] = ['system', 'light', 'dark']

const COOKIE_NAME = 'appthrust-theme'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365
const QUERY = '(prefers-color-scheme: dark)'

function isTheme(value: string | undefined): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function readTheme(cookie: string): Theme {
  const raw = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1)
  return isTheme(raw) ? raw : 'system'
}

export function resolveTheme(theme: Theme, systemDark: boolean): 'light' | 'dark' {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
}

const themeStore = new Store<{ theme: Theme }>({ theme: typeof document === 'undefined' ? 'system' : readTheme(document.cookie) })

function apply(theme: Theme) {
  if (typeof document === 'undefined') return
  const dark = resolveTheme(theme, window.matchMedia(QUERY).matches) === 'dark'
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

/** Persists the choice and applies it. */
export function setTheme(theme: Theme) {
  if (typeof document !== 'undefined') {
    document.cookie = `${COOKIE_NAME}=${theme}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax`
  }
  themeStore.setState((state) => (state.theme === theme ? state : { theme }))
  apply(theme)
}

export function useTheme(): Theme {
  return useSelector(themeStore, (state) => state.theme)
}

/** Follows the OS while the choice is `system`; call once at startup. */
export function watchSystemTheme() {
  if (typeof window === 'undefined') return
  apply(themeStore.state.theme)
  window.matchMedia(QUERY).addEventListener('change', () => {
    if (themeStore.state.theme === 'system') apply('system')
  })
}

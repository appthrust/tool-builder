import { AppSwitcher } from '@appthrust/app-launcher'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import { Blocks, Database, Languages, LayoutGrid, Monitor, Moon, Sun } from 'lucide-react'
import type { ReactNode } from 'react'
import { meQuery } from '../api/queries'
import { setLanguage, useText } from '../i18n'
import { setTheme, THEMES, useTheme } from '../theme'
import { paths } from '../routes/paths'
import { Avatar, Badge, Button, cn, HrefLink, IconButton } from '../ui'

const NAV_LINK =
  'flex min-h-10 min-w-10 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-900 dark:hover:text-stone-100 md:min-h-9 [&_svg]:size-4 [&_svg]:shrink-0'
const NAV_ACTIVE = 'bg-accent-soft text-accent-strong hover:bg-accent-soft hover:text-accent-strong'
// The sections, the language switch and the signed-in name do not fit a phone's width; below `sm`
// the section links show their icon and keep the label for screen readers and as a tooltip.
const NAV_LABEL = 'max-sm:sr-only'

/** Top bar (product, sections, language, theme, the app switcher, the signed-in person) over the page. */
export function Shell({ children }: { children: ReactNode }) {
  const { t, language } = useText()
  const { data: me } = useSuspenseQuery(meQuery)
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  // Tool screens (`/t/<slug>`) and the editor (`/edit/<slug>/*`) lay out their own left nav and padding,
  // so they get the full width under the top bar; the list screens get the boxed column.
  const fullBleed = pathname.startsWith('/t/') || pathname.startsWith('/edit/')
  // "Tools" stays current while a tool or its editor is open; the data-sources screen is its own section.
  const inTools = pathname === paths.home || fullBleed
  const otherLanguage = language === 'ja' ? 'en' : 'ja'
  // One button cycles system → light → dark; the icon shows the current choice.
  const theme = useTheme()
  const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? 'system'
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 min-h-10 content-center rounded-md bg-white dark:bg-stone-900 px-3 py-2 text-sm font-medium shadow focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t('toolBuilder.nav.skipToMain')}
      </a>
      {/* Exactly 3.5rem including the border (border-box), so full-height screens can size to 100dvh − 3.5rem. */}
      <header className="sticky top-0 z-30 h-14 border-b border-line bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:bg-stone-900/90 dark:supports-[backdrop-filter]:bg-stone-900/80">
        <div className={cn('mx-auto flex h-full items-center gap-1 px-3 sm:gap-2', fullBleed ? 'max-w-none sm:px-4' : 'max-w-5xl sm:px-6')}>
          <HrefLink
            href={paths.home}
            title={t('toolBuilder.product')}
            className="mr-1 flex shrink-0 items-center gap-2.5 rounded-md text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100 sm:mr-2"
            activeOptions={{ includeSearch: false }}
          >
            <span aria-hidden className="grid size-7 place-items-center rounded-md bg-accent text-white">
              <Blocks className="size-4" />
            </span>
            <span className="max-md:sr-only">{t('toolBuilder.product')}</span>
          </HrefLink>
          <nav aria-label={t('toolBuilder.nav.label')} className="flex min-w-0 items-center gap-1">
            <HrefLink
              href={paths.home}
              title={t('toolBuilder.nav.tools')}
              className={cn(NAV_LINK, inTools && NAV_ACTIVE)}
              activeOptions={{ includeSearch: false }}
            >
              <LayoutGrid aria-hidden />
              <span className={NAV_LABEL}>{t('toolBuilder.nav.tools')}</span>
            </HrefLink>
            {me.roles.admin ? (
              <HrefLink href={paths.dataSources} title={t('toolBuilder.nav.dataSources')} className={NAV_LINK} activeProps={{ className: NAV_ACTIVE }}>
                <Database aria-hidden />
                <span className={NAV_LABEL}>{t('toolBuilder.nav.dataSources')}</span>
              </HrefLink>
            ) : null}
          </nav>
          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1 sm:gap-2">
            <Button
              tone="ghost"
              size="sm"
              icon={<Languages />}
              aria-label={`${t('toolBuilder.nav.language')}: ${t(`toolBuilder.language.${otherLanguage}`)}`}
              onClick={() => setLanguage(otherLanguage)}
            >
              <span lang={otherLanguage} className="hidden sm:inline">
                {t(`toolBuilder.language.${otherLanguage}`)}
              </span>
            </Button>
            <IconButton icon={<ThemeIcon />} label={`${t('toolBuilder.nav.theme')}: ${t(`toolBuilder.theme.${theme}`)}`} onClick={() => setTheme(nextTheme)} />
            <AppSwitcher language={language} />
            <p className="flex min-w-0 items-center gap-2 pl-1 text-sm font-medium text-stone-700 dark:text-stone-300">
              <Avatar name={me.displayName} size="sm" />
              <span className="max-w-32 truncate max-sm:sr-only">
                <span className="sr-only">{t('toolBuilder.nav.you')}: </span>
                {me.displayName}
              </span>
              {me.roles.admin ? (
                <span className="max-md:hidden">
                  <Badge tone="accent">{t('toolBuilder.role.admin')}</Badge>
                </span>
              ) : null}
            </p>
          </div>
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className={cn(
          'flex w-full flex-1 flex-col focus:outline-none',
          fullBleed ? 'min-h-[calc(100dvh-3.5rem)]' : 'mx-auto max-w-5xl px-4 py-6 sm:px-6 md:py-8'
        )}
      >
        {children}
      </main>
    </div>
  )
}

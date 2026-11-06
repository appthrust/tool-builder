import { useQueryErrorResetBoundary, type QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, notFound, Outlet, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { FileQuestion, Lock } from 'lucide-react'
import { useEffect } from 'react'
import { isApiError } from '../api/client'
import { meQuery } from '../api/queries'
import { useText } from '../i18n'
import { Shell } from '../shell/shell'
import { EmptyState, errorMessageId, LinkButton, Loading, LoadFailed, useDocumentTitle } from '../ui'
import { paths } from './paths'

export type RouterContext = { queryClient: QueryClient }

/** Loader helper: an unknown or archived tool renders the not-found page instead of an error. */
export function notFoundOn404(error: unknown): never {
  if (isApiError(error, 'not_found')) throw notFound()
  throw error
}

export function NotFound() {
  const { t } = useText()
  useDocumentTitle(t('toolBuilder.notFound.title'))
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <EmptyState
        icon={<FileQuestion />}
        heading="h1"
        title={t('toolBuilder.notFound.title')}
        body={t('toolBuilder.notFound.body')}
        action={
          <LinkButton href={paths.home} tone="primary">
            {t('toolBuilder.notFound.home')}
          </LinkButton>
        }
      />
    </div>
  )
}

/** A 403 the caller cannot retry away (admin-only screen, editor-only screen, no grant on the tool). */
function Forbidden({ error }: { error: unknown }) {
  const { t } = useText()
  const message = t(errorMessageId(error) ?? 'toolBuilder.errors.forbidden')
  useDocumentTitle(message)
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <EmptyState
        icon={<Lock />}
        heading="h1"
        title={message}
        body={t('toolBuilder.forbidden.body')}
        action={
          <LinkButton href={paths.home} tone="primary">
            {t('toolBuilder.notFound.home')}
          </LinkButton>
        }
      />
    </div>
  )
}

/** In-page load failure (inside the shell). Retry re-runs the loaders and resets failed suspense queries. */
export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter()
  const queryErrorResetBoundary = useQueryErrorResetBoundary()
  useEffect(() => queryErrorResetBoundary.reset(), [queryErrorResetBoundary])
  if (isApiError(error, 'not_found')) return <NotFound />
  if (isApiError(error) && error.status === 403) return <Forbidden error={error} />
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8">
      <LoadFailed error={error} onRetry={() => void router.invalidate()} />
    </div>
  )
}

export function RoutePending() {
  return (
    <div className="mx-auto flex w-full max-w-xl justify-center px-4">
      <Loading />
    </div>
  )
}

/** The caller could not be identified (`GET /me`): there is no shell yet. */
function RootError(props: ErrorComponentProps) {
  const { t } = useText()
  useDocumentTitle(t('toolBuilder.common.loadFailed'))
  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <RouteError {...props} />
    </div>
  )
}

function RootPending() {
  return (
    <div className="mx-auto flex max-w-xl justify-center px-6 py-24">
      <Loading />
    </div>
  )
}

export const rootRoute = createRootRouteWithContext<RouterContext>()({
  // `GET /me` resolves the caller's role and groups; the shell and every screen read it.
  beforeLoad: ({ context }) => context.queryClient.ensureQueryData(meQuery),
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
  errorComponent: RootError,
  pendingComponent: RootPending,
  notFoundComponent: NotFound,
})

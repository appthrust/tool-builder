// Route tree. Screens are code-split (`lazyRouteComponent`) and read their own
// params (`slug`, `queryId`, `n`) and search; loaders only warm React Query so
// the first paint has data. `/edit/$slug` is the editor layout (EditorShell,
// its own left nav) over the canvas and the queries/releases/sharing/runs tabs.
import { createRoute, lazyRouteComponent, redirect } from '@tanstack/react-router'
import { isApiError } from '../api/client'
import { dataSourcesQuery, grantsQuery, groupsQuery, releaseQuery, releasesQuery, runsQuery, toolQuery, toolsQuery } from '../api/queries'
import { paths } from './paths'
import { notFoundOn404, rootRoute } from './root'

/** Search params arrive as plain strings (router.tsx); a route that does not declare one drops it. */
type RawSearch = Record<string, unknown>

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  loader: ({ context }) => context.queryClient.ensureQueryData(toolsQuery),
  component: lazyRouteComponent(() => import('../features/home/home-page'), 'HomePage'),
})

export type ToolSearch = { draft?: boolean }

const toolRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/t/$slug',
  // `?draft=1` previews the draft with the runtime renderer (editors only; the server enforces it).
  validateSearch: (search: RawSearch): ToolSearch => (search.draft === '1' || search.draft === 'true' || search.draft === true ? { draft: true } : {}),
  // A 403 `tool_forbidden` stays in the query cache: the tool page renders the request-access screen from it.
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(toolQuery(params.slug)).then(
      () => undefined,
      (error: unknown) => {
        if (isApiError(error, 'tool_forbidden')) return
        notFoundOn404(error)
      }
    ),
  component: lazyRouteComponent(() => import('../features/runtime/tool-page'), 'ToolPage'),
})

const editRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/edit/$slug',
  // People who may only use the tool are sent to it instead of an editor they cannot save.
  loader: async ({ context, params }) => {
    const tool = await context.queryClient.ensureQueryData(toolQuery(params.slug)).catch(notFoundOn404)
    if (!tool.access.edit) throw redirect({ href: paths.tool(params.slug), replace: true })
  },
  component: lazyRouteComponent(() => import('../features/editor/editor-shell'), 'EditorShell'),
})

const canvasRoute = createRoute({
  getParentRoute: () => editRoute,
  path: '/',
  component: lazyRouteComponent(() => import('../features/editor/canvas/canvas-page'), 'CanvasPage'),
})

const queriesComponent = lazyRouteComponent(() => import('../features/editor/queries/queries-page'), 'QueriesPage')

const queriesRoute = createRoute({ getParentRoute: () => editRoute, path: 'queries', component: queriesComponent })

export type QuerySearch = { insert?: string }

const queryRoute = createRoute({
  getParentRoute: () => editRoute,
  path: 'queries/$queryId',
  validateSearch: (search: RawSearch): QuerySearch => typeof search.insert === 'string' && search.insert !== '' ? { insert: search.insert } : {},
  component: queriesComponent,
})

export type ReleasesSearch = { publish?: string }

const releasesSearch = (search: RawSearch): ReleasesSearch =>
  typeof search.publish === 'string' && search.publish !== '' ? { publish: search.publish } : {}

const releasesComponent = lazyRouteComponent(() => import('../features/editor/releases/releases-page'), 'ReleasesPage')

const releasesRoute = createRoute({
  getParentRoute: () => editRoute,
  path: 'releases',
  validateSearch: releasesSearch,
  loader: ({ context, params }) => context.queryClient.ensureQueryData(releasesQuery(params.slug)),
  component: releasesComponent,
})

const releaseRoute = createRoute({
  getParentRoute: () => editRoute,
  path: 'releases/$n',
  validateSearch: releasesSearch,
  loader: async ({ context, params }) => {
    const number = Number(params.n)
    await Promise.all([
      context.queryClient.ensureQueryData(releasesQuery(params.slug)),
      Number.isInteger(number) && number > 0 ? context.queryClient.ensureQueryData(releaseQuery(params.slug, number)).catch(notFoundOn404) : undefined,
    ])
  },
  component: releasesComponent,
})

const sharingRoute = createRoute({
  getParentRoute: () => editRoute,
  path: 'sharing',
  loader: ({ context, params }) => Promise.all([context.queryClient.ensureQueryData(grantsQuery(params.slug)), context.queryClient.ensureQueryData(groupsQuery)]),
  component: lazyRouteComponent(() => import('../features/editor/sharing/sharing-page'), 'SharingPage'),
})

export type RunsSearch = { limit?: string }

/** The run limits the runs screen offers; anything else reads the default. */
const RUN_LIMITS: Record<string, true> = { '20': true, '50': true, '100': true, '200': true }

const runsRoute = createRoute({
  getParentRoute: () => editRoute,
  path: 'runs',
  // `limit` stays a string; the runs screen validates it (20/50/100/200, default 50) the same way.
  validateSearch: (search: RawSearch): RunsSearch => (typeof search.limit === 'string' && search.limit !== '' ? { limit: search.limit } : {}),
  loaderDeps: ({ search }) => ({ limit: search.limit !== undefined && RUN_LIMITS[search.limit] ? Number(search.limit) : 50 }),
  loader: ({ context, params, deps }) => context.queryClient.ensureQueryData(runsQuery(params.slug, deps.limit)),
  component: lazyRouteComponent(() => import('../features/editor/runs/runs-page'), 'RunsPage'),
})

const dataSourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/data-sources',
  // Admins and editors of any tool may read it (connecting stays admin-only); the server answers 403 `forbidden`
  // to everyone else, which renders the forbidden screen.
  loader: ({ context }) => context.queryClient.ensureQueryData(dataSourcesQuery),
  component: lazyRouteComponent(() => import('../features/editor/data-sources/data-sources-page'), 'DataSourcesPage'),
})

export const routeTree = rootRoute.addChildren([
  homeRoute,
  toolRoute,
  editRoute.addChildren([canvasRoute, queriesRoute, queryRoute, releasesRoute, releaseRoute, sharingRoute, runsRoute]),
  dataSourcesRoute,
])

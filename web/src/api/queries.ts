// Read-model loading (React Query). Every query is a `queryOptions()` factory so
// route loaders (`ensureQueryData`) and components share one key and fetcher.
import { QueryClient, queryOptions } from '@tanstack/react-query'
import { api, ToolBuilderApiError } from './client'

/** Retries for a call nothing answered (rollout gap, network blip). */
const TRANSIENT_RETRIES = 3

/** Any answer with a status (4xx, coded 5xx) is final; unanswered calls are retried with backoff. */
export const retryQuery = (failureCount: number, error: unknown) =>
  error instanceof ToolBuilderApiError && !error.transient ? false : failureCount < TRANSIENT_RETRIES

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: retryQuery, retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000), staleTime: 10_000 },
  },
})

/** Every tool-builder key starts with this. */
export const TOOL_BUILDER_KEY = ['tool-builder'] as const

const TOOLS_KEY = [...TOOL_BUILDER_KEY, 'tools'] as const
const DATA_SOURCES_KEY = [...TOOL_BUILDER_KEY, 'data-sources'] as const

/** Keys of one tool; its releases, grants and runs live under it so `invalidateTool` refreshes them together. */
const toolKey = (slug: string) => [...TOOLS_KEY, 'detail', slug] as const

export const meQuery = queryOptions({ queryKey: [...TOOL_BUILDER_KEY, 'me'], queryFn: () => api.me(), staleTime: 60_000 })

export const toolsQuery = queryOptions({ queryKey: [...TOOLS_KEY, 'list'], queryFn: () => api.tools.list() })

export const toolQuery = (slug: string) => queryOptions({ queryKey: toolKey(slug), queryFn: () => api.tools.get(slug) })

export const releasesQuery = (slug: string) => queryOptions({ queryKey: [...toolKey(slug), 'releases'], queryFn: () => api.releases.list(slug) })

/** A published release never changes, so its detail stays fresh. */
export const releaseQuery = (slug: string, number: number) =>
  queryOptions({ queryKey: [...toolKey(slug), 'releases', number], queryFn: () => api.releases.get(slug, number), staleTime: Number.POSITIVE_INFINITY })

export const grantsQuery = (slug: string) => queryOptions({ queryKey: [...toolKey(slug), 'grants'], queryFn: () => api.grants.get(slug) })

/** Recent action runs (newest first). */
export const runsQuery = (slug: string, limit = 50) =>
  queryOptions({ queryKey: [...toolKey(slug), 'runs', limit], queryFn: () => api.runs.list(slug, limit) })

/** Directory groups for the sharing picker; they change rarely. */
export const groupsQuery = queryOptions({ queryKey: [...TOOL_BUILDER_KEY, 'groups'], queryFn: () => api.groups(), staleTime: 60_000 })

/**
 * Admin list of connected sources. A `pending` source turns `ready` once the rollout carries its
 * connection, so the list polls while any source is pending.
 */
export const dataSourcesQuery = queryOptions({
  queryKey: [...DATA_SOURCES_KEY, 'list'],
  queryFn: () => api.dataSources.list(),
  refetchInterval: (query) => (query.state.data?.some((source) => source.status === 'pending') ? 5_000 : false),
})

export const sourceSchemaQuery = (sourceId: string) =>
  queryOptions({ queryKey: [...DATA_SOURCES_KEY, 'schema', sourceId], queryFn: () => api.dataSources.schema(sourceId), staleTime: 60_000 })

export const projectDatabasesQuery = queryOptions({ queryKey: [...DATA_SOURCES_KEY, 'project-databases'], queryFn: () => api.projectDatabases() })

/** The built-in app's operations change only with a callee release; the picker reuses them for a minute. */
export const sourceOperationsQuery = (sourceId: string) =>
  queryOptions({ queryKey: [...DATA_SOURCES_KEY, 'operations', sourceId], queryFn: () => api.dataSources.operations(sourceId), staleTime: 60_000 })

/** Linked built-in apps and their install state, for the "Add built-in app source" dialog (re-read each time it opens). */
export const installedAppLinksQuery = queryOptions({ queryKey: [...DATA_SOURCES_KEY, 'links'], queryFn: () => api.links(), staleTime: 0 })

/** After any write to a tool: the tool, its releases, grants, runs, and the tools list (names, live release). */
export const invalidateTool = (client: QueryClient, slug: string) =>
  Promise.all([client.invalidateQueries({ queryKey: toolKey(slug) }), client.invalidateQueries({ queryKey: toolsQuery.queryKey })])

/** After connecting or removing a data source. */
export const invalidateDataSources = (client: QueryClient) => client.invalidateQueries({ queryKey: DATA_SOURCES_KEY })

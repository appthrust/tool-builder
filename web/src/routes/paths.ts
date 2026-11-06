// Every tool-builder URL. `/t/<slug>` is the URL members open; `/edit/<slug>/*`
// is the editor; `/data-sources` is admin-only.
export const paths = {
  home: '/',
  tool: (slug: string) => `/t/${encodeURIComponent(slug)}`,
  /** Editor preview of the draft (same renderer as the runtime). */
  preview: (slug: string) => `/t/${encodeURIComponent(slug)}?draft=1`,
  edit: (slug: string) => `/edit/${encodeURIComponent(slug)}`,
  editQueries: (slug: string) => `/edit/${encodeURIComponent(slug)}/queries`,
  editQuery: (slug: string, queryId: string) => `/edit/${encodeURIComponent(slug)}/queries/${encodeURIComponent(queryId)}`,
  editReleases: (slug: string) => `/edit/${encodeURIComponent(slug)}/releases`,
  editRelease: (slug: string, n: number) => `/edit/${encodeURIComponent(slug)}/releases/${n}`,
  editSharing: (slug: string) => `/edit/${encodeURIComponent(slug)}/sharing`,
  editRuns: (slug: string) => `/edit/${encodeURIComponent(slug)}/runs`,
  dataSources: '/data-sources',
}

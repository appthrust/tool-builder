// Dev-only stand-ins for the built-in apps Internal Tool Builder links to (Built-in app
// Connect): their install state (`GET /links`), their link-callable operations
// (the same ids, paths and parameters as cmd/<name>-server/internal/api/openapi.json)
// and small datasets answering those operations, so a `builtin-app` data source can
// be created, picked from and run against the mock.
import type { InstalledAppLink, AppOperation, Column } from '../api/types'
import { GROUPS, PEOPLE, type MockPerson } from './mock-data'

/** English names, as the mock's status messages use them (the SPA localises from the definition). */
export const INSTALLED_APP_NAMES: Readonly<Record<string, string>> = { directory: 'Directory', knowledge: 'Knowledge', 'builder-console': 'Builder Console' }

/**
 * `links` of the tool-builder AppInstallation: Directory (its required dependency) and Knowledge
 * ready, Builder Console not installed. `knowledgeInstalling` (scenario `app-installing`) shows the
 * in-between state.
 */
export function mockInstalledAppLinks(knowledgeInstalling: boolean): InstalledAppLink[] {
  return [
    { definition: 'directory', state: 'Ready', publicUrl: 'https://directory.pj-demo.appthrust.ink' },
    knowledgeInstalling ? { definition: 'knowledge', state: 'Installing' } : { definition: 'knowledge', state: 'Ready', publicUrl: 'https://knowledge.pj-demo.appthrust.ink' },
    { definition: 'builder-console', state: 'Absent' },
  ]
}

const DIRECTORY = '/api/directory/v1'
const KNOWLEDGE = '/api/knowledge/v1'
const CONSOLE = '/api/console'

const q = (name: string, type = 'string') => ({ name, in: 'query' as const, type, required: false })
const id = { name: 'id', in: 'path' as const, type: 'string', required: true }

export const INSTALLED_APP_OPERATIONS: Readonly<Record<string, AppOperation[]>> = {
  directory: [
    { id: 'me', method: 'GET', path: `${DIRECTORY}/me`, summary: 'Current person, effective groups and Directory roles', params: [] },
    {
      id: 'listPeople',
      method: 'GET',
      path: `${DIRECTORY}/people`,
      summary: 'Find people by name, identity or effective group',
      resultPath: 'items',
      params: [q('q'), q('groupId'), q('limit', 'integer'), q('ids'), q('subject')],
    },
    { id: 'getPerson', method: 'GET', path: `${DIRECTORY}/people/{id}`, summary: 'Person profile including memberships and talent', params: [id] },
    { id: 'effectiveGroups', method: 'GET', path: `${DIRECTORY}/people/{id}/effective-groups`, summary: 'Effective group IDs for a person', params: [id] },
    { id: 'listGroups', method: 'GET', path: `${DIRECTORY}/groups`, summary: 'Find groups by name and direct parent', resultPath: 'items', params: [q('q'), q('parentId'), q('limit', 'integer')] },
    { id: 'listGroupMembers', method: 'GET', path: `${DIRECTORY}/groups/{id}/members`, summary: 'Direct and inherited group memberships', resultPath: 'items', params: [id] },
    { id: 'listSkills', method: 'GET', path: `${DIRECTORY}/skills`, summary: 'Skill catalog and distribution', resultPath: 'items', params: [] },
    { id: 'skillsMatrix', method: 'GET', path: `${DIRECTORY}/skills/matrix`, summary: 'People and skill cells in an effective group', params: [q('group')] },
    { id: 'import', method: 'POST', path: `${DIRECTORY}/import`, summary: 'Import portable Directory records (Directory admin only)', params: [] },
  ],
  knowledge: [
    { id: 'listCollections', method: 'GET', path: `${KNOWLEDGE}/collections`, summary: 'List visible collections', resultPath: 'data', params: [] },
    {
      id: 'search',
      method: 'GET',
      path: `${KNOWLEDGE}/search`,
      summary: 'Search visible document chunks',
      resultPath: 'hits',
      params: [{ name: 'query', in: 'query', type: 'string', required: true }, q('collections', 'array'), q('topK', 'integer')],
    },
    { id: 'listDocuments', method: 'GET', path: `${KNOWLEDGE}/documents`, summary: 'List visible documents', resultPath: 'data', params: [q('collection'), q('limit', 'integer')] },
    { id: 'getDocument', method: 'GET', path: `${KNOWLEDGE}/documents/{id}`, summary: 'Get a visible document', params: [id] },
  ],
  'builder-console': [
    { id: 'listApps', method: 'GET', path: `${CONSOLE}/apps`, summary: 'Apps visible to the caller', resultPath: 'items', params: [q('q'), q('group')] },
    { id: 'getApp', method: 'GET', path: `${CONSOLE}/apps/{id}`, summary: 'One app', params: [id] },
  ],
}

type KnowledgeDocument = { id: string; collection: string; title: string; url: string; updatedAt: string; text: string }

const COLLECTIONS = [
  { id: 'support-handbook', name: 'サポートハンドブック', source: 'esa', documentCount: 3 },
  { id: 'it-runbooks', name: 'IT ランブック', source: 'notion', documentCount: 2 },
]

const DOCUMENTS: KnowledgeDocument[] = [
  {
    id: 'doc-refund-policy',
    collection: 'support-handbook',
    title: '返金ポリシー',
    url: 'https://example.esa.io/posts/120',
    updatedAt: '2026-09-30T02:00:00Z',
    text: '注文から 30 日以内の返金は全額で受け付けます。部分返金はサポートリーダーの承認が必要です。返金は元の支払い方法に戻します。',
  },
  {
    id: 'doc-shipping-delay',
    collection: 'support-handbook',
    title: '配送遅延の連絡テンプレート',
    url: 'https://example.esa.io/posts/134',
    updatedAt: '2026-10-02T08:30:00Z',
    text: '配送が 3 営業日以上遅れた注文には、お詫びと追跡番号を添えて連絡します。必要に応じて送料を返金します。',
  },
  {
    id: 'doc-escalation',
    collection: 'support-handbook',
    title: 'エスカレーション手順',
    url: 'https://example.esa.io/posts/141',
    updatedAt: '2026-10-08T01:15:00Z',
    text: '高額の返金、法的な問い合わせ、個人情報の削除依頼はサポートリーダーへエスカレーションします。',
  },
  {
    id: 'doc-vpn',
    collection: 'it-runbooks',
    title: 'VPN 接続トラブル',
    url: 'https://www.notion.so/example/vpn',
    updatedAt: '2026-08-21T04:00:00Z',
    text: 'VPN に接続できないときは、クライアントを再起動し、デバイス証明書の有効期限を確認します。',
  },
  {
    id: 'doc-account-lock',
    collection: 'it-runbooks',
    title: 'アカウントロックの解除',
    url: 'https://www.notion.so/example/account-lock',
    updatedAt: '2026-09-12T06:45:00Z',
    text: 'アカウントのロックは本人確認のあと、ID 管理画面から解除します。解除は監査ログに残ります。',
  },
]

const SKILLS = [
  { id: 'sk-postgres', name: 'PostgreSQL', category: 'Engineering', people: 3 },
  { id: 'sk-kubernetes', name: 'Kubernetes', category: 'Engineering', people: 2 },
  { id: 'sk-refunds', name: '返金対応', category: 'Support', people: 5 },
  { id: 'sk-accounting', name: '会計', category: 'Finance', people: 4 },
]

function personItem(person: MockPerson) {
  return { id: person.personId, displayName: person.displayName, subject: person.subject, groups: person.groupIds.map((groupId) => GROUPS.find((group) => group.id === groupId)?.name ?? groupId).join(', ') }
}

/** A built-in app's 404, as the engine reports a non-2xx answer. */
export class InstalledAppNotFound extends Error {}

function directory(path: string, search: URLSearchParams, viewer: MockPerson): unknown {
  const people = Object.values(PEOPLE)
  const limit = Math.min(Number(search.get('limit') ?? 100) || 100, 500)
  if (path === '/me') return { personId: viewer.personId, displayName: viewer.displayName, subject: viewer.subject, effectiveGroupIds: viewer.groupIds }
  if (path === '/people') {
    const text = (search.get('q') ?? '').toLowerCase()
    const groupId = search.get('groupId') ?? ''
    const ids = (search.get('ids') ?? '').split(',').filter((value) => value !== '')
    const subject = search.get('subject') ?? ''
    const items = people
      .filter((person) => text === '' || person.displayName.toLowerCase().includes(text))
      .filter((person) => groupId === '' || person.groupIds.includes(groupId))
      .filter((person) => ids.length === 0 || ids.includes(person.personId))
      .filter((person) => subject === '' || person.subject === subject)
      .slice(0, limit)
      .map(personItem)
    return { items }
  }
  const person = /^\/people\/([^/]+)(\/effective-groups)?$/.exec(path)
  if (person) {
    const found = people.find((candidate) => candidate.personId === decodeURIComponent(person[1]!))
    if (!found) throw new InstalledAppNotFound(`person ${person[1]} not found`)
    return person[2] ? { personId: found.personId, groupIds: found.groupIds } : personItem(found)
  }
  if (path === '/groups') {
    const text = (search.get('q') ?? '').toLowerCase()
    const parentPath = GROUPS.find((group) => group.id === search.get('parentId'))?.path
    const items = GROUPS.filter((group) => text === '' || group.name.toLowerCase().includes(text) || group.path.includes(text))
      .filter((group) => !search.get('parentId') || (parentPath !== undefined && group.path.startsWith(`${parentPath}/`) && !group.path.slice(parentPath.length + 1).includes('/')))
      .slice(0, limit)
      .map((group) => ({ id: group.id, name: group.name, path: group.path, memberCount: group.memberCount }))
    return { items }
  }
  const members = /^\/groups\/([^/]+)\/members$/.exec(path)
  if (members) {
    const groupId = decodeURIComponent(members[1]!)
    if (!GROUPS.some((group) => group.id === groupId)) throw new InstalledAppNotFound(`group ${groupId} not found`)
    return { items: people.filter((candidate) => candidate.groupIds.includes(groupId)).map((member) => ({ personId: member.personId, displayName: member.displayName, inherited: false })) }
  }
  if (path === '/skills') return { items: SKILLS }
  if (path === '/skills/matrix') return { group: search.get('group') ?? null, people: people.length, skills: SKILLS.length }
  throw new InstalledAppNotFound(`no route ${path}`)
}

function knowledge(path: string, search: URLSearchParams): unknown {
  if (path === '/collections') return { data: COLLECTIONS }
  if (path === '/search') {
    const terms = (search.get('query') ?? '').toLowerCase().split(/\s+/).filter((term) => term !== '')
    const collections = (search.get('collections') ?? '').split(',').filter((value) => value !== '')
    const topK = Math.min(Number(search.get('topK') ?? 10) || 10, 50)
    const hits = DOCUMENTS.filter((document) => collections.length === 0 || collections.includes(document.collection))
      .map((document) => {
        const haystack = `${document.title} ${document.text}`.toLowerCase()
        const matched = terms.filter((term) => haystack.includes(term)).length
        return { document, score: terms.length === 0 ? 0 : Math.round((matched / terms.length) * 1000) / 1000 }
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ document, score }) => ({ documentId: document.id, title: document.title, collection: document.collection, score, snippet: document.text.slice(0, 60), url: document.url }))
    return { hits }
  }
  if (path === '/documents') {
    const collection = search.get('collection') ?? ''
    const limit = Math.min(Number(search.get('limit') ?? 100) || 100, 500)
    return {
      data: DOCUMENTS.filter((document) => collection === '' || document.collection === collection)
        .slice(0, limit)
        .map(({ text: _text, ...document }) => document),
    }
  }
  const one = /^\/documents\/([^/]+)$/.exec(path)
  if (one) {
    const found = DOCUMENTS.find((document) => document.id === decodeURIComponent(one[1]!))
    if (!found) throw new InstalledAppNotFound(`document ${one[1]} not found`)
    return found
  }
  throw new InstalledAppNotFound(`no route ${path}`)
}

/** The base path each built-in app serves its API under (`servers[0].url`). */
const BASE: Readonly<Record<string, string>> = { directory: DIRECTORY, knowledge: KNOWLEDGE, 'builder-console': CONSOLE }

/** The built-in app's JSON answer to a GET (`url` is the interpolated request path). */
export function installedAppResponse(definition: string, url: URL, viewer: MockPerson): unknown {
  const base = BASE[definition]
  if (!base || !url.pathname.startsWith(base)) throw new InstalledAppNotFound(`no route ${url.pathname}`)
  const path = url.pathname.slice(base.length)
  if (definition === 'directory') return directory(path, url.searchParams, viewer)
  if (definition === 'knowledge') return knowledge(path, url.searchParams)
  throw new InstalledAppNotFound(`no route ${url.pathname}`)
}

function jsonType(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') return 'string'
  return Array.isArray(value) ? 'array' : 'object'
}

/**
 * Rows of an HTTP answer the way the engine (cmd/server/internal/engine/http.go) reads
 * them: `resultPath` must select an array; an object is one row; columns are the keys, sorted.
 * Returns an error message instead of rows when the answer does not fit.
 */
export function rowsOf(value: unknown, resultPath: string | undefined): { columns: Column[]; rows: unknown[][] } | string {
  let selected = value
  if (resultPath) {
    for (const part of resultPath.split('.')) {
      if (part === '' || selected === null || typeof selected !== 'object' || Array.isArray(selected)) return 'HTTP resultPath does not select an array'
      selected = (selected as Record<string, unknown>)[part]
    }
    if (!Array.isArray(selected)) return 'HTTP resultPath does not select an array'
  }
  const items = Array.isArray(selected) ? selected : selected !== null && typeof selected === 'object' ? [selected] : null
  if (!items) return 'HTTP response must be a JSON object or array'
  const types = new Map<string, string>()
  for (const item of items) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return 'HTTP result rows must be JSON objects'
    for (const [key, cell] of Object.entries(item)) if (!types.has(key) || types.get(key) === 'null') types.set(key, jsonType(cell))
  }
  const names = [...types.keys()].sort()
  return {
    columns: names.map((name) => ({ name, type: types.get(name)! })),
    rows: items.map((item) => names.map((name) => (item as Record<string, unknown>)[name] ?? null)),
  }
}

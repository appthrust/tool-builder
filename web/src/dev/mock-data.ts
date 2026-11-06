// Dev-only seed for the in-memory mock (./mock-tool-builder): the business data
// behind the `orders-db` and `storefront-api` sources, the people and groups
// the access rules evaluate, and the tool documents (the order-desk golden
// fixture, its release history, and two smaller tools).
import { readFileSync } from 'node:fs'
import type { GroupRef } from '../api/types'
import type { Document } from '../model/document'

// ---------------------------------------------------------------------------
// People and groups

export type MockPerson = { subject: string; personId: string; displayName: string; groupIds: string[] }

export const PEOPLE: Record<string, MockPerson> = {
  sato: { subject: 'u-sato', personId: 'p-sato', displayName: '佐藤 美咲', groupIds: ['it-platform'] },
  tanaka: { subject: 'u-tanaka', personId: 'p-tanaka', displayName: '田中 健太', groupIds: ['it-platform'] },
  takahashi: { subject: 'u-takahashi', personId: 'p-takahashi', displayName: '高橋 直人', groupIds: ['it-platform'] },
  suzuki: { subject: 'u-suzuki', personId: 'p-suzuki', displayName: '鈴木 花子', groupIds: ['cs-team', 'cs-leads'] },
  nakamura: { subject: 'u-nakamura', personId: 'p-nakamura', displayName: '中村 陽太', groupIds: ['cs-team'] },
  ito: { subject: 'u-ito', personId: 'p-ito', displayName: '伊藤 恵', groupIds: ['finance'] },
  yamada: { subject: 'u-yamada', personId: 'p-yamada', displayName: '山田 翔', groupIds: ['marketing'] },
}

export const GROUPS: GroupRef[] = [
  { id: 'cs-team', path: 'support', name: 'カスタマーサポート', memberCount: 24 },
  { id: 'cs-leads', path: 'support/leads', name: 'サポートリーダー', memberCount: 4 },
  { id: 'finance', path: 'finance', name: '経理', memberCount: 7 },
  { id: 'it-platform', path: 'it/platform', name: 'IT プラットフォーム', memberCount: 6 },
  { id: 'marketing', path: 'marketing', name: 'マーケティング', memberCount: 11 },
  { id: 'warehouse', path: 'operations/warehouse', name: '倉庫', memberCount: 18 },
  { id: 'sales', path: 'sales', name: '営業', memberCount: 15 },
]

// ---------------------------------------------------------------------------
// Business data (`orders-db`): customers, orders, refunds

export const ORDER_STATUSES = ['open', 'awaiting shipment', 'shipped', 'delivered', 'delayed', 'refund requested'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export type Customer = { id: number; name: string; email: string; prefecture: string; created_at: string }
export type Order = {
  number: string
  customer_id: number
  status: OrderStatus
  /** numeric(12,0) in yen; the engine returns numeric as a string. */
  total: string
  currency: 'JPY'
  items: number
  payment_method: string
  carrier: string | null
  tracking_number: string | null
  created_at: string
  shipped_at: string | null
  delivered_at: string | null
}
export type Refund = { id: number; order_number: string; amount: string; reason: string | null; created_at: string }

const CUSTOMER_SEED: [string, string, string][] = [
  ['伊藤 さくら', 'sakura.ito@example.com', '東京都'],
  ['小林 大輔', 'd.kobayashi@example.com', '大阪府'],
  ['加藤 結衣', 'yui.kato@example.net', '愛知県'],
  ['吉田 拓海', 'takumi.yoshida@example.com', '福岡県'],
  ['山本 真由美', 'mayumi.y@example.org', '北海道'],
  ['松本 翼', 'tsubasa.matsumoto@example.com', '神奈川県'],
  ['井上 彩', 'aya.inoue@example.jp', '京都府'],
  ['木村 健', 'ken.kimura@example.com', '埼玉県'],
  ['林 美穂', 'miho.hayashi@example.net', '千葉県'],
  ['清水 蓮', 'ren.shimizu@example.com', '兵庫県'],
  ['山口 葵', 'aoi.yamaguchi@example.org', '広島県'],
  ['森 和也', 'kazuya.mori@example.com', '宮城県'],
  ['池田 美咲', 'misaki.ikeda@example.jp', '静岡県'],
  ['橋本 悠斗', 'yuto.hashimoto@example.com', '東京都'],
  ['阿部 遥', 'haruka.abe@example.net', '新潟県'],
  ['石川 智子', 'tomoko.ishikawa@example.com', '長野県'],
]

/** Deterministic PRNG (mulberry32) so every mock start and every test sees the same data. */
function random(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const HOUR = 3_600_000
/** The newest order; the dataset reads as "this morning". */
const LATEST_ORDER_AT = Date.parse('2026-10-14T00:40:00Z')

export type BusinessData = { customers: Customer[]; orders: Order[]; refunds: Refund[] }

export function seedBusinessData(): BusinessData {
  const next = random(20261014)
  const customers: Customer[] = CUSTOMER_SEED.map(([name, email, prefecture], index) => ({
    id: 101 + index,
    name,
    email,
    prefecture,
    created_at: new Date(Date.parse('2025-03-02T03:00:00Z') + index * 9 * 24 * HOUR).toISOString(),
  }))
  const orders: Order[] = []
  let at = LATEST_ORDER_AT
  for (let index = 0; index < 48; index++) {
    // Newest first: fresh orders are open, then waiting for the warehouse, in transit, delivered.
    const status: OrderStatus =
      index < 7
        ? 'open'
        : index < 15
          ? index % 5 === 0
            ? 'delayed'
            : 'awaiting shipment'
          : index < 26
            ? index % 7 === 3
              ? 'delayed'
              : 'shipped'
            : index % 6 === 1
              ? 'refund requested'
              : 'delivered'
    const created = at
    const shipped = status === 'shipped' || status === 'delivered' || status === 'refund requested' || (status === 'delayed' && index >= 15)
    const carrier = shipped ? (index % 3 === 0 ? 'ヤマト運輸' : index % 3 === 1 ? '佐川急便' : '日本郵便') : null
    const items = 1 + Math.floor(next() * 4)
    orders.push({
      number: `SO-${10468 - index}`,
      customer_id: customers[Math.floor(next() * customers.length)]!.id,
      status,
      total: String(Math.round((1980 + next() * 46000) / 10) * 10),
      currency: 'JPY',
      items,
      payment_method: index % 4 === 0 ? 'bank transfer' : index % 4 === 1 ? 'convenience store' : 'credit card',
      carrier,
      tracking_number: carrier ? `${4000 + index}-${String(Math.floor(next() * 1e8)).padStart(8, '0')}` : null,
      created_at: new Date(created).toISOString(),
      shipped_at: shipped ? new Date(created + 26 * HOUR).toISOString() : null,
      delivered_at: status === 'delivered' || status === 'refund requested' ? new Date(created + 70 * HOUR).toISOString() : null,
    })
    at -= Math.round((5 + next() * 9) * HOUR)
  }
  const refundable = orders.filter((order) => order.status === 'delivered' || order.status === 'refund requested')
  const reasons = ['商品破損', '数量違い', '配送遅延のお詫び', '色違い', null]
  const refunds: Refund[] = refundable.slice(0, 5).map((order, index) => ({
    id: 9001 + index,
    order_number: order.number,
    amount: String(Math.round((Number(order.total) * (index % 2 === 0 ? 0.3 : 1)) / 10) * 10),
    reason: reasons[index] ?? null,
    created_at: new Date(Date.parse(order.delivered_at ?? order.created_at) + 30 * HOUR).toISOString(),
  }))
  return { customers, orders, refunds }
}

// ---------------------------------------------------------------------------
// Storefront (`storefront-api`, an HTTP source)

export type Product = { sku: string; name: string; stock: number; warehouse: string; price: number }

const PRODUCT_SEED: [string, string][] = [
  ['MUG-001', 'マグカップ 白'],
  ['MUG-002', 'マグカップ 藍'],
  ['TSH-101', 'Tシャツ ロゴ S'],
  ['TSH-102', 'Tシャツ ロゴ M'],
  ['TSH-103', 'Tシャツ ロゴ L'],
  ['BAG-201', 'トートバッグ 生成り'],
  ['BAG-202', 'トートバッグ 黒'],
  ['NTB-301', 'ノート A5 方眼'],
  ['NTB-302', 'ノート B5 無地'],
  ['PEN-401', 'ボールペン 0.5mm'],
  ['PEN-402', 'ボールペン 0.7mm'],
  ['CAP-501', 'キャップ ネイビー'],
  ['STK-601', 'ステッカーセット'],
  ['BTL-701', 'ステンレスボトル 500ml'],
  ['BTL-702', 'ステンレスボトル 350ml'],
  ['TWL-801', 'ハンドタオル'],
  ['UMB-901', '折りたたみ傘'],
  ['KEY-911', 'キーホルダー'],
  ['CRD-921', 'ギフトカード'],
  ['PCH-931', 'ポーチ グレー'],
]

export function seedProducts(): Product[] {
  const next = random(931)
  return PRODUCT_SEED.map(([sku, name], index) => ({
    sku,
    name,
    stock: index % 9 === 4 ? 0 : Math.floor(next() * 240),
    warehouse: index % 2 === 0 ? '千葉 DC' : '大阪 DC',
    price: Math.round((480 + next() * 4200) / 10) * 10,
  }))
}

// ---------------------------------------------------------------------------
// Tool documents

/** The golden fixture the Go validator and the SPA schema both accept. */
export const ORDER_DESK: Document = JSON.parse(
  readFileSync(new URL('../../../cmd/server/internal/domain/testdata/documents/valid/order-desk.json', import.meta.url), 'utf8')
) as Document

const STATUS_FILTER = '\n  and (coalesce(cardinality({{ statuses }}), 0) = 0 or o.status = any({{ statuses }}))'

/** search_orders before v9 searched the order number only. */
const SEARCH_ORDERS_BY_NUMBER = `select o.number, c.name as customer, o.total, o.status, o.created_at\nfrom orders o join customers c on c.id = o.customer_id\nwhere o.number ilike coalesce({{ search }}, '') || '%'${STATUS_FILTER}\norder by o.created_at desc limit 50`

/**
 * The order desk as release `n` published it (v1 search → v12 carrier column). Built from the fixture by
 * removing what was added later, so v11 (and its restore, v13) equals the fixture.
 */
export function orderDeskAt(n: number): Document {
  const doc = structuredClone(ORDER_DESK)
  const page = doc.pages[0]!
  const componentSince: Record<string, number> = { search: 1, orders: 1, status: 2, detail: 3, openCount: 4, refundForm: 6 }
  const querySince: Record<string, number> = { search_orders: 1, order_detail: 3, open_count: 4, issue_refund: 7 }
  page.components = page.components.filter((component) => (componentSince[component.id] ?? 1) <= n)
  doc.queries = doc.queries.filter((query) => (querySince[query.id] ?? 1) <= n)
  const orders = page.components.find((component) => component.id === 'orders')!
  const detail = page.components.find((component) => component.id === 'detail')
  const searchOrders = doc.queries.find((query) => query.id === 'search_orders')!
  if (n < 7) delete orders.actions
  const refund = orders.actions?.[0]
  if (refund && n < 8) delete refund.confirm
  if (refund && n < 10) refund.onSuccess = { refresh: ['search_orders'] }
  if (n < 5) orders.props.columns = { kind: 'value', value: [{ name: 'number', label: 'Order' }, { name: 'customer', label: 'Customer' }, { name: 'total', label: 'Total' }, { name: 'status', label: 'Status' }] }
  if (n < 9) searchOrders.sql = { text: SEARCH_ORDERS_BY_NUMBER }
  if (n === 1) {
    searchOrders.sql = { text: SEARCH_ORDERS_BY_NUMBER.replace(STATUS_FILTER, '') }
    searchOrders.params = searchOrders.params.filter((param) => param.name === 'search')
  }
  // Before v11 ("Taller detail panel") the detail was two rows shorter than the fixture's.
  if (detail && n < 11) detail.layout = { ...detail.layout, h: Math.max(1, detail.layout.h - 2) }
  if (n === 12) {
    const columnsProp = orders.props.columns
    const columns = columnsProp?.kind === 'value' && Array.isArray(columnsProp.value) ? columnsProp.value : []
    orders.props.columns = { kind: 'value', value: [...columns, { name: 'carrier', label: 'Carrier' }] }
    searchOrders.sql = { text: searchOrders.sql!.text.replace('o.status, o.created_at', 'o.status, o.carrier, o.created_at') }
  }
  return doc
}

/** The editor's working copy: three unpublished changes over the live v13 (a stat label, a resend action and its query). */
export function orderDeskDraft(): Document {
  const doc = structuredClone(ORDER_DESK)
  const page = doc.pages[0]!
  const openCount = page.components.find((component) => component.id === 'openCount')!
  openCount.props.label = { kind: 'value', value: 'Orders waiting' }
  const orders = page.components.find((component) => component.id === 'orders')!
  orders.actions = [
    ...(orders.actions ?? []),
    {
      id: 'resend_confirmation',
      label: 'Resend confirmation',
      queryId: 'resend_confirmation',
      confirm: { title: 'Resend confirmation', body: 'The customer receives the order confirmation email again.' },
    },
  ]
  doc.queries.push({
    id: 'resend_confirmation',
    name: 'resend_confirmation',
    sourceId: 'ds_storefront',
    mode: 'write',
    http: { method: 'POST', path: '/orders/{{ number }}/resend-confirmation' },
    params: [{ name: 'number', type: 'text', bind: { ref: { component: 'orders', prop: 'selectedRow.number' } } }],
    timeoutMs: 10000,
    rowLimit: 0,
  })
  return doc
}

export const RELEASE_NOTES: Record<number, string> = {
  1: 'First version: search orders by number',
  2: 'Status filter',
  3: 'Order detail panel',
  4: 'Open orders counter',
  5: 'Money format for totals',
  6: 'Refund form',
  7: 'Issue refunds from the desk',
  8: 'Confirm before refunding',
  9: 'Search by customer email',
  10: 'Refresh the detail after a refund',
  11: 'Taller detail panel',
  12: 'Carrier column',
  13: 'Carrier column made the search slow; back to v11',
}

/** Small read-only tool over the storefront's HTTP API. */
export function stockLevelsDocument(): Document {
  return {
    schemaVersion: 1,
    pages: [
      {
        id: 'main',
        title: 'Stock levels',
        components: [
          { id: 'search', type: 'searchInput', layout: { x: 0, y: 0, w: 6, h: 1 }, props: { placeholder: { kind: 'value', value: 'SKU or product name' } } },
          {
            id: 'products',
            type: 'table',
            layout: { x: 0, y: 1, w: 12, h: 8 },
            props: {
              query: { kind: 'value', value: 'list_products' },
              columns: {
                kind: 'value',
                value: [
                  { name: 'sku', label: 'SKU' },
                  { name: 'name', label: 'Product' },
                  { name: 'stock', label: 'In stock' },
                  { name: 'warehouse', label: 'Warehouse' },
                ],
              },
            },
          },
        ],
      },
    ],
    queries: [
      {
        id: 'list_products',
        name: 'list_products',
        sourceId: 'ds_storefront',
        mode: 'read',
        http: { method: 'GET', path: '/products?q={{ search }}', resultPath: 'data.items' },
        params: [{ name: 'search', type: 'text', bind: { ref: { component: 'search', prop: 'value' } } }],
        timeoutMs: 10000,
        rowLimit: 500,
      },
    ],
  }
}

/** A tool still being built: never published. */
export function customerLookupDocument(): Document {
  return {
    schemaVersion: 1,
    pages: [
      {
        id: 'main',
        title: 'Customer lookup',
        components: [
          { id: 'search', type: 'searchInput', layout: { x: 0, y: 0, w: 6, h: 1 }, props: { placeholder: { kind: 'value', value: 'Customer name' } } },
          {
            id: 'customers',
            type: 'table',
            layout: { x: 0, y: 1, w: 12, h: 8 },
            props: { query: { kind: 'value', value: 'find_customers' } },
          },
        ],
      },
    ],
    queries: [
      {
        id: 'find_customers',
        name: 'find_customers',
        sourceId: 'ds_orders',
        mode: 'read',
        sql: { text: "select id, name, email, prefecture, created_at from customers\nwhere name ilike '%' || {{ search }} || '%'\norder by name limit 100" },
        params: [{ name: 'search', type: 'text', bind: { ref: { component: 'search', prop: 'value' } } }],
        timeoutMs: 10000,
        rowLimit: 100,
      },
    ],
  }
}

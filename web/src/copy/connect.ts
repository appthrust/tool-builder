// Connect sheet wording (after dropping a port on a component) and the query-page placeholder handoff.
import { defineDashboardMessages } from '@appthrust/platform-dashboard-i18n'

export const connectMessages = defineDashboardMessages({
  'toolBuilder.connect.title': { defaultMessage: 'Connect {from} to {to}', translations: { ja: '{from} を {to} に接続' } },
  'toolBuilder.connect.description': {
    defaultMessage: 'Choose where the value goes. Values reach a query only as bound parameters.',
    translations: { ja: '値の渡し先を選びます。クエリへはパラメーターとしてのみ渡ります。' },
  },
  'toolBuilder.connect.source': { defaultMessage: 'Value being connected', translations: { ja: '接続する値' } },
  'toolBuilder.connect.path': { defaultMessage: 'Part of the value to send', translations: { ja: '渡す部分' } },
  'toolBuilder.connect.choose': { defaultMessage: 'Send it to', translations: { ja: '渡し先' } },
  'toolBuilder.connect.paramsGroup': { defaultMessage: 'Parameters of query {query}', translations: { ja: 'クエリ {query} のパラメーター' } },
  'toolBuilder.connect.param.unbound': { defaultMessage: 'Not connected yet', translations: { ja: '未接続' } },
  'toolBuilder.connect.param.same': { defaultMessage: 'Already receives this value', translations: { ja: 'すでにこの値を受け取っています' } },
  'toolBuilder.connect.replaces': {
    defaultMessage: 'Now {current}. Connecting replaces the current binding.',
    translations: { ja: '現在は {current}。接続すると今のバインドを置き換えます。' },
  },
  'toolBuilder.connect.replacesValue': {
    defaultMessage: 'Has a fixed value. Connecting replaces it.',
    translations: { ja: '固定値が入っています。接続すると置き換えます。' },
  },
  'toolBuilder.connect.propsGroup': { defaultMessage: 'Properties of {component}', translations: { ja: '{component} のプロパティ' } },
  'toolBuilder.connect.queryGroup': { defaultMessage: 'Change the query text', translations: { ja: 'クエリ本文を変える' } },
  'toolBuilder.connect.placeholder': { defaultMessage: 'Insert {placeholder} into {query}', translations: { ja: '{query} に {placeholder} を挿入' } },
  'toolBuilder.connect.placeholder.hint': {
    defaultMessage: 'Opens the query editor with this placeholder ready; you choose where it goes in the text, then bind it.',
    translations: { ja: 'クエリエディターを開き、このプレースホルダーを挿入できる状態にします。本文のどこに入れるかを決めてからバインドします。' },
  },
  'toolBuilder.connect.noQuery': {
    defaultMessage: '{to} has no query yet. Choose one in its Properties, then connect again.',
    translations: { ja: '{to} にはまだクエリがありません。プロパティでクエリを選んでから、もう一度接続してください。' },
  },
  'toolBuilder.connect.nothing': {
    defaultMessage: '{to} has nothing that can take a value from {from}.',
    translations: { ja: '{to} には {from} の値を受け取れる場所がありません。' },
  },
  'toolBuilder.connect.submit': { defaultMessage: 'Connect value', translations: { ja: '接続する' } },
  'toolBuilder.connect.openQuery': { defaultMessage: 'Open query editor', translations: { ja: 'クエリエディターを開く' } },
  'toolBuilder.connect.filterGroup': { defaultMessage: 'Without writing SQL', translations: { ja: 'SQL を書かずに' } },
  'toolBuilder.connect.filter': { defaultMessage: 'Filter the rows of {query} by this value', translations: { ja: 'この値で {query} の行を絞り込む' } },
  'toolBuilder.connect.filter.hint': {
    defaultMessage: 'Adds a filter and a parameter to the query; the server applies it to the whole result, not only the rows already fetched.',
    translations: { ja: 'クエリに絞り込みとパラメーターを追加します。サーバーが全件に対して適用するので、取得済みの行だけの絞り込みにはなりません。' },
  },
})

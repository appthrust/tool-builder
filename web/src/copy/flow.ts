// Data-flow overlay wording (canvas edges, ports, unconnected hints, the status-bar toggle).
import { defineDashboardMessages } from '@appthrust/platform-dashboard-i18n'

export const flowMessages = defineDashboardMessages({
  'toolBuilder.flow.toggle': { defaultMessage: 'Data flow', translations: { ja: 'データの流れ' } },
  'toolBuilder.flow.toggleTitle': {
    defaultMessage: 'Show or hide the connections between components on the canvas',
    translations: { ja: 'キャンバス上のコンポーネント間の接続を表示/非表示' },
  },
  'toolBuilder.flow.hints.one': { defaultMessage: '1 component not wired', translations: { ja: '未接続のコンポーネント 1 件' } },
  'toolBuilder.flow.hints.many': { defaultMessage: '{count} components not wired', translations: { ja: '未接続のコンポーネント {count} 件' } },
  'toolBuilder.flow.hints.next': {
    defaultMessage: 'Select the next component that is not wired',
    translations: { ja: '次の未接続コンポーネントを選択' },
  },
  'toolBuilder.flow.hint.unconnectedInput': { defaultMessage: 'Not connected', translations: { ja: '未接続' } },
  'toolBuilder.flow.hint.unconnectedInputTitle': {
    defaultMessage: 'Nothing reads this input yet: drag its port onto a component to connect it.',
    translations: { ja: 'この入力はまだどこにも使われていません。ポートをコンポーネントへドラッグして接続します。' },
  },
  'toolBuilder.flow.hint.noData': { defaultMessage: 'No data', translations: { ja: 'データなし' } },
  'toolBuilder.flow.hint.noDataTitle': {
    defaultMessage: 'No query is chosen for this component, so it shows nothing yet.',
    translations: { ja: 'このコンポーネントにはクエリが選ばれていないため、まだ何も表示されません。' },
  },
  'toolBuilder.flow.edge.paramLabel': { defaultMessage: '{query} · {param}', translations: { ja: '{query} · {param}' } },
  'toolBuilder.flow.edge.aria': {
    defaultMessage: 'Connection from {from} to {to}: {label}',
    translations: { ja: '{from} から {to} への接続: {label}' },
  },
  'toolBuilder.flow.edge.route': { defaultMessage: '{from} → {to}', translations: { ja: '{from} → {to}' } },
  'toolBuilder.flow.edge.kind.param': { defaultMessage: 'Query parameter', translations: { ja: 'クエリのパラメータ' } },
  'toolBuilder.flow.edge.kind.prop': { defaultMessage: 'Component property', translations: { ja: 'コンポーネントのプロパティ' } },
  'toolBuilder.flow.edge.kind.form': { defaultMessage: 'Form input of an action', translations: { ja: 'アクションのフォーム入力' } },
  'toolBuilder.flow.edge.formNote': {
    defaultMessage: 'Change this in the action settings of {to}.',
    translations: { ja: '{to} のアクション設定で変更します。' },
  },
  'toolBuilder.flow.edge.openQuery': { defaultMessage: 'Open query in editor', translations: { ja: 'クエリをエディタで開く' } },
  'toolBuilder.flow.edge.disconnect': { defaultMessage: 'Remove this connection', translations: { ja: 'この接続を外す' } },
  'toolBuilder.flow.port.label': { defaultMessage: 'Connect {id} to another component', translations: { ja: '{id} を別のコンポーネントに接続' } },
  'toolBuilder.flow.port.title': { defaultMessage: 'Drag onto a component to connect', translations: { ja: 'コンポーネントへドラッグして接続' } },
  'toolBuilder.flow.port.noTarget': {
    defaultMessage: 'Select the component that should receive the data first, then press Enter on this port.',
    translations: { ja: '先にデータを受け取るコンポーネントを選択してから、このポートで Enter を押してください。' },
  },
  'toolBuilder.flow.dragChip': { defaultMessage: 'Connect {id}…', translations: { ja: '{id} を接続…' } },
  'toolBuilder.flow.keyboardHelp': {
    defaultMessage: 'Enter on a connection port connects that component to the selected component, when it can receive data.',
    translations: { ja: '接続ポートで Enter を押すと、選択中のコンポーネントがデータを受け取れる場合にそのコンポーネントへ接続します。' },
  },
})

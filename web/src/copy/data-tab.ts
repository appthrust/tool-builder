// Property panel "Data" tab wording (upstream / downstream of the selected component).
import { defineDashboardMessages } from '@appthrust/platform-dashboard-i18n'

export const dataTabMessages = defineDashboardMessages({
  'toolBuilder.dataTab.lead': { defaultMessage: 'Data flow of this component', translations: { ja: 'このコンポーネントのデータの流れ' } },
  'toolBuilder.dataTab.count': { defaultMessage: 'Connections in and out: {count}', translations: { ja: '入出力の接続: {count} 件' } },
  'toolBuilder.dataTab.hintDot': { defaultMessage: 'The data flow needs a look', translations: { ja: 'データの流れに確認したい点があります' } },
  'toolBuilder.dataTab.reads': { defaultMessage: 'Reads', translations: { ja: '読み込み元' } },
  'toolBuilder.dataTab.usedBy': { defaultMessage: 'Used by', translations: { ja: '使われている先' } },
  'toolBuilder.dataTab.queryMissing': { defaultMessage: 'Query {id} is not in this tool', translations: { ja: 'クエリ {id} はこのツールにありません' } },
  'toolBuilder.dataTab.noParams': { defaultMessage: 'This query takes no parameters.', translations: { ja: 'このクエリにパラメーターはありません。' } },
  'toolBuilder.dataTab.notBound': { defaultMessage: 'not bound', translations: { ja: '未接続' } },
  'toolBuilder.dataTab.literal': { defaultMessage: 'fixed {value}', translations: { ja: '固定値 {value}' } },
  'toolBuilder.dataTab.param': { defaultMessage: 'param {name}', translations: { ja: 'パラメーター {name}' } },
  'toolBuilder.dataTab.prop': { defaultMessage: 'prop {name}', translations: { ja: 'プロパティ {name}' } },
  'toolBuilder.dataTab.action': { defaultMessage: 'action {label}', translations: { ja: 'アクション「{label}」' } },
  'toolBuilder.dataTab.select': { defaultMessage: 'Select {id} on the canvas', translations: { ja: 'キャンバスで {id} を選択' } },
  'toolBuilder.dataTab.disconnect': { defaultMessage: 'Disconnect {from} from {to}', translations: { ja: '{from} と {to} の接続を外す' } },
  'toolBuilder.dataTab.unconnected': {
    defaultMessage: 'Nothing reads this value yet. Drag its port onto a table, chart, select or text, or bind a query parameter to it.',
    translations: { ja: 'この値を読むものはまだありません。ポートをテーブル、チャート、セレクト、テキストにドラッグするか、クエリのパラメーターに接続してください。' },
  },
  'toolBuilder.dataTab.noData': { defaultMessage: 'Choose a query in Properties.', translations: { ja: 'プロパティでクエリを選んでください。' } },
  'toolBuilder.dataTab.showProperties': { defaultMessage: 'Open Properties', translations: { ja: 'プロパティを開く' } },
  'toolBuilder.dataTab.empty': { defaultMessage: 'No data flows through this component', translations: { ja: 'このコンポーネントを通るデータはありません' } },
  'toolBuilder.dataTab.page.title': { defaultMessage: 'Data flow to check', translations: { ja: '確認したいデータの流れ' } },
  'toolBuilder.dataTab.page.none': { defaultMessage: 'Every input is read and every data component has a query.', translations: { ja: 'すべての入力が読まれ、データを表示するコンポーネントにはクエリがあります。' } },
  'toolBuilder.dataTab.page.unconnectedInput': { defaultMessage: 'Nothing reads its value', translations: { ja: '値を読むものがありません' } },
})

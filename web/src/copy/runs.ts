// Runs wording (`/edit/<slug>/runs`): recent action runs.
import { defineDashboardMessages } from '@appthrust/platform-dashboard-i18n'

export const runMessages = defineDashboardMessages({
  'toolBuilder.runs.documentTitle': { defaultMessage: 'Runs · {tool}', translations: { ja: '実行履歴 · {tool}' } },
  'toolBuilder.runs.lead': {
    defaultMessage: 'Every action run and every write query run from the editor, newest first. Parameter values are never stored. Kept for 90 days.',
    translations: { ja: 'アクションと、エディターから実行した書き込みクエリの記録です (新しい順)。パラメーターの値は保存しません。保存期間は 90 日です。' },
  },
  'toolBuilder.runs.limit': { defaultMessage: 'Show', translations: { ja: '表示件数' } },
  'toolBuilder.runs.limitOption': { defaultMessage: 'Latest {count}', translations: { ja: '最新 {count} 件' } },
  'toolBuilder.runs.empty.title': { defaultMessage: 'No runs yet', translations: { ja: 'まだ実行されていません' } },
  'toolBuilder.runs.empty.body': {
    defaultMessage: 'When someone runs an action of this tool, it shows up here.',
    translations: { ja: 'このツールのアクションが実行されると、ここに表示されます。' },
  },
  'toolBuilder.runs.col.time': { defaultMessage: 'Time', translations: { ja: '日時' } },
  'toolBuilder.runs.col.actor': { defaultMessage: 'Person', translations: { ja: '実行者' } },
  'toolBuilder.runs.col.action': { defaultMessage: 'Action', translations: { ja: 'アクション' } },
  'toolBuilder.runs.col.release': { defaultMessage: 'Release', translations: { ja: 'リリース' } },
  'toolBuilder.runs.col.status': { defaultMessage: 'Result', translations: { ja: '結果' } },
  'toolBuilder.runs.col.rows': { defaultMessage: 'Rows', translations: { ja: '行数' } },
  'toolBuilder.runs.status.ok': { defaultMessage: 'Succeeded', translations: { ja: '成功' } },
  'toolBuilder.runs.status.failed': { defaultMessage: 'Failed', translations: { ja: '失敗' } },
  'toolBuilder.runs.status.denied': { defaultMessage: 'Denied', translations: { ja: '拒否' } },
  'toolBuilder.runs.editorRun': { defaultMessage: 'Query editor run of {query}', translations: { ja: 'クエリエディターから {query} を実行' } },
  'toolBuilder.runs.rows': { defaultMessage: '{count} rows', translations: { ja: '{count} 行' } },
})

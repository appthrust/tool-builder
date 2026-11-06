// Tool page wording (`/t/<slug>`): header, draft preview banner, the
// request-access page, the "not published yet" state.
import { defineDashboardMessages } from '@appthrust/platform-dashboard-i18n'

export const runtimeMessages = defineDashboardMessages({
  'toolBuilder.runtime.version': { defaultMessage: 'v{number}', translations: { ja: 'v{number}' } },
  'toolBuilder.runtime.published': { defaultMessage: 'Published {date} by {name}', translations: { ja: '{date} {name} が公開' } },
  'toolBuilder.runtime.restored': { defaultMessage: 'Restored v{from} on {date} by {name}', translations: { ja: '{date} {name} が v{from} を復元' } },
  'toolBuilder.runtime.openEditor': { defaultMessage: 'Open editor', translations: { ja: 'エディタを開く' } },
  'toolBuilder.runtime.nav': { defaultMessage: 'Your tools', translations: { ja: 'あなたのツール' } },
  'toolBuilder.runtime.allTools': { defaultMessage: 'All tools', translations: { ja: 'すべてのツール' } },
  'toolBuilder.runtime.previewTitle': { defaultMessage: 'Previewing the draft', translations: { ja: '下書きをプレビューしています' } },
  'toolBuilder.runtime.previewBody': {
    defaultMessage: 'Queries and actions run against real data. Members still see v{number}.',
    translations: { ja: 'クエリと操作は実際のデータに対して実行されます。メンバーには引き続き v{number} が表示されます。' },
  },
  'toolBuilder.runtime.previewBodyUnpublished': {
    defaultMessage: 'Queries and actions run against real data. Members cannot open this tool until it is published.',
    translations: { ja: 'クエリと操作は実際のデータに対して実行されます。公開するまでメンバーはこのツールを開けません。' },
  },
  'toolBuilder.runtime.backToEditor': { defaultMessage: 'Back to editor', translations: { ja: 'エディタに戻る' } },
  'toolBuilder.runtime.viewLive': { defaultMessage: 'View live version', translations: { ja: '公開版を見る' } },
  'toolBuilder.runtime.unpublishedTitle': { defaultMessage: 'This tool is not published yet', translations: { ja: 'このツールはまだ公開されていません' } },
  'toolBuilder.runtime.unpublishedBody': {
    defaultMessage: 'Preview the draft or publish it from the editor so members can use it.',
    translations: { ja: '下書きをプレビューするか、エディタから公開するとメンバーが使えるようになります。' },
  },
  'toolBuilder.runtime.previewDraft': { defaultMessage: 'Preview draft', translations: { ja: '下書きをプレビュー' } },
  'toolBuilder.runtime.unavailableTitle': { defaultMessage: 'This tool is not available', translations: { ja: 'このツールは利用できません' } },
  'toolBuilder.runtime.unavailableBody': {
    defaultMessage: 'It has not been published yet. Ask an editor of the tool.',
    translations: { ja: 'まだ公開されていません。ツールの編集者に確認してください。' },
  },
  'toolBuilder.runtime.denied.title': { defaultMessage: 'You don’t have access to {tool}', translations: { ja: '{tool} を使う権限がありません' } },
  'toolBuilder.runtime.denied.body': {
    defaultMessage: 'An editor of this tool must share it with a group you belong to. Ask them for access.',
    translations: { ja: 'このツールの編集者が、あなたの所属するグループに共有する必要があります。編集者にアクセスを依頼してください。' },
  },
  'toolBuilder.runtime.denied.editors': { defaultMessage: 'Groups that edit this tool', translations: { ja: 'このツールを編集できるグループ' } },
  'toolBuilder.runtime.denied.back': { defaultMessage: 'Back to your tools', translations: { ja: 'ツール一覧に戻る' } },
})

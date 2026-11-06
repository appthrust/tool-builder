// Home wording (`/`): the caller's tools grouped by what they may do, search,
// and the administrator's "New tool" dialog.
import { defineDashboardMessages } from '@appthrust/platform-dashboard-i18n'

export const homeMessages = defineDashboardMessages({
  'toolBuilder.home.lead': {
    defaultMessage: 'Tables, forms and dashboards on the data in this Project.',
    translations: { ja: 'このプロジェクトのデータを使うテーブル、フォーム、ダッシュボードです。' },
  },
  'toolBuilder.home.search': { defaultMessage: 'Search tools', translations: { ja: 'ツールを検索' } },
  'toolBuilder.home.canEdit': { defaultMessage: 'You can edit', translations: { ja: '編集できるツール' } },
  'toolBuilder.home.canUse': { defaultMessage: 'You can use', translations: { ja: '使えるツール' } },
  'toolBuilder.home.count': { defaultMessage: '{count} tools', translations: { ja: '{count} 件' } },
  'toolBuilder.home.newTool': { defaultMessage: 'New tool', translations: { ja: 'ツールを作成' } },
  'toolBuilder.home.editNamed': { defaultMessage: 'Edit {tool}', translations: { ja: '{tool} を編集' } },
  'toolBuilder.home.unpublished': { defaultMessage: 'Not published', translations: { ja: '未公開' } },
  'toolBuilder.home.live': { defaultMessage: 'Live v{number}', translations: { ja: '公開中 v{number}' } },
  'toolBuilder.home.draftUpdated': { defaultMessage: 'Draft saved {date}', translations: { ja: '下書き保存 {date}' } },
  'toolBuilder.home.noDescription': { defaultMessage: 'No description', translations: { ja: '説明はありません' } },
  'toolBuilder.home.emptyUser.title': { defaultMessage: 'No tools are shared with you yet', translations: { ja: 'まだ共有されたツールはありません' } },
  'toolBuilder.home.emptyUser.body': {
    defaultMessage: 'Ask an editor to share a tool with one of your groups.',
    translations: { ja: 'あなたの所属するグループにツールを共有するよう、編集者に依頼してください。' },
  },
  'toolBuilder.home.emptyAdmin.title': { defaultMessage: 'Create your first tool', translations: { ja: '最初のツールを作成しましょう' } },
  'toolBuilder.home.emptyAdmin.body': {
    defaultMessage: 'Connect a data source, then build a table, form or dashboard on it and share it with your team.',
    translations: { ja: 'データソースを接続し、そのデータでテーブルやフォーム、ダッシュボードを作ってチームに共有します。' },
  },
  'toolBuilder.home.noMatches': { defaultMessage: 'No tools match “{query}”', translations: { ja: '「{query}」に一致するツールはありません' } },
  'toolBuilder.home.create.description': {
    defaultMessage: 'The tool starts as an empty draft that only editors can see.',
    translations: { ja: 'ツールは空の下書きとして作成され、編集者だけが見られます。' },
  },
  'toolBuilder.home.create.name': { defaultMessage: 'Tool name', translations: { ja: 'ツール名' } },
  'toolBuilder.home.create.slug': { defaultMessage: 'Address', translations: { ja: 'アドレス' } },
  'toolBuilder.home.create.slugHint': {
    defaultMessage: 'Opens at /t/{slug}. Lowercase letters, numbers and hyphens.',
    translations: { ja: '/t/{slug} で開きます。小文字の英字、数字、ハイフンが使えます。' },
  },
  'toolBuilder.home.create.slugInvalid': {
    defaultMessage: 'Use 1–63 lowercase letters, numbers or hyphens, starting and ending with a letter or number.',
    translations: { ja: '小文字の英字・数字・ハイフンで 1〜63 文字にし、先頭と末尾は英数字にしてください。' },
  },
  'toolBuilder.home.create.nameRequired': { defaultMessage: 'Enter a name.', translations: { ja: '名前を入力してください。' } },
  'toolBuilder.home.create.descriptionLabel': { defaultMessage: 'Description', translations: { ja: '説明' } },
  'toolBuilder.home.create.optional': { defaultMessage: 'Optional', translations: { ja: '任意' } },
  'toolBuilder.home.create.submit': { defaultMessage: 'Create tool', translations: { ja: '作成する' } },
})

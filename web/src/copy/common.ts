// Shell, navigation, feedback and error wording shared by every screen.
import { defineDashboardMessages } from '@appthrust/platform-dashboard-i18n'

export const commonMessages = defineDashboardMessages({
  'toolBuilder.product': { defaultMessage: 'Internal Tool Builder', translations: { ja: '社内ツールビルダー' } },
  'toolBuilder.language.ja': { defaultMessage: '日本語', translations: { ja: '日本語' } },
  'toolBuilder.language.en': { defaultMessage: 'English', translations: { ja: 'English' } },
  'toolBuilder.nav.label': { defaultMessage: 'Internal Tool Builder sections', translations: { ja: '社内ツールビルダーのメニュー' } },
  'toolBuilder.nav.tools': { defaultMessage: 'Tools', translations: { ja: 'ツール' } },
  'toolBuilder.nav.dataSources': { defaultMessage: 'Data sources', translations: { ja: 'データソース' } },
  'toolBuilder.nav.you': { defaultMessage: 'Signed in as', translations: { ja: 'サインイン中' } },
  'toolBuilder.nav.language': { defaultMessage: 'Display language', translations: { ja: '表示言語' } },
  'toolBuilder.nav.theme': { defaultMessage: 'Color theme', translations: { ja: '配色' } },
  'toolBuilder.theme.system': { defaultMessage: 'Follow the system', translations: { ja: 'システムに合わせる' } },
  'toolBuilder.theme.light': { defaultMessage: 'Light', translations: { ja: 'ライト' } },
  'toolBuilder.theme.dark': { defaultMessage: 'Dark', translations: { ja: 'ダーク' } },
  'toolBuilder.nav.skipToMain': { defaultMessage: 'Skip to main content', translations: { ja: '本文へ移動' } },
  'toolBuilder.role.admin': { defaultMessage: 'Administrator', translations: { ja: '管理者' } },
  'toolBuilder.common.loading': { defaultMessage: 'Loading…', translations: { ja: '読み込んでいます…' } },
  'toolBuilder.common.loadFailed': { defaultMessage: "Couldn't load this page", translations: { ja: '読み込めませんでした' } },
  'toolBuilder.common.retry': { defaultMessage: 'Try again', translations: { ja: 'もう一度読み込む' } },
  'toolBuilder.common.accessDenied': {
    defaultMessage: 'This account cannot use Internal Tool Builder. Sign in again or ask an administrator.',
    translations: { ja: 'このアカウントでは社内ツールビルダーを使えません。サインインし直すか、管理者に確認してください。' },
  },
  'toolBuilder.common.actionFailed': { defaultMessage: "Couldn't complete the action", translations: { ja: '操作を完了できませんでした' } },
  'toolBuilder.common.close': { defaultMessage: 'Close', translations: { ja: '閉じる' } },
  'toolBuilder.common.cancel': { defaultMessage: 'Cancel', translations: { ja: 'キャンセル' } },
  'toolBuilder.common.save': { defaultMessage: 'Save', translations: { ja: '保存する' } },
  'toolBuilder.common.required': { defaultMessage: 'Required', translations: { ja: '必須' } },
  'toolBuilder.common.breadcrumbs': { defaultMessage: 'Breadcrumbs', translations: { ja: 'パンくずリスト' } },
  'toolBuilder.common.copyLink': { defaultMessage: 'Copy link', translations: { ja: 'リンクをコピー' } },
  'toolBuilder.common.copied': { defaultMessage: 'Copied', translations: { ja: 'コピーしました' } },
  'toolBuilder.errors.transient': {
    defaultMessage: 'Internal Tool Builder is temporarily unavailable. Try again in a moment.',
    translations: { ja: '社内ツールビルダーに一時的につながりません。少し待ってからもう一度お試しください。' },
  },
  'toolBuilder.errors.invalid': { defaultMessage: 'Check the entered values.', translations: { ja: '入力内容を確認してください。' } },
  'toolBuilder.errors.conflict': { defaultMessage: 'This value is already in use.', translations: { ja: 'この値はすでに使われています。' } },
  'toolBuilder.errors.not_found': { defaultMessage: 'This item no longer exists.', translations: { ja: 'この項目は見つかりません。' } },
  'toolBuilder.errors.forbidden': { defaultMessage: "You don't have permission for this action.", translations: { ja: 'この操作をする権限がありません。' } },
  'toolBuilder.errors.tool_forbidden': { defaultMessage: "You don't have access to this tool.", translations: { ja: 'このツールを使う権限がありません。' } },
  'toolBuilder.errors.invalid_document': {
    defaultMessage: 'The tool has problems to fix before it can be saved or published.',
    translations: { ja: 'ツールに直す必要のある問題があるため、保存または公開できません。' },
  },
  'toolBuilder.errors.draft_changed': {
    defaultMessage: 'Someone else changed this draft. Reload to see the latest version.',
    translations: { ja: 'ほかの人がこの下書きを変更しました。再読み込みして最新の内容を確認してください。' },
  },
  'toolBuilder.errors.slug_taken': { defaultMessage: 'This address is already in use.', translations: { ja: 'このアドレスはすでに使われています。' } },
  'toolBuilder.errors.data_source_in_use': {
    defaultMessage: 'A tool still uses this data source. Remove it from those tools first.',
    translations: { ja: 'このデータソースを使っているツールがあります。先にツールから外してください。' },
  },
  'toolBuilder.errors.data_source_pending': {
    defaultMessage: 'This data source is still being connected. Try again in a few minutes.',
    translations: { ja: 'このデータソースは接続の準備中です。数分後にもう一度お試しください。' },
  },
  'toolBuilder.errors.data_source_busy': {
    defaultMessage: 'The data source is busy. Try again in a moment.',
    translations: { ja: 'データソースが混み合っています。少し待ってからもう一度お試しください。' },
  },
  'toolBuilder.errors.data_source_unavailable': {
    defaultMessage: "The data source can't be reached right now.",
    translations: { ja: 'データソースに接続できません。' },
  },
  'toolBuilder.errors.query_not_read_only': {
    defaultMessage: 'This query changes data, so it cannot run here.',
    translations: { ja: 'このクエリはデータを変更するため、ここでは実行できません。' },
  },
  'toolBuilder.errors.query_timeout': { defaultMessage: 'The query took too long and was stopped.', translations: { ja: 'クエリの実行時間が上限を超えたため停止しました。' } },
  'toolBuilder.errors.query_failed': { defaultMessage: 'The query failed.', translations: { ja: 'クエリを実行できませんでした。' } },
  'toolBuilder.errors.write_not_confirmed': {
    defaultMessage: 'Confirm before running a query that changes data.',
    translations: { ja: 'データを変更するクエリは、確認してから実行してください。' },
  },
  'toolBuilder.errors.action_denied': { defaultMessage: "You don't have permission to run this action.", translations: { ja: 'この操作を実行する権限がありません。' } },
  'toolBuilder.errors.identity_unavailable': {
    defaultMessage: "Your groups couldn't be checked. Try again in a moment.",
    translations: { ja: '所属グループを確認できませんでした。少し待ってからもう一度お試しください。' },
  },
  'toolBuilder.errors.tool_builder_store_unavailable': {
    defaultMessage: "Internal Tool Builder can't reach its storage right now. Try again in a moment.",
    translations: { ja: '社内ツールビルダーの保存先に一時的につながりません。少し待ってからもう一度お試しください。' },
  },
  'toolBuilder.errors.internal_service_required': {
    defaultMessage: "This app doesn't accept calls from inside the project yet. Turn on its internal address (it needs at least one running instance), then connect it again.",
    translations: {
      ja: 'このアプリはまだプロジェクト内からの呼び出しを受け付けていません。内部アドレスを有効にして(常時 1 台以上の起動が必要です)、もう一度接続してください。',
    },
  },
  'toolBuilder.errors.link_not_declared': {
    defaultMessage: 'The tool builder cannot call this installed app. Reload the page and choose another one.',
    translations: { ja: 'ツールビルダーはこのインストール済みアプリを呼び出せません。ページを再読み込みして、別のインストール済みアプリを選んでください。' },
  },
  'toolBuilder.forbidden.body': {
    defaultMessage: 'Ask an administrator or the tool’s editors for access.',
    translations: { ja: '管理者またはツールの編集者にアクセス権を依頼してください。' },
  },
  'toolBuilder.notFound.title': { defaultMessage: 'Page not found', translations: { ja: 'ページが見つかりません' } },
  'toolBuilder.notFound.body': {
    defaultMessage: 'The tool may have been archived, or the address may be wrong.',
    translations: { ja: 'このツールはアーカイブされたか、アドレスが間違っている可能性があります。' },
  },
  'toolBuilder.notFound.home': { defaultMessage: 'Open the tool list', translations: { ja: 'ツール一覧を開く' } },
})

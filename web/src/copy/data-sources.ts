// `/data-sources` (admin): connected databases, connect dialog, delete.
import { defineDashboardMessages } from '@appthrust/platform-dashboard-i18n'

export const dataSourcesMessages = defineDashboardMessages({
  'toolBuilder.dataSources.lead': {
    defaultMessage:
      'Databases and installed apps of this Project that tools can query. Database queries run with the access of the connection, so connect only what tools should reach; installed app queries run as the person using the tool.',
    translations: {
      ja: 'ツールからクエリできる、この Project のデータベースとインストール済みアプリです。データベースへのクエリは接続の権限で実行されるため、ツールに見せてよいものだけを接続してください。インストール済みアプリへのクエリはツールを使う人の権限で実行されます。',
    },
  },
  'toolBuilder.dataSources.leadEditor': {
    defaultMessage: 'Databases and installed apps of this Project that your queries can use. Ask a Team administrator to connect another one.',
    translations: { ja: 'クエリで使える、この Project のデータベースとインストール済みアプリです。ほかのデータソースの接続は Team の管理者に依頼してください。' },
  },
  'toolBuilder.dataSources.noAccess.title': { defaultMessage: 'Data sources are for administrators and tool editors', translations: { ja: 'データソースは管理者とツールの編集者向けです' } },
  'toolBuilder.dataSources.noAccess.body': {
    defaultMessage: 'Ask a Team administrator to connect the database you need, or ask to edit a tool.',
    translations: { ja: '必要なデータベースの接続は Team の管理者に、ツールの編集権限はツールの編集者に依頼してください。' },
  },
  'toolBuilder.dataSources.connect': { defaultMessage: 'Connect a database', translations: { ja: 'データベースを接続' } },
  'toolBuilder.dataSources.empty.title': { defaultMessage: 'No data sources yet', translations: { ja: 'データソースはまだありません' } },
  'toolBuilder.dataSources.empty.body': {
    defaultMessage: 'Connect a Project database so tools can show and change its data.',
    translations: { ja: 'Project のデータベースを接続すると、ツールでそのデータを表示・更新できます。' },
  },
  'toolBuilder.dataSources.col.status': { defaultMessage: 'Status', translations: { ja: '状態' } },
  'toolBuilder.dataSources.col.connection': { defaultMessage: 'Connection', translations: { ja: '接続名' } },
  'toolBuilder.dataSources.col.created': { defaultMessage: 'Connected', translations: { ja: '接続日' } },
  'toolBuilder.dataSources.kind.postgres': { defaultMessage: 'Database', translations: { ja: 'データベース' } },
  'toolBuilder.dataSources.kind.http': { defaultMessage: 'App', translations: { ja: 'アプリ' } },
  'toolBuilder.dataSources.status.ready': { defaultMessage: 'Ready', translations: { ja: '利用可能' } },
  'toolBuilder.dataSources.status.pending': { defaultMessage: 'Connecting', translations: { ja: '接続中' } },
  'toolBuilder.dataSources.status.pendingHint': {
    defaultMessage: 'Waiting for the new revision. This usually takes a minute or two.',
    translations: { ja: '新しいリビジョンの起動を待っています。通常 1〜2 分で完了します。' },
  },
  'toolBuilder.dataSources.status.error': { defaultMessage: 'Error', translations: { ja: 'エラー' } },
  'toolBuilder.dataSources.delete': { defaultMessage: 'Delete {name}', translations: { ja: '{name} を削除' } },
  'toolBuilder.dataSources.connectLead': {
    defaultMessage: 'Choose a database of this Project. The tool builder restarts with the new connection.',
    translations: { ja: 'この Project のデータベースを選びます。ツールビルダーは新しい接続を持って再起動します。' },
  },
  'toolBuilder.dataSources.connectSubmit': { defaultMessage: 'Connect', translations: { ja: '接続する' } },
  'toolBuilder.dataSources.form.databaseRequired': { defaultMessage: 'Choose a database.', translations: { ja: 'データベースを選んでください。' } },
  'toolBuilder.dataSources.form.noDatabases': { defaultMessage: 'This Project has no databases yet.', translations: { ja: 'この Project にはまだデータベースがありません。' } },
  'toolBuilder.dataSources.form.alreadyConnected': { defaultMessage: 'Already connected', translations: { ja: '接続済み' } },
  'toolBuilder.dataSources.engine.postgres': { defaultMessage: 'PostgreSQL', translations: { ja: 'PostgreSQL' } },
  'toolBuilder.dataSources.engine.other': { defaultMessage: 'Other database type', translations: { ja: 'その他の種類のデータベース' } },
  'toolBuilder.dataSources.reason.engineUnsupported': { defaultMessage: 'This database type is not supported yet', translations: { ja: 'この種類のデータベースにはまだ対応していません' } },
  'toolBuilder.dataSources.reason.other': { defaultMessage: 'This database cannot be connected', translations: { ja: 'このデータベースは接続できません' } },
  'toolBuilder.dataSources.form.nameHint': { defaultMessage: 'What editors see when they write queries.', translations: { ja: 'クエリを書く編集者に表示される名前です。' } },
  'toolBuilder.dataSources.form.nameRequired': { defaultMessage: 'Enter a name for the data source.', translations: { ja: 'データソースの名前を入力してください。' } },
  'toolBuilder.dataSources.form.slug': { defaultMessage: 'ID', translations: { ja: 'ID' } },
  'toolBuilder.dataSources.form.slugHint': { defaultMessage: 'Unique among data sources.', translations: { ja: 'データソースの中で一意です。' } },
  'toolBuilder.dataSources.form.slugTaken': { defaultMessage: 'Another data source has this ID.', translations: { ja: 'この ID はほかのデータソースが使っています。' } },
  'toolBuilder.dataSources.form.connection': { defaultMessage: 'Connection name', translations: { ja: '接続名' } },
  'toolBuilder.dataSources.form.connectionHint': { defaultMessage: 'The name of the connection in the Project.', translations: { ja: 'Project 上での接続の名前です。' } },
  'toolBuilder.dataSources.form.dnsLabel': {
    defaultMessage: 'Use lowercase letters, digits and hyphens (up to 63), starting with a letter and not ending with a hyphen.',
    translations: { ja: '英小文字・数字・ハイフン（63 文字まで）を使い、英字で始めてハイフンで終わらないようにしてください。' },
  },
  'toolBuilder.dataSources.form.rolloutNote': {
    defaultMessage: 'The data source is “Connecting” until the tool builder has restarted with it; queries on it wait until then.',
    translations: { ja: 'ツールビルダーが新しい接続で再起動するまで、データソースは「接続中」です。それまでこのデータソースのクエリは待機します。' },
  },
  'toolBuilder.dataSources.deleteTitle': { defaultMessage: 'Delete {name}?', translations: { ja: '{name} を削除しますか？' } },
  'toolBuilder.dataSources.deleteBody': {
    defaultMessage: 'Tools can no longer query it and the connection is removed from the Project. The data in the database is not touched.',
    translations: { ja: 'ツールからクエリできなくなり、Project から接続が削除されます。データベースのデータには影響しません。' },
  },
  'toolBuilder.dataSources.inUse.title': { defaultMessage: 'Queries still use this data source', translations: { ja: 'このデータソースを使うクエリが残っています' } },
  'toolBuilder.dataSources.inUse.tools': { defaultMessage: 'Change or remove their queries first:', translations: { ja: '先に次のツールのクエリを変更または削除してください:' } },
  'toolBuilder.dataSources.inUse.generic': {
    defaultMessage: 'A draft or published query of a tool still uses it. Change or remove those queries first.',
    translations: { ja: 'ツールの下書きか公開中のクエリがまだ使っています。先にそのクエリを変更または削除してください。' },
  },
  'toolBuilder.dataSources.deleteBodyInstalledApp': {
    defaultMessage: 'Tools can no longer query it. The installed app and its data are not touched.',
    translations: { ja: 'ツールからクエリできなくなります。インストール済みアプリとそのデータには影響しません。' },
  },
  'toolBuilder.dataSources.kind.installedApp': { defaultMessage: 'Installed app', translations: { ja: 'インストール済みアプリ' } },
  'toolBuilder.dataSources.kind.installedAppOf': { defaultMessage: 'Installed app: {name}', translations: { ja: 'インストール済みアプリ: {name}' } },
  'toolBuilder.dataSources.installedApp.directory': { defaultMessage: 'Directory', translations: { ja: 'ディレクトリ' } },
  'toolBuilder.dataSources.installedApp.knowledge': { defaultMessage: 'Knowledge', translations: { ja: 'ナレッジ' } },
  'toolBuilder.dataSources.installedApp.builderConsole': { defaultMessage: 'Builder Console', translations: { ja: 'ビルダーコンソール' } },
  'toolBuilder.dataSources.addInstalledApp': { defaultMessage: 'Add an installed app', translations: { ja: 'インストール済みアプリを追加' } },
  'toolBuilder.dataSources.addInstalledAppLead': {
    defaultMessage: 'Choose an installed app of this Project. Queries call its API as the person using the tool, so they return only what that person may see.',
    translations: { ja: 'この Project のインストール済みアプリを選びます。クエリはツールを使う人としてインストール済みアプリの API を呼ぶため、その人が見られるものだけが返ります。' },
  },
  'toolBuilder.dataSources.addInstalledAppSubmit': { defaultMessage: 'Add data source', translations: { ja: 'データソースを追加' } },
  'toolBuilder.dataSources.installedApp.installing': { defaultMessage: 'Installing', translations: { ja: 'インストール中' } },
  'toolBuilder.dataSources.installedApp.installingHint': {
    defaultMessage: 'You can add it now; its queries run once the installation finishes.',
    translations: { ja: 'いま追加できます。インストールが終わるとクエリを実行できます。' },
  },
  'toolBuilder.dataSources.installedApp.absent': { defaultMessage: 'Not installed', translations: { ja: '未インストール' } },
  'toolBuilder.dataSources.installedApp.absentHint': {
    defaultMessage: 'Install {name} from the Marketplace of this Project to use it here.',
    translations: { ja: 'Project のマーケットプレイスで {name} をインストールすると、ここで使えます。' },
  },
  'toolBuilder.dataSources.installedApp.alreadyAdded': { defaultMessage: 'Already added', translations: { ja: '追加済み' } },
  'toolBuilder.dataSources.installedApp.none': {
    defaultMessage: 'No installed app of this Project can be used as a data source.',
    translations: { ja: 'データソースとして使えるこの Project のインストール済みアプリはありません。' },
  },
  'toolBuilder.dataSources.form.installedAppRequired': { defaultMessage: 'Choose an installed app.', translations: { ja: 'インストール済みアプリを選んでください。' } },
  'toolBuilder.dataSources.status.installingHint': {
    defaultMessage: 'Waiting for the installed app to finish installing.',
    translations: { ja: 'インストール済みアプリのインストール完了を待っています。' },
  },
})

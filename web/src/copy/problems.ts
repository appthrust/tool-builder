// Document validation problems (`Problem.code`, the reason codes of
// cmd/server/internal/domain/testdata/documents/README.md) as
// people read them. `model/problems.ts` picks the id; the English API message
// is only the fallback for a code this build does not know.
import { defineDashboardMessages } from '@appthrust/platform-dashboard-i18n'

export const problemMessages = defineDashboardMessages({
  'toolBuilder.problem.schema': { defaultMessage: 'This value is not in a format the tool builder reads ({path}).', translations: { ja: 'この値はツールビルダーが読める形式ではありません（{path}）。' } },
  'toolBuilder.problem.schemaDocument': { defaultMessage: 'The tool is not in a format the tool builder reads.', translations: { ja: 'ツールがツールビルダーの読める形式ではありません。' } },
  'toolBuilder.problem.onePageRequired': { defaultMessage: 'A tool has exactly one page.', translations: { ja: 'ツールのページはちょうど 1 つです。' } },
  'toolBuilder.problem.unknownComponentType': { defaultMessage: 'This kind of component is not available.', translations: { ja: 'この種類のコンポーネントは使えません。' } },
  'toolBuilder.problem.duplicateId.page': { defaultMessage: 'Another page already has this ID.', translations: { ja: '同じ ID のページがすでにあります。' } },
  'toolBuilder.problem.duplicateId.component': { defaultMessage: 'Another component already has this ID.', translations: { ja: '同じ ID のコンポーネントがすでにあります。' } },
  'toolBuilder.problem.duplicateId.query': { defaultMessage: 'Another query already has this ID.', translations: { ja: '同じ ID のクエリがすでにあります。' } },
  'toolBuilder.problem.duplicateId.action': { defaultMessage: 'Another action already has this ID.', translations: { ja: '同じ ID のアクションがすでにあります。' } },
  'toolBuilder.problem.duplicateId.param': { defaultMessage: 'Another parameter of this query has the same name.', translations: { ja: 'このクエリに同じ名前のパラメーターがすでにあります。' } },
  'toolBuilder.problem.duplicateId.field': { defaultMessage: 'Another field of this form has the same name.', translations: { ja: 'このフォームに同じ名前のフィールドがすでにあります。' } },
  'toolBuilder.problem.duplicateId.tab': { defaultMessage: 'Another tab has the same ID.', translations: { ja: '同じ ID のタブがすでにあります。' } },
  'toolBuilder.problem.duplicateId': { defaultMessage: 'Another item already has this ID.', translations: { ja: '同じ ID の項目がすでにあります。' } },
  'toolBuilder.problem.layoutOutOfGrid': { defaultMessage: 'The component does not fit the {columns}-column grid.', translations: { ja: 'コンポーネントが {columns} 列のグリッドに収まっていません。' } },
  'toolBuilder.problem.unknownParent': { defaultMessage: 'A component can only sit in a container or tabs, without going in a circle.', translations: { ja: 'コンポーネントを置けるのはコンテナーかタブの中だけで、入れ子が循環してはいけません。' } },
  'toolBuilder.problem.querySourceMissing': {
    defaultMessage: 'The query needs either SQL or a request, and a connected data source of the matching kind.',
    translations: { ja: 'クエリには SQL かリクエストのどちらか一方と、それに合う種類の接続済みデータソースが必要です。' },
  },
  'toolBuilder.problem.emptyQuery': { defaultMessage: 'The SQL is empty. Write the query before running or publishing it.', translations: { ja: 'SQL が空です。実行や公開の前にクエリを書いてください。' } },
  'toolBuilder.problem.timeoutOutOfRange': { defaultMessage: 'The timeout must be between 1 and {max} ms.', translations: { ja: 'タイムアウトは 1〜{max} ミリ秒にしてください。' } },
  'toolBuilder.problem.rowLimitOutOfRange': { defaultMessage: 'The row limit must be at most {max}, and at least 1 for a read query.', translations: { ja: '行数の上限は {max} 以下にしてください。読み取りクエリでは 1 以上が必要です。' } },
  'toolBuilder.problem.positionalPlaceholder': { defaultMessage: 'Use {{ name }} placeholders instead of $1, $2 and so on.', translations: { ja: '$1 や $2 ではなく {{ name }} 形式のプレースホルダーを使ってください。' } },
  'toolBuilder.problem.multipleStatements': { defaultMessage: 'A query is a single statement without a semicolon.', translations: { ja: 'クエリはセミコロンを含まない 1 つの文にしてください。' } },
  'toolBuilder.problem.placeholderInLiteral': {
    defaultMessage: 'A placeholder inside quotes or a comment is not filled in. Move it outside the quotes.',
    translations: { ja: '引用符やコメントの中のプレースホルダーには値が入りません。引用符の外に出してください。' },
  },
  'toolBuilder.problem.placeholderWithoutParam': { defaultMessage: 'Every placeholder in the query needs a parameter with the same name.', translations: { ja: 'クエリのプレースホルダーには、同じ名前のパラメーターが必要です。' } },
  'toolBuilder.problem.paramWithoutPlaceholder': { defaultMessage: 'Parameter has no placeholder or filter', translations: { ja: 'パラメーターに対応するプレースホルダーも絞り込みもありません' } },
  'toolBuilder.problem.filterNotSupported': { defaultMessage: 'Filters are available only for read SQL queries.', translations: { ja: '絞り込みは読み取り SQL クエリでのみ使えます。' } },
  'toolBuilder.problem.filterParamUnknown': { defaultMessage: 'The filter needs a declared parameter of this query.', translations: { ja: '絞り込みには、このクエリで定義されたパラメーターが必要です。' } },
  'toolBuilder.problem.filterParamType': { defaultMessage: 'The in filter needs a list parameter; other filter operators need a single value.', translations: { ja: '「いずれかに一致」にはリスト型、それ以外の絞り込みには単一の値のパラメーターが必要です。' } },
  'toolBuilder.problem.filterColumnInvalid': { defaultMessage: 'A filter column must be 1–63 bytes and contain no double quote or NUL character.', translations: { ja: '絞り込みの列名は 1〜63 バイトで、二重引用符と NUL 文字を含めないでください。' } },
  'toolBuilder.problem.unknownQuery': { defaultMessage: 'The chosen query no longer exists.', translations: { ja: '選んだクエリはもうありません。' } },
  'toolBuilder.problem.writeQueryNotAction': { defaultMessage: 'A write query runs only from an action; it cannot show data or be refreshed.', translations: { ja: '書き込みクエリはアクションからのみ実行できます。データの表示や再読み込みには使えません。' } },
  'toolBuilder.problem.unknownActionQuery': { defaultMessage: 'The query of this action no longer exists.', translations: { ja: 'このアクションのクエリはもうありません。' } },
  'toolBuilder.problem.actionQueryNotWrite': { defaultMessage: 'An action runs a write query; this query only reads.', translations: { ja: 'アクションは書き込みクエリを実行します。このクエリは読み取り用です。' } },
  'toolBuilder.problem.unknownFormComponent': { defaultMessage: 'The input of this action must be a form.', translations: { ja: 'このアクションの入力にはフォームを指定してください。' } },
  'toolBuilder.problem.unknownRefComponent': { defaultMessage: 'The linked component no longer exists.', translations: { ja: 'リンク先のコンポーネントはもうありません。' } },
  'toolBuilder.problem.propNotExposed': { defaultMessage: 'The linked component does not provide this value.', translations: { ja: 'リンク先のコンポーネントはこの値を提供していません。' } },
  'toolBuilder.problem.bindingCycle': { defaultMessage: 'Links lead back to where they start. Remove one link to break the loop.', translations: { ja: 'リンクが元の場所に戻ってきています。どれか 1 つを外して循環をなくしてください。' } },
})

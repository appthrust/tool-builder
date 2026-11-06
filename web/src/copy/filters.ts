// Structured query filters wording (query editor section, params panel origin, connect sheet option).
import { defineDashboardMessages } from '@appthrust/platform-dashboard-i18n'

export const filtersMessages = defineDashboardMessages({
  'toolBuilder.filters.section': { defaultMessage: 'Filters', translations: { ja: '絞り込み' } },
  'toolBuilder.filters.add': { defaultMessage: 'Add filter', translations: { ja: '絞り込みを追加' } },
  'toolBuilder.filters.remove': { defaultMessage: 'Remove filter on {column}', translations: { ja: '{column} の絞り込みを削除' } },
  'toolBuilder.filters.column': { defaultMessage: 'Filter column', translations: { ja: '絞り込む列' } },
  'toolBuilder.filters.columnHint': { defaultMessage: 'Use a result column name. Run the query for suggestions.', translations: { ja: '結果の列名を指定してください。クエリを実行すると候補を表示します。' } },
  'toolBuilder.filters.operator': { defaultMessage: 'Filter operator', translations: { ja: '絞り込みの条件' } },
  'toolBuilder.filters.op.eq': { defaultMessage: 'Equals', translations: { ja: '等しい' } },
  'toolBuilder.filters.op.neq': { defaultMessage: 'Does not equal', translations: { ja: '等しくない' } },
  'toolBuilder.filters.op.contains': { defaultMessage: 'Contains text', translations: { ja: '文字列を含む' } },
  'toolBuilder.filters.op.gte': { defaultMessage: 'Greater than or equal to', translations: { ja: '以上' } },
  'toolBuilder.filters.op.lte': { defaultMessage: 'Less than or equal to', translations: { ja: '以下' } },
  'toolBuilder.filters.op.in': { defaultMessage: 'Matches any in list', translations: { ja: 'リストのいずれかに一致' } },
  'toolBuilder.filters.skipEmpty': { defaultMessage: 'Skip this filter when its value is empty', translations: { ja: '値が空のときはこの絞り込みを適用しない' } },
  'toolBuilder.filters.origin': { defaultMessage: 'Used by filter on {column}', translations: { ja: '{column} の絞り込みで使用' } },
  'toolBuilder.filters.typeHint': { defaultMessage: 'Only types compatible with this parameter’s filters are available.', translations: { ja: 'このパラメーターの絞り込みに合う型だけを選べます。' } },
  'toolBuilder.filters.operatorHint': { defaultMessage: 'List matching requires a list parameter. Add another filter to use a different parameter type.', translations: { ja: 'リストとの一致にはリスト型が必要です。別の型を使うには新しい絞り込みを追加してください。' } },
  'toolBuilder.filters.empty': { defaultMessage: 'Filter result rows using bound parameters, without editing SQL.', translations: { ja: 'SQL を編集せず、パラメーターで結果の行を絞り込めます。' } },
  'toolBuilder.filters.parameter': { defaultMessage: 'Filter parameter: {name}', translations: { ja: '絞り込みのパラメーター: {name}' } },
  'toolBuilder.filters.effectiveSql': { defaultMessage: 'Effective SQL', translations: { ja: '実行される SQL' } },
  'toolBuilder.filters.preview': { defaultMessage: 'Preview only. Values stay bound separately; contains treats % and _ as SQL wildcards.', translations: { ja: 'プレビューです。値は別途バインドされます。「文字列を含む」では % と _ を SQL のワイルドカードとして扱います。' } },
})

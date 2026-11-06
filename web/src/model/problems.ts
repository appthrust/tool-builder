// A validation problem as people read it, in the current language. Every
// reason code maps to a copy id (src/copy/problems.ts); values come from the
// problem's path (what kind of id is duplicated, the bad value's location) and
// the limits the rule checks. `Problem.message` is the English API wording and
// only shows for a code this build does not know (a newer server).
import type { DashboardMessageValues } from '@appthrust/platform-dashboard-i18n'
import type { MessageId } from '../copy'
import type { Translate } from '../i18n'
import { GRID_COLUMNS, MAX_ROW_LIMIT, MAX_TIMEOUT_MS, type Problem, type ProblemCode } from './document.schema'

/** The copy of each code that needs no path; `schema` and `duplicate_id` read their path first. */
const PROBLEM_TEXT: Readonly<Record<ProblemCode, MessageId>> = {
  schema: 'toolBuilder.problem.schema',
  one_page_required: 'toolBuilder.problem.onePageRequired',
  unknown_component_type: 'toolBuilder.problem.unknownComponentType',
  duplicate_id: 'toolBuilder.problem.duplicateId',
  layout_out_of_grid: 'toolBuilder.problem.layoutOutOfGrid',
  unknown_parent: 'toolBuilder.problem.unknownParent',
  query_source_missing: 'toolBuilder.problem.querySourceMissing',
  empty_query: 'toolBuilder.problem.emptyQuery',
  timeout_out_of_range: 'toolBuilder.problem.timeoutOutOfRange',
  row_limit_out_of_range: 'toolBuilder.problem.rowLimitOutOfRange',
  positional_placeholder: 'toolBuilder.problem.positionalPlaceholder',
  multiple_statements: 'toolBuilder.problem.multipleStatements',
  placeholder_in_literal: 'toolBuilder.problem.placeholderInLiteral',
  placeholder_without_param: 'toolBuilder.problem.placeholderWithoutParam',
  param_without_placeholder: 'toolBuilder.problem.paramWithoutPlaceholder',
  filter_not_supported: 'toolBuilder.problem.filterNotSupported',
  filter_param_unknown: 'toolBuilder.problem.filterParamUnknown',
  filter_param_type: 'toolBuilder.problem.filterParamType',
  filter_column_invalid: 'toolBuilder.problem.filterColumnInvalid',
  unknown_query: 'toolBuilder.problem.unknownQuery',
  write_query_not_action: 'toolBuilder.problem.writeQueryNotAction',
  unknown_action_query: 'toolBuilder.problem.unknownActionQuery',
  action_query_not_write: 'toolBuilder.problem.actionQueryNotWrite',
  unknown_form_component: 'toolBuilder.problem.unknownFormComponent',
  unknown_ref_component: 'toolBuilder.problem.unknownRefComponent',
  prop_not_exposed: 'toolBuilder.problem.propNotExposed',
  binding_cycle: 'toolBuilder.problem.bindingCycle',
}

/** `duplicate_id` paths (validator order) → the kind of id that repeats. */
const DUPLICATE_KIND: readonly [RegExp, MessageId][] = [
  [/\.params\.\d+\.name$/, 'toolBuilder.problem.duplicateId.param'],
  [/\.props\.fields\.value\.\d+\.name$/, 'toolBuilder.problem.duplicateId.field'],
  [/\.props\.tabs\.value\.\d+\.id$/, 'toolBuilder.problem.duplicateId.tab'],
  [/\.actions\.\d+\.id$/, 'toolBuilder.problem.duplicateId.action'],
  [/^pages\.\d+\.components\.\d+\.id$/, 'toolBuilder.problem.duplicateId.component'],
  [/^queries\.\d+\.id$/, 'toolBuilder.problem.duplicateId.query'],
  [/^pages\.\d+\.id$/, 'toolBuilder.problem.duplicateId.page'],
]

const VALUES: Partial<Record<ProblemCode, DashboardMessageValues>> = {
  layout_out_of_grid: { columns: GRID_COLUMNS },
  timeout_out_of_range: { max: MAX_TIMEOUT_MS },
  row_limit_out_of_range: { max: MAX_ROW_LIMIT },
}

function isProblemCode(code: string): code is ProblemCode {
  return Object.hasOwn(PROBLEM_TEXT, code)
}

/** The problem in the current language; a code this build does not know shows the server's message. */
export function problemText(problem: Pick<Problem, 'path' | 'message'> & { code: string }, t: Translate): string {
  const { code, path } = problem
  if (!isProblemCode(code)) return problem.message
  if (code === 'schema') return path === '' ? t('toolBuilder.problem.schemaDocument') : t('toolBuilder.problem.schema', { path })
  if (code === 'duplicate_id') return t(DUPLICATE_KIND.find(([pattern]) => pattern.test(path))?.[1] ?? PROBLEM_TEXT.duplicate_id)
  return t(PROBLEM_TEXT[code], VALUES[code])
}

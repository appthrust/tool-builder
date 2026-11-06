// All tool-builder wording, as dashboard-i18n catalogs: the English source is
// the `defaultMessage`, Japanese (the audience's default) is `translations.ja`.
// Every id lives under `toolBuilder.`, and no two ids may share an English
// source (the translator refuses to build; src/copy.test.ts checks both).
// Screens read it through `useText().t(id, values)` (src/i18n.tsx); no screen
// hardcodes user-facing text.
import type { DashboardMessageCatalog } from '@appthrust/platform-dashboard-i18n'
import { commonMessages } from './common'
import { connectMessages } from './connect'
import { dataTabMessages } from './data-tab'
import { dataSourcesMessages } from './data-sources'
import { editorMessages } from './editor'
import { filtersMessages } from './filters'
import { flowMessages } from './flow'
import { homeMessages } from './home'
import { problemMessages } from './problems'
import { queryMessages } from './queries'
import { releaseMessages } from './releases'
import { rendererMessages } from './renderer'
import { runMessages } from './runs'
import { runtimeMessages } from './runtime'
import { sharingMessages } from './sharing'

export const catalogs: readonly DashboardMessageCatalog[] = [
  commonMessages,
  homeMessages,
  rendererMessages,
  runtimeMessages,
  editorMessages,
  problemMessages,
  dataSourcesMessages,
  queryMessages,
  releaseMessages,
  sharingMessages,
  runMessages,
  flowMessages,
  connectMessages,
  dataTabMessages,
  filtersMessages,
]

export type MessageId =
  | keyof typeof commonMessages
  | keyof typeof homeMessages
  | keyof typeof rendererMessages
  | keyof typeof runtimeMessages
  | keyof typeof editorMessages
  | keyof typeof problemMessages
  | keyof typeof dataSourcesMessages
  | keyof typeof queryMessages
  | keyof typeof releaseMessages
  | keyof typeof sharingMessages
  | keyof typeof runMessages
  | keyof typeof flowMessages
  | keyof typeof connectMessages
  | keyof typeof dataTabMessages
  | keyof typeof filtersMessages

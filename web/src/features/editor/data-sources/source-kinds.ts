// How people recognise a data source's kind: its icon, and for a `builtin-app`
// source the built-in app's name. The server speaks definition names (`directory`,
// `builder-console`); an unknown one reads as its definition name.
import { Blocks, Database, Globe, type LucideIcon } from 'lucide-react'
import type { DataSourceKind } from '../../../api/types'
import type { MessageId } from '../../../copy'
import type { Translate } from '../../../i18n'

export const SOURCE_ICON: Record<DataSourceKind, LucideIcon> = { postgres: Database, http: Globe, 'builtin-app': Blocks }

const BUILTIN_APP_NAME: Readonly<Record<string, MessageId>> = {
  directory: 'toolBuilder.dataSources.installedApp.directory',
  knowledge: 'toolBuilder.dataSources.installedApp.knowledge',
  'builder-console': 'toolBuilder.dataSources.installedApp.builderConsole',
}

export function installedAppName(definition: string, t: Translate): string {
  const id = BUILTIN_APP_NAME[definition]
  return id ? t(id) : definition
}

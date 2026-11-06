// Dev-only API mock: `bun src/dev/mock-server.ts` (or `bun run mock`). Serves
// the tool-builder contract (`/api/tool-builder/v1/*`, ./mock-tool-builder) and
// the app switcher's `GET /launcher` on one port; Vite proxies both here (vite.config.ts).
//   TOOL_BUILDER_MOCK_PORT      default 5216
//   TOOL_BUILDER_MOCK_ROLE      admin | editor | user (default admin); `?as=` on any request overrides it per browser
//   TOOL_BUILDER_MOCK_SCENARIO  none | pending-source | denied | app-installing (Knowledge still installing); `?scenario=` overrides it per browser
//   TOOL_BUILDER_MOCK_LATENCY_MS delay before query/action runs answer (default 250)
import { createMockLauncherHandler, mockLauncherEntries } from '@appthrust/app-launcher'
import { createMockToolBuilder, MOCK_ROLES, MOCK_SCENARIOS, type MockRole, type MockScenario } from './mock-tool-builder'

const port = Number(process.env.TOOL_BUILDER_MOCK_PORT ?? 5216)
const role = MOCK_ROLES.find((candidate) => candidate === process.env.TOOL_BUILDER_MOCK_ROLE) satisfies MockRole | undefined
const scenario = MOCK_SCENARIOS.find((candidate) => candidate === process.env.TOOL_BUILDER_MOCK_SCENARIO) satisfies MockScenario | undefined
const mock = createMockToolBuilder({ role, scenario, latencyMs: Number(process.env.TOOL_BUILDER_MOCK_LATENCY_MS ?? 250) })
const launcher = createMockLauncherHandler(mockLauncherEntries('tool-builder'))

const server = Bun.serve({ port, hostname: '127.0.0.1', fetch: (request) => launcher(request) ?? mock.handle(request) })

console.log(`tool-builder mock API on http://${server.hostname}:${server.port} (role=${role ?? 'admin'}, scenario=${scenario ?? 'none'})`)

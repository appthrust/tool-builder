# @appthrust/tool-builder

The SPA of the Internal Tool Builder built-in app. `cmd/server`
serves it from one origin together with `/api/tool-builder/v1/*`; the OIDC edge
in front of the built-in app attaches the caller's bearer, so the SPA never handles
tokens. Design: [Tool Builder design](https://github.com/appthrust/platform/tree/main/design/platform/builtin-app-tool-builder).

- `src/model`: the tool document (`document.ts` types, `document.schema.ts` zod
  + `validateDocument`), bindings store. Golden fixtures shared with the Go
  validator live under `cmd/server/internal/domain/testdata/documents`.
- `src/renderer`: one component registry used by the runtime (`/t/<slug>`) and
  the editor canvas.
- `src/features`: `home`, `runtime`, `editor/{canvas,properties,queries,releases,sharing,runs,data-sources}`.
- `src/api`: typed client over `types.ts` (the DTO contract).
- `src/dev/mock-server.ts`: in-memory API for `bun run mock` (port 5216) with the
  order-desk demo; `?as=admin|editor|user` and `?scenario=` cookies switch the caller.

```bash
bun run mock      # in-repo API mock
bun run dev       # Vite on 5218, /api → mock (or TOOL_BUILDER_API_UPSTREAM + TOOL_BUILDER_DEV_BEARER)
bun run typecheck && bun test src
```

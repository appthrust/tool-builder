# Golden document fixtures

Shared by the Go validator (`internal/domain`) and the SPA zod schema
(`web/src/model/document.schema.ts`). Both test
suites walk these directories:

- `valid/*.json`: a Document that must be accepted unchanged.
- `invalid/*.json`: `{ "reason": "<code>", "document": {...} }`; the document
  must be rejected and the first reported problem's code must equal `reason`.

Reason codes (stable, part of the `invalid_document` API error `details.problems[].code`):
`schema` (shape/type), `duplicate_id`, `unknown_component_type`, `layout_out_of_grid`,
`unknown_parent`, `unknown_query`, `write_query_not_action`, `unknown_ref_component`,
`prop_not_exposed`, `placeholder_without_param`, `param_without_placeholder`,
`filter_not_supported`, `filter_param_unknown`, `filter_param_type`, `filter_column_invalid`,
`positional_placeholder`, `multiple_statements`, `placeholder_in_literal`, `binding_cycle`, `unknown_action_query`,
`action_query_not_write`, `unknown_form_component`, `timeout_out_of_range`,
`row_limit_out_of_range`, `one_page_required`, `query_source_missing`, `empty_query`.

`Problem.path` is dotted with numeric indices (`queries.0.params.1.bind.ref`);
an empty path addresses the document. Shape errors short-circuit semantic
validation. Otherwise reason-code precedence is: `one_page_required`,
`unknown_component_type`, `duplicate_id`, `layout_out_of_grid`, `unknown_parent`,
`query_source_missing`, `empty_query`, timeout, row limit, positional bind, statement
separator, `placeholder_in_literal`, placeholder/parameter parity, query placement,
actions, references, binding cycle.
`query_source_missing` means neither or both SQL and HTTP statements; publication
also uses it when the selected stored source is missing or has the wrong kind.
`empty_query` means SQL text is empty after Go `strings.TrimSpace`; its path is
`queries.<i>.sql.text`. It is not a shape error, so an unfinished query can be saved.
`placeholder_in_literal` reports once per query at the same path when a named
placeholder occurs in a SQL string, dollar-quoted body, quoted identifier or comment.
Those placeholders remain unchanged during SQL binding; validation rejects them
before execution. Parameter pairing still counts all well-formed placeholders,
including these invalid placements.

The placeholder grammar is `\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}` with Go's ASCII
`\s` semantics (`[\t\n\f\r ]`), mirrored explicitly in the SPA. Non-ASCII spaces
such as NBSP inside a placeholder are invalid (`schema`), not silently interpolated.

The invalid directory covers every listed reason. Additional schema fixtures
cover malformed placeholders, unsafe HTTP paths/methods, invalid component props,
and unterminated SQL literals. SQL guards skip standard/escape/dollar-quoted
literals, quoted identifiers, line comments and nested block comments. A trailing
statement separator is invalid too. `http-null-literal.json` protects literal-null
round trips and adjacent closing JSON braces (not placeholder syntax).

Draft saves reject shape (`schema`) problems but preserve semantically incomplete
documents; publication rejects every problem, and draft execution rejects validation
problems on the selected query. Publish and restore accept an optional
`If-Match: <draftVersion>` and return 409 `draft_changed` with the current draft
when it differs; omitting it preserves unconditional publication. Release
diffs compare page titles, components excluding actions, actions and queries by
stable id, in that kind order; additions/changes precede removals. Audit parameters
are canonical-JSON SHA-256 hashes, never stored input values, and runs expire after
90 days via the server's hourly prune. The development seed remaps `ds_orders` to
the created source id and consumes the platform connection key `ORDERS_DB_URL`.

Run routes resolve the tool, document, grants and source in a read transaction,
close it before calling the external engine, and use a short write transaction only
to record action/draft-write outcomes (including denials and failures). Slow data
sources never hold the built-in app store's writer lock or a store connection. A capped
Postgres read cancels its query before closing rows instead of draining the result;
write `RETURNING` rows still drain to obtain the affected count and commit.

Source lists and schema inspection are available to admins and callers with an
edit grant on at least one tool; creating/deleting sources stays admin-only.
Platform connection writes forward the caller's bearer with a generated
`Idempotency-Key` (the built-in app API itself does not require that header). HTTP
sources resolve the destination component's platform-owned `internalService.url`;
an absent service returns `internal_service_required`. No pasted URL is accepted.
Connection deletion treats a Platform API 404 as already removed and still deletes
the source row; other upstream errors preserve it. Only unarchived tools' drafts
and live releases prevent source deletion; archived tools do not retain a source.

Built-in app sources use `kind: "builtin-app"` in both the API and persisted rows,
with `definition` identifying the linked app; `connectionName` is null and
`baseUrl` and `destinationComponentId` are omitted from API responses.
Migration `003_builtin_app_sources.sql` converts existing source kinds and replaces
both data-source CHECK constraints atomically under the shared migration lock.
The previously applied migrations remain unchanged. The new SQL is replay-safe;
source IDs, definitions, other source kinds and existing tool references are retained.

Marketplace database connections resolve Tool Builder's AppInstallation and
ApplicationStack to the current web Component, then use the public
`component-connections` API. Removal matches the observed source Component,
destination Component, and connection name. The data-source wire/storage value
`builtin-app` is an application-level catalog-link discriminator, not a Kubernetes
resource kind; it remains unchanged.

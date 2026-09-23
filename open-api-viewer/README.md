# OpenAPI Viewer & Reviewer

Offline review and editing for OpenAPI 3.0 / 3.1 documents (JSON or YAML) in VS Code and Cursor. It combines the split-view live preview of [editor.swagger.io](https://editor.swagger.io) with the outline, navigation, security audit and "Try it" workflow of 42Crunch's OpenAPI (Swagger) Editor — but entirely local. Nothing is uploaded: no telemetry, no cloud service, no CDN. The spec never leaves your machine.

## Features

### Outline & navigation

An **OpenAPI** activity-bar view shows an `Outline` tree (Info / Servers / Tags / Paths → operations / Components / Security) for the active OpenAPI document. Clicking a node reveals the corresponding range in the editor.

- `openapiViewer.outline.filter` ("Filter") / `openapiViewer.outline.clearFilter` ("Clear Filter") — filter the tree by text.
- `openapiViewer.outline.refresh` ("Refresh") — force a re-render.
- Standard language features work on `$ref` pointers: **Go to Definition** (F12) jumps to the referenced component, **Hover** shows a schema summary (properties, required markers, one level of `allOf` merge), **Find All References** lists every `$ref` to a component, and **Rename Symbol** on a component name rewrites every `$ref` and matching security-requirement key across the document, with word-boundary checks so it doesn't touch unrelated substrings.
- `openapiViewer.copyJsonPointer` ("OpenAPI: Copy JSON Pointer") — copies the RFC 6901 JSON Pointer of the symbol under the cursor, available from the editor context menu.

### Validation & diagnostics

Diagnostics (source `openapi`) appear as you type, debounced by `openapiViewer.debounceMs` (default 300 ms):

- Parse errors from the JSON/YAML parser.
- Reduced OAS meta-schema errors (Ajv), deduplicated and capped so a single mistake doesn't produce a wall of errors.
- Eleven semantic rules, independent of the meta-schema:

  | Rule | Checks |
  |---|---|
  | OAV101 | Unresolved `$ref` |
  | OAV102 | External `$ref` (info only) |
  | OAV103 | Unused component (unreferenced schema/response/etc.) |
  | OAV104 | Duplicate `operationId` |
  | OAV105 | Path-parameter name mismatch or missing `required: true` |
  | OAV106 | Operation with no `responses` |
  | OAV107 | Operation with no 2xx/3xx (success) response |
  | OAV108 | Missing `info.description` / operation `summary`+`description` (configurable) |
  | OAV109 | Security requirement references an undeclared scheme |
  | OAV110 | Duplicate path-template shapes (e.g. `/pets/{id}` vs `/pets/{petId}`) |

  Toggle the whole set with `openapiViewer.validation.enabled`; tune OAV108 specifically with `openapiViewer.validation.missingDescriptions`.

### Security & quality audit

`openapiViewer.runAudit` ("OpenAPI: Run Audit") runs a 25-rule, 42Crunch-inspired offline audit and opens a report webview. It also runs automatically per `openapiViewer.audit.runOn` (`manual` | `save` | `type`, default `save`); findings additionally populate an `openapi-audit` diagnostics collection.

**Scoring model:** three categories with fixed maximums — Security (30), Data validation (50), Quality (20), for a total out of 100. Each rule has a `weight` inside its category. For every rule, `deduction = effectiveWeight × min(1, findings / eligibleSites)` — so a rule only "counts" against sites where it actually applies (e.g. string schemas for `maxLength`), and a rule that fires on every eligible site takes its full weight off the category. A category's score is its max minus the sum of its rules' deductions, floored at 0. Turning a rule `off` (via `openapiViewer.audit.ruleSeverity`) redistributes its weight proportionally across the remaining active rules in the same category, so the category's ceiling stays reachable. The report webview shows a score ring, per-category bars, and an issue table grouped by rule; clicking a row reveals it in the editor, and a **Re-run** button re-executes the audit.

Per-rule severity can be overridden or disabled with `openapiViewer.audit.ruleSeverity` (keys are rule ids like `SEC001`, `DV004`, `QF002`; values are `off`, `critical`, `high`, `medium`, or `low`).

#### Rule catalog

| ID | Category | Severity | Weight | Title |
|---|---|---|---|---|
| SEC001 | Security | critical | 6 | No effective security |
| SEC002 | Security | high | 3 | Explicit empty security override |
| SEC003 | Security | critical | 3 | Undeclared security scheme |
| SEC004 | Security | high | 3 | apiKey in query |
| SEC005 | Security | high | 4 | Insecure server URL (http://) |
| SEC006 | Security | medium | 4 | Missing 401 response |
| SEC007 | Security | low | 2 | Missing 403 response |
| SEC008 | Security | medium | 3 | Weak security scheme (basic auth, oauth2 implicit/password) |
| SEC009 | Security | low | 2 | Unresolved server variable / no servers |
| DV001 | Data validation | medium | 10 | String missing `maxLength` |
| DV002 | Data validation | low | 6 | String missing `pattern` |
| DV003 | Data validation | low | 4 | Numeric missing `format` |
| DV004 | Data validation | medium | 6 | Numeric missing bounds (`minimum`/`maximum`) |
| DV005 | Data validation | medium | 6 | Array missing `maxItems` |
| DV006 | Data validation | medium | 6 | Request object missing `additionalProperties: false` |
| DV007 | Data validation | low | 4 | Object missing `required` |
| DV008 | Data validation | high | 5 | Schema with no constraints at all |
| DV009 | Data validation | high | 3 | Missing schema (parameter or request body media type) |
| QF001 | Quality | low | 3 | Missing summary/description |
| QF002 | Quality | medium | 3 | Missing `operationId` |
| QF003 | Quality | low | 2 | Missing `tags` |
| QF004 | Quality | low | 3 | Undeclared tag |
| QF005 | Quality | medium | 4 | Missing 400 response on an operation with input |
| QF006 | Quality | low | 3 | Missing example/examples |
| QF007 | Quality | low | 2 | Missing `info.contact` and `info.license` |

Security sums to 30, Data validation to 50, and Quality to 20 (100 total), matching the category maximums above.

### Swagger UI preview

`openapiViewer.preview` ("OpenAPI: Preview (Swagger UI)") opens a live-updating [Swagger UI](https://github.com/swagger-api/swagger-ui) preview beside the editor, using a bundled, offline copy of `swagger-ui-dist` (no CDN, no network requests from the preview itself — `validatorUrl` and the "Try it out" submit UI inside Swagger UI are both disabled). The preview keeps the last successfully-rendered spec on screen if you type something momentarily invalid, and updates live as you edit.

### Edit helpers & quick fixes

- `openapiViewer.addPath` ("OpenAPI: Add Path"), `openapiViewer.addOperation` ("OpenAPI: Add Operation"), `openapiViewer.addSchema` ("OpenAPI: Add Schema"), `openapiViewer.addResponse` ("OpenAPI: Add Response") — prompt-driven scaffolding that inserts correctly-indented JSON or YAML at the right place in the document (Add Operation templates the path's `{parameters}` automatically), leaving the rest of the file byte-identical.
- `$ref` path completion while typing a `"$ref": "..."` value or its YAML equivalent.
- Quick fixes (lightbulb) for: creating a missing component referenced by an unresolved `$ref` (OAV101), adding a 401 response (reusing an existing `StandardError-401`-style shared response when present), adding `maxLength`/`maxItems` to a schema, and removing an unused component.
- `oa-*` snippets for both `openapi-json.json` (JSON/JSONC) and `openapi-yaml.json` (YAML).

### Try it

An inline `▶ Try it` CodeLens appears above every operation (toggle with `openapiViewer.codeLens.enabled`) and opens a request-builder webview (`openapiViewer.tryOperation`, "OpenAPI: Try it"):

- Pick a server (with server variables substituted) or type a URL, fill in path/query/header parameters, and get a request body pre-filled from the schema's `example` → `examples` → `default` → `const` → `enum` → `allOf`/`oneOf` (in that priority order, `readOnly` fields skipped, cycles guarded, depth-limited).
- The request is sent from the **extension host** (not the webview) via `fetch`, with a timeout (`openapiViewer.tryIt.timeoutMs`) and a Cancel button. Plain `http://` requests to a non-localhost host require confirmation unless `openapiViewer.tryIt.allowInsecure` is set. Auth headers are redacted in the output channel log.

## Privacy

- **No network calls** happen anywhere in this extension except a Try-it request, and that only fires when you explicitly click Send in the Try-it panel.
- Your OpenAPI spec is **never uploaded** anywhere — parsing, validation, the audit, and the preview all run locally in the extension host or an offline bundled Swagger UI.
- Secrets entered in the Try-it panel (API keys, tokens) are stored in VS Code's `SecretStorage`, keyed by `scheme:origin`. They are **never sent to any webview** — the extension host injects them into the outgoing request only at send time.
- No telemetry is collected or transmitted by this extension.

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `openapiViewer.validation.enabled` | boolean | `true` | Enable schema and semantic (OAV1xx) validation diagnostics for OpenAPI documents. |
| `openapiViewer.validation.missingDescriptions` | string (`off`\|`info`\|`warning`) | `info` | Severity for missing info.description / operation description+summary (rule OAV108). 'off' disables the rule. |
| `openapiViewer.debounceMs` | number | `300` | Milliseconds to debounce re-analysis after an edit to an OpenAPI document. |
| `openapiViewer.audit.runOn` | string (`manual`\|`save`\|`type`) | `save` | When to automatically recompute the audit diagnostics collection: 'manual' only via the OpenAPI: Run Audit command, 'save' on save, or 'type' on every debounced edit. The Run Audit command always works regardless of this setting. |
| `openapiViewer.audit.ruleSeverity` | object | `{}` | Per-rule audit overrides. Keys are rule ids (e.g. SEC001, DV004, QF002); values are 'off' (disable the rule and redistribute its weight within its category) or a replacement severity: 'critical', 'high', 'medium' or 'low'. |
| `openapiViewer.codeLens.enabled` | boolean | `true` | Show a '▶ Try it' CodeLens above each operation in an OpenAPI document. |
| `openapiViewer.tryIt.defaultServerUrl` | string | `""` | When non-empty, used as the initial server URL for new Try-it panels instead of the spec's first server. |
| `openapiViewer.tryIt.timeoutMs` | number | `30000` | Timeout in milliseconds for Try-it requests sent from the extension host. |
| `openapiViewer.tryIt.allowInsecure` | boolean | `false` | Skip the confirmation prompt before sending a Try-it request to a non-localhost http:// URL. |

## Third-party notices

This extension bundles [`swagger-ui-dist`](https://www.npmjs.com/package/swagger-ui-dist) (Apache License 2.0) to render the offline preview. The bundled files (`swagger-ui-bundle.js`, `swagger-ui.css`) live under `media/swagger-ui/`, alongside the upstream `media/swagger-ui/LICENSE` file. `swagger-ui-dist` is copied at build time only — it is never imported into the extension host or webview bundles.

## Known limitations

- **No Swagger 2.0 support.** Only OpenAPI 3.0.x and 3.1.x are recognized.
- **No multi-file or external `$ref` resolution.** Only `$ref`s within the same document are resolved; refs to other files or URLs are reported as external/unresolved rather than followed.
- **Reduced, not the full official, OAS meta-schema validation.** The Ajv-based schema check is intentionally trimmed (deduplicated, capped, simplified messages) rather than a byte-for-byte implementation of the official OpenAPI JSON Schema; the eleven semantic rules (OAV101–OAV110) and the 25-rule audit cover most of the structural and security checks that matter in practice, but this is not a substitute for a full OAS-conformance validator.

## Build from source

```bash
make install      # npm install
make compile      # tsc --noEmit + esbuild dev bundle
make test-unit    # unit tests (mocha, no vscode dependency), 109 tests
make package      # build a production .vsix (auto-bumps version unless VERSION=x.y.z is given)
```

`make test` additionally runs the `@vscode/test-electron` integration suite (not run in this repo's automated checks). See `Makefile` for all targets.

## Installing the built VSIX

After `make package` produces `open-api-viewer-<version>.vsix`, install it in VS Code or Cursor with:

```bash
code --install-extension open-api-viewer-<version>.vsix
# or, in Cursor:
cursor --install-extension open-api-viewer-<version>.vsix
```

(or use the "Install from VSIX..." command from the Extensions view).

## License

MIT — see [LICENSE](./LICENSE).

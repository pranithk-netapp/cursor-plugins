# Changelog

All notable changes to this project are documented in this file.

## 0.2.0

First functionally complete release. Offline review and editing for OpenAPI 3.0/3.1 documents (JSON or YAML), built through phases 0-8:

- **Validation & diagnostics** — reduced OAS meta-schema checks (Ajv) plus eleven semantic rules (OAV101-OAV110: unresolved/external `$ref`, unused components, duplicate operationIds, path-parameter mismatches, missing responses/success responses, missing descriptions, undeclared security schemes, duplicate path-template shapes), debounced re-analysis on edit.
- **Outline & navigation** — an activity-bar `Outline` tree (Info/Servers/Tags/Paths→operations/Components/Security) with filtering, plus Definition, Hover, Find References and Rename support for `$ref` pointers and component names, and a Copy JSON Pointer command.
- **Swagger UI preview** — a live-updating, fully offline preview (bundled `swagger-ui-dist`, no CDN, no network) that keeps the last good render on screen through transient parse errors.
- **Security & quality audit** — a 25-rule offline audit (SEC001-009, DV001-009, QF001-007) with weighted category scoring (Security/30, Data validation/50, Quality/20), a report webview with a score ring and per-category breakdown, and per-rule severity overrides.
- **Edit helpers & quick fixes** — Add Path/Operation/Schema/Response commands with correct JSON/YAML insertion, `$ref` completion, quick fixes (create missing component, add 401, add maxLength/maxItems, remove unused component), and `oa-*` snippets for JSON and YAML.
- **Try it** — a `▶ Try it` CodeLens per operation opening a request-builder webview, with server/variable substitution, schema-driven example bodies, and SecretStorage-backed auth headers injected only at send time from the extension host.
- **Packaging** — production `vscode:prepublish` build (minified, no sourcemaps shipped), corrected `.vscodeignore`, and a user-facing README covering features, privacy, settings and the rule catalog.

109 unit tests passing; zero compile errors.

## 0.1.0

- Initial scaffold for OpenAPI Viewer & Reviewer extension.

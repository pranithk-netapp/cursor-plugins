// Hand-authored, reduced structural JSON Schema for OpenAPI 3.x documents.
// Pure, no vscode dependency.
//
// KNOWN LIMITATION (deliberate scope reduction): this is NOT the official
// OAI meta-schema. The official 3.0/3.1 meta-schemas rely on draft-04
// (3.0) and 2020-12 (3.1, via `$dynamicRef`) dialect machinery that would
// require wiring up `ajv-draft-04` *and* `ajv` 2020-12 side by side and
// vendoring two large generated files. That machinery buys little for a
// review tool: our own semantic rules (src/core/validation/semantic.ts)
// already check the parts of a spec that matter most when reviewing one
// (path/operation/response/parameter/security shape). So this schema is
// intentionally small — draft-07 via plain `ajv` v8 — and only validates
// the root document shape and `info`. It exists to catch the "typo'd
// top-level key" / "openapi version string is garbage" class of mistake;
// it is not a substitute for a full OAS validator, and per-path/operation
// structure is intentionally left to semantic.ts instead of
// `patternProperties`/`$ref` wiring here.
export function getOasSchema(version: "3.0" | "3.1"): object {
  const openapiPattern = version === "3.1" ? "^3\\.1\\.\\d+$" : "^3\\.0\\.\\d+$";
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    required: ["openapi", "info", "paths"],
    additionalProperties: true,
    properties: {
      openapi: { type: "string", pattern: openapiPattern },
      info: { $ref: "#/definitions/info" },
      paths: { type: "object" },
      components: { type: "object" },
      servers: { type: "array" },
      security: { type: "array" },
      tags: { type: "array" },
    },
    definitions: {
      info: {
        type: "object",
        required: ["title", "version"],
        properties: {
          title: { type: "string" },
          version: { type: "string" },
          description: { type: "string" },
        },
      },
    },
  };
}

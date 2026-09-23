// Data-validation audit rules DV001-DV009. Pure, no vscode dependency.
// DV001-DV008 iterate the schema sites collected by schemaWalker.ts; DV009
// looks directly at operations (it's about a missing `schema` altogether,
// so there's no schema object to walk into). Category max is 50
// (10+6+4+6+6+6+4+5+3), asserted in audit.test.ts.

import { derefValue } from "../../resolve";
import { joinPointer } from "../../pointer";
import { AuditContext, AuditFinding, AuditRule, AuditRuleRunResult } from "../types";
import { SchemaSite, walkSchemas } from "../schemaWalker";

function finding(ruleId: string, pointer: string, message: string): AuditFinding {
  return { ruleId, pointer, message };
}

function isPlainStringSchema(schema: any): boolean {
  return (
    schema &&
    typeof schema === "object" &&
    schema.type === "string" &&
    schema.enum === undefined &&
    schema.const === undefined &&
    schema.format === undefined
  );
}

function isNumericSchema(schema: any): boolean {
  return schema && typeof schema === "object" && (schema.type === "integer" || schema.type === "number");
}

function isArraySchema(schema: any): boolean {
  return schema && typeof schema === "object" && schema.type === "array";
}

function isNonEmptyObjectSchema(schema: any): boolean {
  return (
    schema &&
    typeof schema === "object" &&
    schema.type === "object" &&
    schema.properties &&
    typeof schema.properties === "object" &&
    Object.keys(schema.properties).length > 0
  );
}

/** Runs one applicability-predicate-gated schema rule over every schemaWalker site. */
function runOverSites(
  ruleId: string,
  sites: SchemaSite[],
  predicate: (schema: any, site: SchemaSite) => boolean,
  fails: (schema: any, site: SchemaSite) => boolean,
  message: (site: SchemaSite) => string
): AuditRuleRunResult {
  const findings: AuditFinding[] = [];
  let eligible = 0;
  for (const site of sites) {
    if (!predicate(site.schema, site)) {
      continue;
    }
    eligible++;
    if (fails(site.schema, site)) {
      findings.push(finding(ruleId, site.pointer, message(site)));
    }
  }
  return { findings, eligible };
}

function runDV001(ctx: AuditContext): AuditRuleRunResult {
  return runOverSites(
    "DV001",
    walkSchemas(ctx.index),
    isPlainStringSchema,
    (s) => s.maxLength === undefined,
    () => "String schema is missing 'maxLength'"
  );
}

function runDV002(ctx: AuditContext): AuditRuleRunResult {
  return runOverSites(
    "DV002",
    walkSchemas(ctx.index),
    isPlainStringSchema,
    (s) => s.pattern === undefined,
    () => "String schema is missing 'pattern'"
  );
}

function runDV003(ctx: AuditContext): AuditRuleRunResult {
  return runOverSites(
    "DV003",
    walkSchemas(ctx.index),
    isNumericSchema,
    (s) => s.format === undefined,
    (site) => `${site.schema.type} schema is missing 'format'`
  );
}

function runDV004(ctx: AuditContext): AuditRuleRunResult {
  return runOverSites(
    "DV004",
    walkSchemas(ctx.index),
    isNumericSchema,
    (s) => s.minimum === undefined && s.maximum === undefined,
    (site) => `${site.schema.type} schema is missing both 'minimum' and 'maximum'`
  );
}

function runDV005(ctx: AuditContext): AuditRuleRunResult {
  return runOverSites(
    "DV005",
    walkSchemas(ctx.index),
    isArraySchema,
    (s) => s.maxItems === undefined,
    () => "Array schema is missing 'maxItems'"
  );
}

function runDV006(ctx: AuditContext): AuditRuleRunResult {
  return runOverSites(
    "DV006",
    walkSchemas(ctx.index),
    (s, site) => isNonEmptyObjectSchema(s) && (site.usage === "request" || site.usage === "both"),
    (s) => s.additionalProperties !== false,
    () => "Request object schema is missing 'additionalProperties: false'"
  );
}

function runDV007(ctx: AuditContext): AuditRuleRunResult {
  return runOverSites(
    "DV007",
    walkSchemas(ctx.index),
    isNonEmptyObjectSchema,
    (s) => !Array.isArray(s.required),
    () => "Object schema with properties has no 'required' array"
  );
}

function runDV008(ctx: AuditContext): AuditRuleRunResult {
  const sites = walkSchemas(ctx.index);
  const findings: AuditFinding[] = [];
  for (const site of sites) {
    const s = site.schema;
    const hasType = s?.type !== undefined;
    const hasRef = typeof s?.$ref === "string";
    const hasComposition = Array.isArray(s?.allOf) || Array.isArray(s?.oneOf) || Array.isArray(s?.anyOf);
    const hasEnum = Array.isArray(s?.enum);
    if (!hasType && !hasRef && !hasComposition && !hasEnum) {
      findings.push(finding("DV008", site.pointer, "Schema has none of type, $ref, allOf/oneOf/anyOf or enum"));
    }
  }
  return { findings, eligible: sites.length };
}

function runDV009(ctx: AuditContext): AuditRuleRunResult {
  const findings: AuditFinding[] = [];
  let eligible = 0;

  for (const op of ctx.index.operations) {
    const opValue = ctx.value?.paths?.[op.path]?.[op.method];
    if (!opValue) {
      continue;
    }

    if (opValue.requestBody !== undefined) {
      const rb = derefValue(ctx.index, opValue.requestBody);
      const content = rb?.content;
      if (content && typeof content === "object") {
        for (const mediaType of Object.keys(content)) {
          eligible++;
          const mtValue = content[mediaType];
          if (!mtValue || typeof mtValue !== "object" || !("schema" in mtValue)) {
            const direct = joinPointer(op.pointer, "requestBody", "content", mediaType);
            const pointer = ctx.index.byPointer.has(direct) ? direct : op.pointer;
            findings.push(finding("DV009", pointer, `Request body media type '${mediaType}' has no schema`));
          }
        }
      }
    }

    const pathValue = ctx.value?.paths?.[op.path];
    const params = [...(Array.isArray(pathValue?.parameters) ? pathValue.parameters : []), ...(Array.isArray(opValue.parameters) ? opValue.parameters : [])];
    for (const rawParam of params) {
      const param = derefValue(ctx.index, rawParam);
      if (!param || typeof param !== "object") {
        continue;
      }
      eligible++;
      if (param.schema === undefined && param.content === undefined) {
        findings.push(finding("DV009", op.pointer, `Parameter '${param.name ?? "?"}' has no schema (and no content)`));
      }
    }
  }

  return { findings, eligible };
}

export const dataValidationRules: AuditRule[] = [
  { id: "DV001", category: "dataValidation", severity: "medium", weight: 10, title: "String missing maxLength", description: "Schema type: string (not enum/const, no format) missing maxLength.", run: runDV001 },
  { id: "DV002", category: "dataValidation", severity: "low", weight: 6, title: "String missing pattern", description: "Schema type: string (not enum/const, no format) missing pattern.", run: runDV002 },
  { id: "DV003", category: "dataValidation", severity: "low", weight: 4, title: "Numeric missing format", description: "Schema type: integer or number missing format.", run: runDV003 },
  { id: "DV004", category: "dataValidation", severity: "medium", weight: 6, title: "Numeric missing bounds", description: "Schema type: integer or number missing both minimum and maximum.", run: runDV004 },
  { id: "DV005", category: "dataValidation", severity: "medium", weight: 6, title: "Array missing maxItems", description: "Schema type: array missing maxItems.", run: runDV005 },
  { id: "DV006", category: "dataValidation", severity: "medium", weight: 6, title: "Request object missing additionalProperties: false", description: "Schema type: object with properties, used in a request context, missing additionalProperties: false.", run: runDV006 },
  { id: "DV007", category: "dataValidation", severity: "low", weight: 4, title: "Object missing required", description: "Schema type: object with properties but no required array.", run: runDV007 },
  { id: "DV008", category: "dataValidation", severity: "high", weight: 5, title: "Schema with no constraints", description: "Schema has none of: type, $ref, allOf/oneOf/anyOf, enum.", run: runDV008 },
  { id: "DV009", category: "dataValidation", severity: "high", weight: 3, title: "Missing schema", description: "An operation's requestBody media type or a parameter has no schema.", run: runDV009 },
];

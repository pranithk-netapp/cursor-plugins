// Collects every schema-shaped object reachable from an operation's
// parameters/requestBody/responses, plus every components.schemas entry,
// tagged with how it's used (request/response/both/unknown). Pure, no
// vscode dependency. Used by the dataValidation audit rules (DV00x) so
// they can iterate "every schema in the document" once instead of each
// rule re-walking the spec.

import { SpecIndex } from "../types";
import { refToPointer, pointerToSegments, joinPointer, encodeSegment } from "../pointer";

export type SchemaUsage = "request" | "response" | "both" | "unknown";

export interface SchemaSite {
  /** A real (or, for the rare unresolved-ref fallback, best-effort) JSON Pointer into the document. */
  pointer: string;
  schema: any;
  usage: SchemaUsage;
}

const MAX_DEPTH = 8;

export function walkSchemas(index: SpecIndex): SchemaSite[] {
  const sites = new Map<string, SchemaSite>();

  // Pass 1: for each operation, find requestBody/response content schemas
  // that are `$ref`s to a components.schemas entry, and remember which
  // "direction" (request/response/both) reached that component pointer.
  // Inline (non-$ref) content schemas are visited immediately here.
  const componentUsage = new Map<string, "request" | "response" | "both">();
  const markComponentUsage = (pointer: string, kind: "request" | "response"): void => {
    const existing = componentUsage.get(pointer);
    if (!existing) {
      componentUsage.set(pointer, kind);
    } else if (existing !== kind) {
      componentUsage.set(pointer, "both");
    }
  };

  for (const op of index.operations) {
    const opValue = index.value?.paths?.[op.path]?.[op.method];
    if (!opValue || typeof opValue !== "object") {
      continue;
    }

    if (opValue.requestBody !== undefined) {
      const rb = resolveWithPointer(index, opValue.requestBody, joinPointer(op.pointer, "requestBody"));
      visitContentSchemas(index, rb.value, rb.pointer, "request", sites, markComponentUsage);
    }

    if (opValue.responses && typeof opValue.responses === "object") {
      const responsesPointer = joinPointer(op.pointer, "responses");
      for (const status of Object.keys(opValue.responses)) {
        const resp = resolveWithPointer(
          index,
          opValue.responses[status],
          joinPointer(responsesPointer, status)
        );
        visitContentSchemas(index, resp.value, resp.pointer, "response", sites, markComponentUsage);
      }
    }
  }

  // Pass 2: every components.schemas entry, usage from pass 1 (or
  // 'unknown' if it was never reached directly from an operation's
  // requestBody/response content — e.g. it's only reachable transitively
  // through another schema's properties, or it's unused).
  for (const info of index.components.values()) {
    if (info.type !== "schemas") {
      continue;
    }
    const schemaValue = getValueAtPointer(index.value, info.pointer);
    const usage = componentUsage.get(info.pointer) ?? "unknown";
    visitSchema(schemaValue, info.pointer, usage, sites, new Set());
  }

  // Pass 3: inline parameter schemas (path-level and operation-level),
  // always 'request' usage. $ref parameter schemas resolve to a
  // components.schemas entry already covered by pass 2, so they're
  // skipped (same treatment as $ref content schemas above).
  for (const op of index.operations) {
    const pathItemPointer = "/paths/" + encodeSegment(op.path);
    const pathValue = index.value?.paths?.[op.path];
    const opValue = index.value?.paths?.[op.path]?.[op.method];
    collectParamSchemas(index, pathValue?.parameters, joinPointer(pathItemPointer, "parameters"), sites);
    collectParamSchemas(index, opValue?.parameters, joinPointer(op.pointer, "parameters"), sites);
  }

  return Array.from(sites.values());
}

/** One-level $ref resolution that also returns the pointer the resolved value lives at. */
function resolveWithPointer(index: SpecIndex, raw: any, ownPointer: string): { value: any; pointer: string } {
  if (raw && typeof raw === "object" && typeof raw.$ref === "string") {
    const targetPointer = refToPointer(raw.$ref);
    if (targetPointer !== null) {
      const value = getValueAtPointer(index.value, targetPointer);
      if (value !== undefined) {
        return { value, pointer: targetPointer };
      }
    }
  }
  return { value: raw, pointer: ownPointer };
}

function getValueAtPointer(root: any, pointer: string): any {
  if (pointer === "") {
    return root;
  }
  const segments = pointerToSegments(pointer);
  let cursor = root;
  for (const segment of segments) {
    if (cursor === null || cursor === undefined) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
}

function visitContentSchemas(
  index: SpecIndex,
  containerValue: any,
  containerPointer: string,
  usage: "request" | "response",
  sites: Map<string, SchemaSite>,
  markComponentUsage: (pointer: string, kind: "request" | "response") => void
): void {
  const content = containerValue?.content;
  if (!content || typeof content !== "object") {
    return;
  }
  for (const mediaType of Object.keys(content)) {
    const mtValue = content[mediaType];
    if (!mtValue || typeof mtValue !== "object" || mtValue.schema === undefined) {
      continue;
    }
    const schemaRaw = mtValue.schema;
    const schemaPointer = joinPointer(containerPointer, "content", mediaType, "schema");
    if (schemaRaw && typeof schemaRaw === "object" && typeof schemaRaw.$ref === "string") {
      const targetPointer = refToPointer(schemaRaw.$ref);
      if (targetPointer !== null) {
        markComponentUsage(targetPointer, usage);
      }
      continue;
    }
    visitSchema(schemaRaw, schemaPointer, usage, sites, new Set());
  }
}

function collectParamSchemas(
  index: SpecIndex,
  paramsArray: any,
  arrayPointer: string,
  sites: Map<string, SchemaSite>
): void {
  if (!Array.isArray(paramsArray)) {
    return;
  }
  for (let i = 0; i < paramsArray.length; i++) {
    const resolved = resolveWithPointer(index, paramsArray[i], joinPointer(arrayPointer, i));
    const paramValue = resolved.value;
    if (!paramValue || typeof paramValue !== "object" || paramValue.schema === undefined) {
      continue;
    }
    const schemaRaw = paramValue.schema;
    if (schemaRaw && typeof schemaRaw === "object" && typeof schemaRaw.$ref === "string") {
      continue; // resolves to a components.schemas entry, already visited in pass 2.
    }
    visitSchema(schemaRaw, joinPointer(resolved.pointer, "schema"), "request", sites, new Set());
  }
}

/**
 * Visit one schema object and recurse into its own structure
 * (properties/items/additionalProperties/allOf/oneOf/anyOf/not), tagging
 * every nested site with the same usage as its parent (we have no better
 * signal for a nested schema's own usage). Pointers for nested sites are
 * built the same way real JSON Pointers are built (joinPointer), and are
 * real AST pointers whenever `schema`'s own location came from the AST
 * (components.schemas.*, or an inline schema under a path item) — which is
 * every case here, since we never fabricate a schema object ourselves.
 */
function visitSchema(
  schema: any,
  pointer: string,
  usage: SchemaUsage,
  sites: Map<string, SchemaSite>,
  visited: Set<object>,
  depth = 0
): void {
  if (!schema || typeof schema !== "object" || depth > MAX_DEPTH) {
    return;
  }
  if (visited.has(schema)) {
    return; // cycle guard
  }
  visited.add(schema);

  if (!sites.has(pointer)) {
    sites.set(pointer, { pointer, schema, usage });
  }

  if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
    for (const propName of Object.keys(schema.properties)) {
      recurseInto(schema.properties[propName], joinPointer(pointer, "properties", propName), usage, sites, visited, depth + 1);
    }
  }

  if (schema.items !== undefined) {
    recurseInto(schema.items, joinPointer(pointer, "items"), usage, sites, visited, depth + 1);
  }

  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties === "object" &&
    !Array.isArray(schema.additionalProperties)
  ) {
    recurseInto(schema.additionalProperties, joinPointer(pointer, "additionalProperties"), usage, sites, visited, depth + 1);
  }

  for (const key of ["allOf", "oneOf", "anyOf"] as const) {
    const arr = schema[key];
    if (Array.isArray(arr)) {
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        if (item && typeof item === "object" && typeof item.$ref === "string") {
          continue; // leave $ref elements to be visited when component schemas are walked directly.
        }
        recurseInto(item, joinPointer(pointer, key, i), usage, sites, visited, depth + 1);
      }
    }
  }

  if (schema.not !== undefined) {
    recurseInto(schema.not, joinPointer(pointer, "not"), usage, sites, visited, depth + 1);
  }
}

function recurseInto(
  value: any,
  syntheticPointer: string,
  usage: SchemaUsage,
  sites: Map<string, SchemaSite>,
  visited: Set<object>,
  depth: number
): void {
  if (value && typeof value === "object" && typeof value.$ref === "string") {
    return; // $ref target is (or will be) visited directly via components.schemas.
  }
  visitSchema(value, syntheticPointer, usage, sites, visited, depth);
}

// Pure "Try it" example-body generator. No vscode dependency, so it can run
// in plain Node for fast unit tests (see src/test/unit/examples.test.ts) as
// well as inside the extension host (src/vscode/webview/tryItPanel.ts).
//
// `schema` is a plain JS value (usually `index.value`'s own schema objects,
// which may still contain `{ $ref: "#/..." }` nodes) — NOT an AstNode. Refs
// are resolved by looking them up directly in `index.value` via a local
// JSON-Pointer walk, mirroring src/core/resolve.ts's internal helper (kept
// separate here so this module's own cycle/depth guards, which must be
// threaded through every recursive call rather than reset per lookup, stay
// in one place).

import { SpecIndex } from "./types";
import { pointerToSegments, refToPointer } from "./pointer";

export interface GenerateExampleOptions {
  mode?: "request" | "response";
  depth?: number;
}

/** Hard recursion cap: guards against pathological (non-cyclic) deep schemas. */
const MAX_DEPTH = 8;
/** Above this many properties, only `.required` ones are included (per the plan). */
const MAX_ALL_PROPERTIES = 20;

/**
 * Generate a representative example value for an OpenAPI Schema Object.
 * Precedence at every level: example > examples > default > const > enum[0]
 * > type-driven generation > allOf merge > oneOf/anyOf[0].
 *
 * `$ref` pointers already visited on the current recursive path are tracked
 * in a `Set<string>` (not object identity, since refs are strings) so a
 * cyclic schema returns `null` at the cycle point instead of recursing
 * forever; `MAX_DEPTH` is a second, independent guard against long
 * (non-cyclic) chains.
 */
export function generateExample(index: SpecIndex, schema: any, opts: GenerateExampleOptions = {}): unknown {
  return generate(index, schema, opts.mode, opts.depth ?? 0, new Set<string>());
}

function generate(
  index: SpecIndex,
  schema: any,
  mode: "request" | "response" | undefined,
  depth: number,
  visited: Set<string>
): unknown {
  if (schema === null || schema === undefined || typeof schema !== "object" || Array.isArray(schema)) {
    return null;
  }
  if (depth > MAX_DEPTH) {
    return null;
  }

  if (typeof schema.$ref === "string") {
    const pointer = refToPointer(schema.$ref);
    if (pointer === null || visited.has(pointer)) {
      // External ref (not resolvable in this document) or a cycle back to a
      // pointer already on this recursive path.
      return null;
    }
    const resolved = getByPointer(index.value, pointer);
    if (resolved === undefined) {
      return null;
    }
    const nextVisited = new Set(visited);
    nextVisited.add(pointer);
    // Following a $ref doesn't itself add a level of "shape" nesting, so
    // depth is unchanged here; generateObject/generateArray increment depth
    // when they actually descend into a property/item.
    return generate(index, resolved, mode, depth, nextVisited);
  }

  if ("example" in schema) {
    return schema.example;
  }
  if ("examples" in schema) {
    const found = firstExampleValue(schema.examples);
    if (found.present) {
      return found.value;
    }
  }
  if ("default" in schema) {
    return schema.default;
  }
  if ("const" in schema) {
    return schema.const;
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }

  if (typeof schema.type === "string") {
    switch (schema.type) {
      case "string":
        return generateString(schema);
      case "integer":
        return generateNumber(schema);
      case "number":
        return generateNumber(schema);
      case "boolean":
        return true;
      case "object":
        return generateObject(index, schema, mode, depth, visited);
      case "array":
        return generateArray(index, schema, mode, depth, visited);
      case "null":
        return null;
      default:
        break;
    }
  }

  // allOf implies an (implicit) object shape merged from every branch plus
  // this schema's own sibling keywords; checked ahead of the plain
  // "implicit object/array" fallbacks below so e.g. `{allOf:[...], properties:{...}}`
  // merges rather than only using its own properties.
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return generateObject(index, schema, mode, depth, visited);
  }
  if (schema.properties && typeof schema.properties === "object") {
    return generateObject(index, schema, mode, depth, visited);
  }
  if (schema.items !== undefined) {
    return generateArray(index, schema, mode, depth, visited);
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return generate(index, schema.oneOf[0], mode, depth + 1, visited);
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return generate(index, schema.anyOf[0], mode, depth + 1, visited);
  }
  return null;
}

/**
 * Media-type-level `examples` is a name->{value} map in OAS 3.0/3.1; a
 * schema-level `examples` (only meaningful in 3.1, mirroring JSON Schema) is
 * a bare array of values. Handle both shapes defensively.
 */
function firstExampleValue(examples: unknown): { present: boolean; value?: unknown } {
  if (Array.isArray(examples)) {
    return examples.length > 0 ? { present: true, value: examples[0] } : { present: false };
  }
  if (examples && typeof examples === "object") {
    const firstKey = Object.keys(examples)[0];
    if (firstKey === undefined) {
      return { present: false };
    }
    const entry = (examples as Record<string, unknown>)[firstKey];
    if (entry && typeof entry === "object" && "value" in (entry as object)) {
      return { present: true, value: (entry as { value: unknown }).value };
    }
    return { present: true, value: entry };
  }
  return { present: false };
}

const UUID_PLACEHOLDER = "00000000-0000-4000-8000-000000000000";

function generateString(schema: any): string {
  let value: string;
  switch (schema.format) {
    case "uuid":
      value = UUID_PLACEHOLDER;
      break;
    case "date":
      value = "2024-01-01";
      break;
    case "date-time":
      value = "2024-01-01T00:00:00Z";
      break;
    case "email":
      value = "user@example.com";
      break;
    case "uri":
    case "url":
      value = "https://example.com";
      break;
    case "ipv4":
      value = "192.0.2.1";
      break;
    case "byte":
      value = Buffer.from("example", "utf8").toString("base64");
      break;
    default:
      value = "string";
  }
  if (typeof schema.minLength === "number" && value.length < schema.minLength) {
    value = value.padEnd(schema.minLength, "x");
  }
  return value;
}

function generateNumber(schema: any): number {
  if (typeof schema.minimum === "number") {
    return schema.minimum;
  }
  if (typeof schema.maximum === "number") {
    // Only a negative maximum forces us off the usual 0 default (0 would
    // violate `x <= maximum` when maximum is negative).
    return schema.maximum < 0 ? schema.maximum : 0;
  }
  return 0;
}

function generateObject(
  index: SpecIndex,
  schema: any,
  mode: "request" | "response" | undefined,
  depth: number,
  visited: Set<string>
): Record<string, unknown> {
  if (depth >= MAX_DEPTH) {
    return {};
  }

  const merged = mergeAllOf(index, schema, visited);
  const names = Object.keys(merged.properties);
  const includeAll = names.length <= MAX_ALL_PROPERTIES;

  const result: Record<string, unknown> = {};
  for (const name of names) {
    if (!includeAll && !merged.required.includes(name)) {
      continue;
    }
    const propSchema = merged.properties[name];
    const resolvedProp = resolveForFlagCheck(index, propSchema, visited);
    if (mode === "request" && resolvedProp && resolvedProp.readOnly === true) {
      continue;
    }
    if (mode === "response" && resolvedProp && resolvedProp.writeOnly === true) {
      continue;
    }
    result[name] = generate(index, propSchema, mode, depth + 1, visited);
  }
  return result;
}

function generateArray(
  index: SpecIndex,
  schema: any,
  mode: "request" | "response" | undefined,
  depth: number,
  visited: Set<string>
): unknown[] {
  if (depth >= MAX_DEPTH || schema.items === undefined) {
    return [];
  }
  return [generate(index, schema.items, mode, depth + 1, visited)];
}

/**
 * Merge `schema`'s own `properties`/`required` with every `allOf` branch's
 * (recursively, following `$ref`s), so e.g. `{allOf:[{$ref:'#/.../Base'}],
 * properties:{...}}` produces the union of Base's and the schema's own
 * properties. Uses its own copy of `visited` so a pathological cyclic
 * `allOf`/`$ref` chain among *branches* can't loop forever independent of
 * the value-generation cycle guard above.
 */
function mergeAllOf(
  index: SpecIndex,
  schema: any,
  visited: Set<string>
): { properties: Record<string, any>; required: string[] } {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  const localVisited = new Set(visited);

  function absorb(node: any): void {
    if (!node || typeof node !== "object") {
      return;
    }
    if (typeof node.$ref === "string") {
      const pointer = refToPointer(node.$ref);
      if (pointer === null || localVisited.has(pointer)) {
        return;
      }
      localVisited.add(pointer);
      const resolved = getByPointer(index.value, pointer);
      if (resolved !== undefined) {
        absorb(resolved);
      }
      return;
    }
    if (node.properties && typeof node.properties === "object") {
      for (const key of Object.keys(node.properties)) {
        properties[key] = node.properties[key];
      }
    }
    if (Array.isArray(node.required)) {
      required.push(...node.required);
    }
    if (Array.isArray(node.allOf)) {
      for (const branch of node.allOf) {
        absorb(branch);
      }
    }
  }

  absorb(schema);
  return { properties, required: Array.from(new Set(required)) };
}

/**
 * Resolve `schema` one hop (if it's a `$ref`) purely to inspect its
 * `readOnly`/`writeOnly` flags — never used for value generation, so it
 * doesn't extend `visited` itself. Returns `undefined` for an unresolvable
 * or already-visited ref, which callers treat as "no flag set".
 */
function resolveForFlagCheck(index: SpecIndex, schema: any, visited: Set<string>): any {
  if (!schema || typeof schema !== "object") {
    return schema;
  }
  if (typeof schema.$ref !== "string") {
    return schema;
  }
  const pointer = refToPointer(schema.$ref);
  if (pointer === null || visited.has(pointer)) {
    return undefined;
  }
  return getByPointer(index.value, pointer);
}

/** Same semantics as resolve.ts's internal helper: walk plain JS by JSON Pointer. */
function getByPointer(root: any, pointer: string): any {
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

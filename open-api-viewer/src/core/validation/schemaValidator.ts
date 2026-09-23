// Structural (JSON-Schema) validation against the reduced OAS schema in
// oasSchema.ts, via ajv v8 + ajv-formats. Pure, no vscode dependency.

import Ajv, { ErrorObject, ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { AstNode, Issue, ParseResult, SpecIndex } from "../types";
import { getOasSchema } from "./oasSchema";

// One compiled validator per OAS version, built lazily and cached for the
// life of the extension host process.
const validators = new Map<"3.0" | "3.1", ValidateFunction>();

function getValidator(version: "3.0" | "3.1"): ValidateFunction {
  const cached = validators.get(version);
  if (cached) {
    return cached;
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(getOasSchema(version));
  validators.set(version, validate);
  return validate;
}

/**
 * Validate `parseResult.value` against the reduced structural schema for
 * `index.version`. Returns [] when the version could not be detected —
 * there is nothing sensible to validate against.
 */
export function validateAgainstSchema(parseResult: ParseResult, index: SpecIndex): Issue[] {
  if (index.version !== "3.0" && index.version !== "3.1") {
    return [];
  }

  const validate = getValidator(index.version);
  const valid = validate(parseResult.value);
  if (valid || !validate.errors) {
    return [];
  }

  const seen = new Set<string>();
  const issues: Issue[] = [];
  for (const error of validate.errors) {
    const dedupeKey = `${error.instancePath}::${error.keyword}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    issues.push(toIssue(error, index));
  }
  return issues;
}

function toIssue(error: ErrorObject, index: SpecIndex): Issue {
  const { offset, length } = locate(error, index);
  const propertyPath = error.instancePath === "" ? "(root)" : error.instancePath;
  return {
    code: "openapi-schema/" + error.keyword,
    message: `${propertyPath}: ${error.message ?? "is invalid"}`,
    severity: "error",
    offset,
    length,
    source: "openapi",
  };
}

/** Map an ajv error to an offset/length range in the source document. */
function locate(error: ErrorObject, index: SpecIndex): { offset: number; length: number } {
  if (error.keyword === "required") {
    // The missing property has no node of its own, so instancePath names
    // its *parent* — fall back to the parent's own key range, or offset
    // 0/length 1 when the parent is the document root (which has no key).
    const parentPointer = error.instancePath;
    if (parentPointer === "") {
      return { offset: 0, length: 1 };
    }
    const parentNode = index.byPointer.get(parentPointer);
    return parentNode ? keyRange(parentNode) : { offset: 0, length: 1 };
  }

  const node = index.byPointer.get(error.instancePath);
  return node ? keyRange(node) : { offset: 0, length: 1 };
}

function keyRange(node: AstNode): { offset: number; length: number } {
  if (node.keyOffset !== undefined && node.keyLength !== undefined) {
    return { offset: node.keyOffset, length: node.keyLength };
  }
  return { offset: node.offset, length: Math.max(node.length, 1) };
}

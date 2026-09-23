// $ref resolution helpers over a built SpecIndex. Pure, no vscode dependency.
// Only local ("#/...") refs are handled — multi-file $ref is out of scope.

import { AstNode, SpecIndex } from "./types";
import { refToPointer, pointerToSegments } from "./pointer";

/** Resolve a $ref string to the AstNode it points at, local refs only. */
export function resolveRef(index: SpecIndex, ref: string): AstNode | undefined {
  const pointer = refToPointer(ref);
  if (pointer === null) {
    return undefined;
  }
  return index.byPointer.get(pointer);
}

/**
 * Given a plain JS value that might be `{ $ref: "#/..." }`, follow the ref
 * chain (through `index.value`, not the AST) until a non-ref value is
 * reached, a cycle is detected, or `maxDepth` is exceeded. Values that are
 * not ref objects are returned unchanged.
 */
export function derefValue(index: SpecIndex, value: any, maxDepth = 8): any {
  const seen = new Set<string>();
  let current = value;
  let depth = 0;

  while (
    current !== null &&
    typeof current === "object" &&
    typeof current.$ref === "string" &&
    depth < maxDepth
  ) {
    const ref: string = current.$ref;
    const pointer = refToPointer(ref);
    if (pointer === null || seen.has(pointer)) {
      return current;
    }
    seen.add(pointer);

    const resolved = getByPointer(index.value, pointer);
    if (resolved === undefined) {
      return current;
    }
    current = resolved;
    depth++;
  }

  return current;
}

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

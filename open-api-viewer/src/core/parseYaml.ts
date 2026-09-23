// YAML parsing into our unified AstNode shape, via the `yaml` package (v2).
// Pure, no vscode dependency.

import { parseDocument, isMap, isSeq, isScalar } from "yaml";
import { AstNode, ParseIssue, ParseResult } from "./types";
import { encodeSegment } from "./pointer";

export function parseYaml(text: string): ParseResult {
  const doc = parseDocument(text, { uniqueKeys: false, prettyErrors: false });

  const errors: ParseIssue[] = [
    ...doc.errors.map((e) => toIssue(e, "error")),
    ...doc.warnings.map((e) => toIssue(e, "warning")),
  ];

  if (doc.contents === null || doc.contents === undefined) {
    return { root: undefined, value: undefined, errors, lang: "yaml", text };
  }

  const root = convert(doc.contents, undefined, "");
  const value = doc.toJS({ mapAsMap: false });

  return { root, value, errors, lang: "yaml", text };
}

function toIssue(e: { message: string; pos?: [number, number] }, severity: "error" | "warning"): ParseIssue {
  const [start, end] = e.pos ?? [0, 0];
  return {
    message: e.message,
    offset: start,
    length: Math.max(0, end - start),
    severity,
  };
}

function convert(node: any, parent: AstNode | undefined, pointer: string): AstNode {
  const range: [number, number, number] = node.range ?? [0, 0, 0];
  const offset = range[0];
  const length = Math.max(0, range[1] - range[0]);

  if (isMap(node)) {
    const ast: AstNode = { kind: "object", offset, length, pointer, parent, children: [], isFlow: !!node.flow };
    const children: AstNode[] = [];
    for (const pair of node.items) {
      const key: any = pair.key;
      const keyStr = resolveKeyString(key);
      const childPointer = pointer + "/" + encodeSegment(keyStr);
      const childAst = convertPairValue(pair.value, ast, childPointer, key);
      childAst.key = keyStr;
      const keyRange = key && key.range;
      if (keyRange) {
        childAst.keyOffset = keyRange[0];
        childAst.keyLength = Math.max(0, keyRange[1] - keyRange[0]);
      }
      children.push(childAst);
    }
    ast.children = children;
    return ast;
  }

  if (isSeq(node)) {
    const ast: AstNode = { kind: "array", offset, length, pointer, parent, children: [], isFlow: !!node.flow };
    const children: AstNode[] = [];
    node.items.forEach((item: any, index: number) => {
      const childPointer = pointer + "/" + index;
      const childAst = convert(item, ast, childPointer);
      // Array elements carry their index as `.key` (AstNode.key is
      // string|number) so ast.ts's getPath() can rebuild the full path.
      childAst.key = index;
      children.push(childAst);
    });
    ast.children = children;
    return ast;
  }

  if (isScalar(node)) {
    return { kind: scalarKind(node.value), offset, length, value: node.value, pointer, parent };
  }

  // Unexpected node type (e.g. an unresolved Alias). Fall back to a null leaf
  // rather than throwing, so a single odd construct doesn't break the whole
  // document's index.
  return { kind: "null", offset, length, value: null, pointer, parent };
}

/**
 * Convert a mapping value that might be absent (YAML allows `key:` with no
 * value, which yields `pair.value === null`). We still need an AstNode so
 * the key metadata has somewhere to live.
 */
function convertPairValue(
  value: any,
  parent: AstNode,
  pointer: string,
  keyNode: any
): AstNode {
  if (value === null || value === undefined) {
    const keyRange = keyNode && keyNode.range;
    const offset = keyRange ? keyRange[1] : parent.offset;
    return { kind: "null", offset, length: 0, value: null, pointer, parent };
  }
  return convert(value, parent, pointer);
}

function resolveKeyString(key: any): string {
  if (key === null || key === undefined) {
    return "";
  }
  if (isScalar(key)) {
    return String(key.value ?? "");
  }
  return String(key);
}

function scalarKind(value: unknown): AstNode["kind"] {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return "string";
  }
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  // Uncommon scalar types (e.g. !!timestamp -> Date) don't fit our AstKind
  // union; treat them as strings since that's the closest OpenAPI-relevant
  // representation.
  return "string";
}

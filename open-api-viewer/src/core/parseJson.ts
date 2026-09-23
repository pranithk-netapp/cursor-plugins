// JSON/JSONC parsing into our unified AstNode shape, via jsonc-parser.
// Pure, no vscode dependency.

import {
  parseTree,
  getNodeValue,
  printParseErrorCode,
  Node as JsoncNode,
  ParseError,
  ParseErrorCode,
} from "jsonc-parser";
import { AstNode, ParseIssue, ParseResult } from "./types";
import { encodeSegment } from "./pointer";

export function parseJson(text: string): ParseResult {
  const parseErrors: ParseError[] = [];
  const tree = parseTree(text, parseErrors, { allowTrailingComma: true });

  const errors: ParseIssue[] = parseErrors.map((e) => ({
    message: describeError(e.error),
    offset: e.offset,
    length: e.length,
    severity: "error" as const,
  }));

  let root: AstNode | undefined;
  let value: any = undefined;
  if (tree) {
    root = convert(tree, undefined, "");
    value = getNodeValue(tree);
  }

  return { root, value, errors, lang: "json", text };
}

function describeError(code: ParseErrorCode): string {
  try {
    return printParseErrorCode(code);
  } catch {
    return `JSON parse error (code ${code})`;
  }
}

function convert(node: JsoncNode, parent: AstNode | undefined, pointer: string): AstNode {
  const kind = mapKind(node.type);

  if (kind === "object") {
    const ast: AstNode = { kind, offset: node.offset, length: node.length, pointer, parent, children: [] };
    const children: AstNode[] = [];
    for (const propNode of node.children ?? []) {
      // jsonc-parser wraps each entry as a 'property' node whose own
      // children are [keyNode, valueNode]. We flatten that wrapper away:
      // the value's AstNode carries key/keyOffset/keyLength directly, and
      // its parent points straight at the enclosing object.
      const [keyNode, valueNode] = propNode.children ?? [];
      if (!keyNode || !valueNode) {
        continue;
      }
      const keyStr = String(keyNode.value);
      const childPointer = pointer + "/" + encodeSegment(keyStr);
      const childAst = convert(valueNode, ast, childPointer);
      childAst.key = keyStr;
      childAst.keyOffset = keyNode.offset;
      childAst.keyLength = keyNode.length;
      children.push(childAst);
    }
    ast.children = children;
    return ast;
  }

  if (kind === "array") {
    const ast: AstNode = { kind, offset: node.offset, length: node.length, pointer, parent, children: [] };
    const children: AstNode[] = [];
    (node.children ?? []).forEach((childNode, index) => {
      const childPointer = pointer + "/" + index;
      const childAst = convert(childNode, ast, childPointer);
      // Array elements carry their index as `.key` (AstNode.key is
      // string|number) so ast.ts's getPath() can rebuild the full path.
      childAst.key = index;
      children.push(childAst);
    });
    ast.children = children;
    return ast;
  }

  return { kind, offset: node.offset, length: node.length, value: node.value, pointer, parent };
}

function mapKind(type: JsoncNode["type"]): AstNode["kind"] {
  switch (type) {
    case "object":
      return "object";
    case "array":
      return "array";
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    default:
      // 'property' should never be handed to convert() directly.
      return "null";
  }
}

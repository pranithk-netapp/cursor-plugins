// Structural text edits (insert a new key, remove an existing one) for both
// JSON and YAML OpenAPI documents. Pure, no vscode dependency: callers pass
// raw text plus the already-parsed AstNode so this module never re-parses.
//
// JSON edits are delegated entirely to jsonc-parser's `modify`, which knows
// how to create missing parent objects and format the result. YAML has no
// equivalent "patch in place" API that preserves the rest of the document's
// formatting, so the YAML path below hand-builds a minimal text edit: find
// the deepest existing mapping reachable by walking the parent path, render
// just the missing tail with the `yaml` package (which formats correctly
// relative to column 0), then re-indent and splice that fragment in after
// the mapping's last existing entry (or after its own key, if it has none).

import { modify } from "jsonc-parser";
import * as YAML from "yaml";
import { AstNode } from "./types";
import { childByKey } from "./ast";
import { LineIndex } from "./lineIndex";

export class InsertError extends Error {}

export interface TextInsertion {
  offset: number;
  length: number;
  newText: string;
}

export interface ComputeInsertionParams {
  text: string;
  lang: "json" | "yaml";
  ast: AstNode | undefined;
  parentPath: (string | number)[];
  key: string | number;
  value: unknown;
  /** e.g. "  " (2 spaces), "    " (4 spaces) or "\t". */
  indentUnit: string;
  /** "\n" or "\r\n". */
  eol: string;
}

export interface ComputeRemovalParams {
  text: string;
  lang: "json" | "yaml";
  ast: AstNode | undefined;
  /** Full path to the property to remove, e.g. ["components", "schemas", "Foo"]. */
  path: (string | number)[];
  eol?: string;
}

export function computeInsertion(params: ComputeInsertionParams): TextInsertion[] {
  const { text, lang, ast, parentPath, key, value, indentUnit, eol } = params;
  if (lang === "json") {
    return computeJsonInsertion(text, parentPath, key, value, indentUnit, eol);
  }
  return computeYamlInsertion(text, ast, parentPath, key, value, indentUnit, eol);
}

export function computeRemoval(params: ComputeRemovalParams): TextInsertion[] {
  const { text, lang, ast, path, eol } = params;
  if (path.length === 0) {
    throw new InsertError("Cannot remove the document root.");
  }
  if (lang === "json") {
    return computeJsonRemoval(text, path, eol ?? "\n");
  }
  return computeYamlRemoval(text, ast, path);
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

function computeJsonInsertion(
  text: string,
  parentPath: (string | number)[],
  key: string | number,
  value: unknown,
  indentUnit: string,
  eol: string
): TextInsertion[] {
  const edits = modify(text, [...parentPath, key], value, {
    formattingOptions: {
      tabSize: indentUnit === "\t" ? 2 : Math.max(1, indentUnit.length),
      insertSpaces: indentUnit !== "\t",
      eol,
    },
  });
  return edits.map((edit) => ({ offset: edit.offset, length: edit.length, newText: edit.content }));
}

function computeJsonRemoval(text: string, path: (string | number)[], eol: string): TextInsertion[] {
  const edits = modify(text, path, undefined, {
    formattingOptions: { tabSize: 2, insertSpaces: true, eol },
  });
  return edits.map((edit) => ({ offset: edit.offset, length: edit.length, newText: edit.content }));
}

// ---------------------------------------------------------------------------
// YAML insertion
// ---------------------------------------------------------------------------

/** Walk `parentPath` against `ast` via object-key lookups only as far as it goes. */
function walkExistingPath(
  ast: AstNode,
  parentPath: (string | number)[]
): { node: AstNode; remaining: (string | number)[] } {
  let node = ast;
  for (let i = 0; i < parentPath.length; i++) {
    if (node.kind !== "object") {
      return { node, remaining: parentPath.slice(i) };
    }
    const segment = parentPath[i];
    const child = typeof segment === "string" ? childByKey(node, segment) : node.children?.[segment as number];
    if (!child) {
      return { node, remaining: parentPath.slice(i) };
    }
    node = child;
  }
  return { node, remaining: [] };
}

/** Build a nested plain object wrapping `value` under `key`, prefixed by `remaining` path segments. */
function wrapPath(remaining: (string | number)[], key: string | number, value: unknown): any {
  let wrapped: any = { [key]: value };
  for (let i = remaining.length - 1; i >= 0; i--) {
    wrapped = { [remaining[i]]: wrapped };
  }
  return wrapped;
}

function computeYamlInsertion(
  text: string,
  ast: AstNode | undefined,
  parentPath: (string | number)[],
  key: string | number,
  value: unknown,
  indentUnit: string,
  eol: string
): TextInsertion[] {
  // A genuinely empty document (no content at all) has no AstNode at all.
  if (!ast) {
    const nested = wrapPath(parentPath, key, value);
    const fragment = stripTrailingEol(YAML.stringify(nested, { indent: indentSize(indentUnit), lineWidth: 0 }));
    const newText = toEol(fragment, eol);
    return [{ offset: 0, length: 0, newText }];
  }

  const { node: target, remaining } = walkExistingPath(ast, parentPath);
  if (target.isFlow) {
    throw new InsertError(
      "Flow-style YAML mapping is not supported for structural edits; convert to block style first."
    );
  }

  const lineIndex = new LineIndex(text);
  const nested = wrapPath(remaining, key, value);
  const fragmentRaw = YAML.stringify(nested, { indent: indentSize(indentUnit), lineWidth: 0 });
  const fragment = stripTrailingEol(fragmentRaw);

  const column = targetColumn(target, lineIndex, indentUnit);
  const indented = indentFragment(fragment, column, eol);

  const insertOffset = insertionOffset(text, target);
  // If the offset already sits right after a newline (the common case when
  // the last child is itself a nested block value, whose yaml.Node range
  // already swallows its own trailing newline), the separator belongs
  // *after* the fragment instead of before it — otherwise we'd leave a
  // blank line before the fragment and glue its last line onto whatever
  // follows.
  const atLineStart = insertOffset === 0 || text[insertOffset - 1] === "\n";
  const newText = atLineStart ? indented + eol : eol + indented;

  return [{ offset: insertOffset, length: 0, newText }];
}

function indentSize(indentUnit: string): number {
  return Math.max(1, indentUnit.length);
}

/** Convert '\n'-separated text to use `eol` as its line separator. */
function toEol(text: string, eol: string): string {
  return eol === "\n" ? text : text.split("\n").join(eol);
}

/** Drop exactly one trailing newline (the one yaml.stringify always appends), keeping '\n' as the separator. */
function stripTrailingEol(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/** Prefix every line of `fragment` (still '\n'-separated) with `column` spaces, then join with `eol`. */
function indentFragment(fragment: string, column: number, eol: string): string {
  const pad = " ".repeat(column);
  return fragment
    .split("\n")
    .map((line) => (line.length === 0 ? line : pad + line))
    .join(eol);
}

/** The column new sibling entries of `target` should start at. */
function targetColumn(target: AstNode, lineIndex: LineIndex, indentUnit: string): number {
  if (target.children && target.children.length > 0) {
    const firstChild = target.children[0];
    return lineIndex.positionAt(firstChild.keyOffset ?? firstChild.offset).col;
  }
  if (target.keyOffset === undefined) {
    // The document root itself, with nothing in it yet.
    return indentSize(indentUnit);
  }
  return lineIndex.positionAt(target.keyOffset).col + indentSize(indentUnit);
}

/**
 * The offset after which the new fragment should be inserted: right after
 * the full last line of the existing content, never mid-line.
 *
 * The `yaml` package's node ranges for a block mapping/sequence *value*
 * already extend through that value's own trailing newline up to the start
 * of the next sibling line (so `lastChild.offset + lastChild.length` for a
 * nested-object child already lands at a fresh line start) — but for a
 * scalar child (or a key with no value at all) the anchor lands mid-line,
 * before that line's own terminating newline. Handle both: if the anchor is
 * already at a line start, use it as-is; otherwise scan forward to that
 * line's `\n` (without consuming it) so the caller's `eol + fragment` lands
 * cleanly between the existing line and whatever follows it.
 */
function insertionOffset(text: string, target: AstNode): number {
  let anchor: number;
  if (target.children && target.children.length > 0) {
    const lastChild = target.children[target.children.length - 1];
    anchor = lastChild.offset + lastChild.length;
  } else if (target.keyOffset !== undefined) {
    anchor = target.keyOffset + (target.keyLength ?? 0);
  } else {
    anchor = target.offset + target.length;
  }
  if (anchor === 0 || text[anchor - 1] === "\n") {
    return anchor;
  }
  const nextNewline = text.indexOf("\n", anchor);
  return nextNewline === -1 ? text.length : nextNewline;
}

// ---------------------------------------------------------------------------
// YAML removal
// ---------------------------------------------------------------------------

function computeYamlRemoval(text: string, ast: AstNode | undefined, path: (string | number)[]): TextInsertion[] {
  if (!ast) {
    throw new InsertError("Cannot remove a property from an empty document.");
  }
  const parentPath = path.slice(0, -1);
  const lastKey = path[path.length - 1];
  const { node: parent, remaining } = walkExistingPath(ast, parentPath);
  if (remaining.length > 0) {
    throw new InsertError(`Path ${JSON.stringify(path)} does not exist.`);
  }
  if (parent.isFlow) {
    throw new InsertError(
      "Flow-style YAML mapping is not supported for structural edits; convert to block style first."
    );
  }
  if (parent.kind !== "object" || !parent.children) {
    throw new InsertError(`Path ${JSON.stringify(path)} does not exist.`);
  }
  const child = typeof lastKey === "string" ? childByKey(parent, lastKey) : parent.children[lastKey as number];
  if (!child) {
    throw new InsertError(`Path ${JSON.stringify(path)} does not exist.`);
  }

  const keyStart = child.keyOffset ?? child.offset;
  // Include the entry's own leading indentation by extending back to the
  // start of its line, so removal never leaves trailing blank indentation.
  const lineStart = lastIndexOfNewlineBefore(text, keyStart) + 1;

  let end = child.offset + child.length;
  // Consume the line's own trailing newline (\n or \r\n) so we don't leave a blank line behind.
  if (text[end] === "\r" && text[end + 1] === "\n") {
    end += 2;
  } else if (text[end] === "\n") {
    end += 1;
  }

  return [{ offset: lineStart, length: end - lineStart, newText: "" }];
}

function lastIndexOfNewlineBefore(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1);
}

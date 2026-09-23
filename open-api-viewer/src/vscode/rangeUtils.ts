// Small shared AstNode -> vscode.Range conversions, used by symbols,
// definition, hover, references, rename and the outline provider.

import * as vscode from "vscode";
import { AstNode } from "../core/types";

/** A node's key range if it has one, else its own (value) range. */
export function rangeOfNode(document: vscode.TextDocument, node: AstNode): vscode.Range {
  if (node.keyOffset !== undefined && node.keyLength !== undefined) {
    return offsetRange(document, node.keyOffset, node.keyLength);
  }
  return offsetRange(document, node.offset, node.length);
}

/**
 * The full range spanning from a node's key (if any) through its value.
 * Used for DocumentSymbol/outline container ranges, where the visible
 * "range" should cover the whole `"key": value` entry, not just the key.
 */
export function fullRangeOfNode(document: vscode.TextDocument, node: AstNode): vscode.Range {
  const startOffset = node.keyOffset !== undefined ? node.keyOffset : node.offset;
  const endOffset = node.offset + node.length;
  return new vscode.Range(document.positionAt(startOffset), document.positionAt(endOffset));
}

export function offsetRange(document: vscode.TextDocument, offset: number, length: number): vscode.Range {
  return new vscode.Range(document.positionAt(offset), document.positionAt(offset + length));
}

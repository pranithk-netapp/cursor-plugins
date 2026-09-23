// Small shared helpers for turning core/insert.ts's TextInsertion[] into a
// vscode.WorkspaceEdit, and for detecting a document's indent unit/eol so
// inserted text matches the surrounding style. Used by commands.ts and
// codeActions.ts.

import * as vscode from "vscode";
import { TextInsertion } from "../core/insert";

/** Convert pure TextInsertion[] offsets into a vscode.WorkspaceEdit against `document`. */
export function insertionsToWorkspaceEdit(document: vscode.TextDocument, insertions: TextInsertion[]): vscode.WorkspaceEdit {
  const edit = new vscode.WorkspaceEdit();
  for (const insertion of insertions) {
    const range = new vscode.Range(
      document.positionAt(insertion.offset),
      document.positionAt(insertion.offset + insertion.length)
    );
    edit.replace(document.uri, range, insertion.newText);
  }
  return edit;
}

const VALID_SPACE_INDENTS = [2, 4];

/**
 * Best-effort indent unit + eol for `document`: prefer the active editor's
 * own options when it's showing this exact document, else scan the text for
 * the first indented line, else fall back to two spaces.
 */
export function detectIndent(document: vscode.TextDocument): { indentUnit: string; eol: string } {
  const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";

  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && activeEditor.document.uri.toString() === document.uri.toString()) {
    const options = activeEditor.options;
    if (options.insertSpaces === false) {
      return { indentUnit: "\t", eol };
    }
    const tabSize = typeof options.tabSize === "number" ? options.tabSize : 2;
    return { indentUnit: " ".repeat(Math.max(1, tabSize)), eol };
  }

  const text = document.getText();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const match = /^([ \t]+)\S/.exec(line);
    if (!match) {
      continue;
    }
    const whitespace = match[1];
    if (whitespace.includes("\t")) {
      return { indentUnit: "\t", eol };
    }
    if (VALID_SPACE_INDENTS.includes(whitespace.length)) {
      return { indentUnit: " ".repeat(whitespace.length), eol };
    }
  }
  return { indentUnit: "  ", eol };
}

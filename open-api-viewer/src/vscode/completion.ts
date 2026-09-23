// `$ref` value completion: offers every component in the document as soon
// as the cursor is inside a `"$ref": "..."` (JSON) or `$ref: ...` (YAML)
// value. Detection is a plain regex on the current line's text up to the
// cursor, matching the pattern used by 42Crunch-style editors rather than
// anything AST-based, since the value being typed is (by definition) not
// valid syntax yet.

import * as vscode from "vscode";
import { summarizeRefTarget } from "../core/summary";
import { isOpenApiDocument } from "./detector";
import { DocumentCache } from "./documentCache";

const JSON_REF_RE = /"\$ref"\s*:\s*"([^"]*)$/;
// Captures an optional opening quote separately so we know whether to add
// one ourselves: a bare (unquoted) `$ref: #/...` would otherwise parse as a
// YAML comment.
const YAML_REF_RE = /^\s*\$ref:\s*(['"])?([^'"]*)$/;

export class OpenApiRefCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly cache: DocumentCache) {}

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    if (!isOpenApiDocument(document)) {
      return [];
    }

    const linePrefix = document.lineAt(position.line).text.substring(0, position.character);
    const isYaml = document.languageId === "yaml";

    let typed: string;
    let needsQuoting = false;
    if (isYaml) {
      const match = YAML_REF_RE.exec(linePrefix);
      if (!match) {
        return [];
      }
      typed = match[2];
      needsQuoting = match[1] === undefined;
    } else {
      const match = JSON_REF_RE.exec(linePrefix);
      if (!match) {
        return [];
      }
      typed = match[1];
    }

    const replaceRange = new vscode.Range(position.translate(0, -typed.length), position);
    const { index } = this.cache.get(document);

    const items: vscode.CompletionItem[] = [];
    for (const info of index.components.values()) {
      const pointer = "#" + info.pointer;
      const item = new vscode.CompletionItem(pointer, vscode.CompletionItemKind.Reference);
      item.detail = info.type;
      item.documentation = new vscode.MarkdownString(summarizeRefTarget(index, info.pointer));
      item.insertText = needsQuoting ? `"${pointer}"` : pointer;
      item.filterText = pointer;
      item.range = replaceRange;
      items.push(item);
    }
    return items;
  }
}

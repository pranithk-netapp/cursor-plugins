// CodeLens provider for "Try it": one "▶ Try it" lens above each operation's
// HTTP method key, invoking openapiViewer.tryOperation with that operation's
// pointer. Mirrors the rest of the extension's cache-driven refresh pattern
// (see vscode/outlineProvider.ts) via onDidChangeCodeLenses.

import * as vscode from "vscode";
import { DocumentCache } from "./documentCache";
import { isOpenApiDocument } from "./detector";
import { getConfig } from "./config";

export class OpenApiTryItCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this.emitter.event;

  constructor(private readonly cache: DocumentCache) {
    cache.onDidChange(() => this.emitter.fire());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!isOpenApiDocument(document) || !getConfig().codeLensEnabled) {
      return [];
    }

    const { index } = this.cache.get(document);
    const lenses: vscode.CodeLens[] = [];
    for (const op of index.operations) {
      const position = document.positionAt(op.keyOffset);
      const endPosition = document.positionAt(op.keyOffset + op.keyLength);
      const range = new vscode.Range(position, endPosition);
      lenses.push(
        new vscode.CodeLens(range, {
          title: "▶ Try it",
          command: "openapiViewer.tryOperation",
          arguments: [document.uri, op.pointer],
        })
      );
    }
    return lenses;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

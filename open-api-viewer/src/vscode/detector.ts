import * as vscode from "vscode";
import { detectOpenApi } from "../core/detect";

type DetectResult = "3.0" | "3.1" | "2.0" | null;

// Cache keyed by `${uri}::${version}` so repeated calls on an unchanged
// document (e.g. from multiple providers) don't re-scan the text.
const cache = new Map<string, DetectResult>();

function cacheKey(document: vscode.TextDocument): string {
  return `${document.uri.toString()}::${document.version}`;
}

function detect(document: vscode.TextDocument): DetectResult {
  const key = cacheKey(document);
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const result = detectOpenApi(document.getText());
  cache.set(key, result);
  return result;
}

export function getOpenApiVersion(document: vscode.TextDocument): DetectResult {
  return detect(document);
}

export function isOpenApiDocument(document: vscode.TextDocument): boolean {
  return detect(document) !== null;
}

/**
 * Keep the `openapiViewer.isOpenApi` context key in sync with the active
 * editor's document, so `when` clauses (menus, keybindings, etc.) added by
 * later phases can gate on it.
 */
export function registerContextKeyUpdater(context: vscode.ExtensionContext): void {
  const update = (document: vscode.TextDocument | undefined) => {
    const value = document ? isOpenApiDocument(document) : false;
    void vscode.commands.executeCommand("setContext", "openapiViewer.isOpenApi", value);
  };

  update(vscode.window.activeTextEditor?.document);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      update(editor?.document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const active = vscode.window.activeTextEditor;
      if (active && event.document === active.document) {
        update(active.document);
      }
    })
  );
}

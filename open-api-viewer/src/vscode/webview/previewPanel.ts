import * as vscode from "vscode";
import * as path from "node:path";
import { DocumentCache } from "../documentCache";
import { buildWebviewHtml } from "./html";

// Shown on the very first render of a document that already has parse
// errors when the panel opens, so Swagger UI doesn't show its own
// confusing error state before any real spec has ever been posted. Once a
// good parse comes in, this is replaced and never shown again for that
// panel; a document that goes from good -> broken keeps its last good
// render on screen instead (per the plan).
const FALLBACK_SPEC = {
  openapi: "3.0.0",
  info: { title: "(invalid document)", version: "0" },
  paths: {}
};

/**
 * Compute the spec payload that would be posted into a document's Preview
 * webview, without needing a live panel or a postMessage round-trip.
 * Extracted from the panel's internal `postCurrentSpec` closure so tests
 * (and any future caller) can call it directly. Returns `undefined` when
 * the document currently has no good parse AND has never rendered before
 * (mirroring the "don't clobber the last good render" behavior below) —
 * callers that just want "the spec for this document" should treat that
 * as "use the fallback".
 */
export function computeSpecPayload(document: vscode.TextDocument, cache: DocumentCache): unknown {
  const { parseResult } = cache.get(document);
  const isGoodParse = parseResult.errors.length === 0 && parseResult.root !== undefined;
  return isGoodParse ? parseResult.value : FALLBACK_SPEC;
}

interface PanelEntry {
  panel: vscode.WebviewPanel;
  messageDisposable: vscode.Disposable;
  changeDisposable: vscode.Disposable;
  /** Whether we've ever posted a real or fallback spec to this panel. */
  hasRendered: boolean;
}

/**
 * Owns one Swagger UI "Preview" webview panel per document URI, reusing
 * (revealing) an existing panel instead of creating a second one for the
 * same document.
 */
export class PreviewPanelController implements vscode.Disposable {
  private readonly panels = new Map<string, PanelEntry>();

  /** Test-only accessor: number of live preview panels currently tracked. */
  getPanelCount(): number {
    return this.panels.size;
  }

  /** Test-only accessor: the live preview panel for `uri`, if any. */
  getPanel(uri: vscode.Uri): vscode.WebviewPanel | undefined {
    return this.panels.get(uri.toString())?.panel;
  }

  showPreview(context: vscode.ExtensionContext, document: vscode.TextDocument, cache: DocumentCache): void {
    const key = document.uri.toString();
    const existing = this.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "openapiViewer.preview",
      `Preview: ${path.basename(document.uri.fsPath)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")]
      }
    );

    panel.webview.html = buildWebviewHtml({
      webview: panel.webview,
      extensionUri: context.extensionUri,
      preScriptRelPaths: ["media/swagger-ui/swagger-ui-bundle.js"],
      scriptRelPath: "media/dist/preview.js",
      cssRelPaths: ["media/swagger-ui/swagger-ui.css"],
      title: `Preview: ${path.basename(document.uri.fsPath)}`,
      bodyHtml: '<div id="ui"></div>',
      connectSrc: "'none'"
    });

    const postCurrentSpec = (): void => {
      const entry = this.panels.get(key);
      if (!entry) {
        return;
      }
      const { parseResult } = cache.get(document);
      // A "good" parse: the parser didn't report any errors and actually
      // produced a root AST node. (SpecIndex.root is always a defined node
      // — an empty sentinel on a failed parse — so we check
      // parseResult.root, the parser's own output, rather than index.root.)
      const isGoodParse = parseResult.errors.length === 0 && parseResult.root !== undefined;
      if (isGoodParse) {
        void entry.panel.webview.postMessage({ type: "spec", spec: computeSpecPayload(document, cache) });
        entry.hasRendered = true;
      } else if (!entry.hasRendered) {
        void entry.panel.webview.postMessage({ type: "spec", spec: FALLBACK_SPEC });
        entry.hasRendered = true;
      }
      // Otherwise: parse is currently broken but we've rendered before —
      // keep the last good render on screen, per the plan.
    };

    const messageDisposable = panel.webview.onDidReceiveMessage((msg: { type?: string }) => {
      if (msg && msg.type === "ready") {
        postCurrentSpec();
      }
    });

    const changeDisposable = cache.onDidChange((uri) => {
      if (uri.toString() === key) {
        postCurrentSpec();
      }
    });

    panel.onDidDispose(() => {
      messageDisposable.dispose();
      changeDisposable.dispose();
      this.panels.delete(key);
    });

    this.panels.set(key, { panel, messageDisposable, changeDisposable, hasRendered: false });
  }

  dispose(): void {
    for (const entry of this.panels.values()) {
      entry.messageDisposable.dispose();
      entry.changeDisposable.dispose();
      entry.panel.dispose();
    }
    this.panels.clear();
  }
}

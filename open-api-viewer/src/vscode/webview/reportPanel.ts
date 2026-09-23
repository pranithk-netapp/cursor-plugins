import * as vscode from "vscode";
import * as path from "node:path";
import { DocumentCache } from "../documentCache";
import { getConfig } from "../config";
import { runAudit } from "../../core/audit/engine";
import { rangeOfNode } from "../rangeUtils";
import { buildWebviewHtml } from "./html";

interface PanelEntry {
  panel: vscode.WebviewPanel;
  messageDisposable: vscode.Disposable;
  changeDisposable: vscode.Disposable;
}

/**
 * Owns one "Audit Report" webview panel per document URI, mirroring
 * PreviewPanelController's one-panel-per-doc pattern. Runs the audit and
 * posts `{type:'report', report}` on 'ready', on `cache.onDidChange` for
 * that document, and on a `{type:'rerun'}` message from the Re-run
 * button; handles `{type:'reveal', pointer}` by focusing the editor and
 * selecting that pointer's range.
 */
export class ReportPanelController implements vscode.Disposable {
  private readonly panels = new Map<string, PanelEntry>();

  showReport(context: vscode.ExtensionContext, document: vscode.TextDocument, cache: DocumentCache): void {
    const key = document.uri.toString();
    const existing = this.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside);
      this.postReport(document, cache);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "openapiViewer.report",
      `Audit: ${path.basename(document.uri.fsPath)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
      }
    );

    panel.webview.html = buildWebviewHtml({
      webview: panel.webview,
      extensionUri: context.extensionUri,
      scriptRelPath: "media/dist/report.js",
      cssRelPaths: ["media/css/report.css"],
      title: `Audit: ${path.basename(document.uri.fsPath)}`,
      bodyHtml: '<div id="report"></div>',
      connectSrc: "'none'",
    });

    const messageDisposable = panel.webview.onDidReceiveMessage((msg: { type?: string; pointer?: string }) => {
      if (!msg || !msg.type) {
        return;
      }
      if (msg.type === "ready" || msg.type === "rerun") {
        this.postReport(document, cache);
      } else if (msg.type === "reveal" && typeof msg.pointer === "string") {
        void this.reveal(document, cache, msg.pointer);
      }
    });

    const changeDisposable = cache.onDidChange((uri) => {
      if (uri.toString() === key) {
        this.postReport(document, cache);
      }
    });

    panel.onDidDispose(() => {
      messageDisposable.dispose();
      changeDisposable.dispose();
      this.panels.delete(key);
    });

    this.panels.set(key, { panel, messageDisposable, changeDisposable });
    this.postReport(document, cache);
  }

  private postReport(document: vscode.TextDocument, cache: DocumentCache): void {
    const entry = this.panels.get(document.uri.toString());
    if (!entry) {
      return;
    }
    const { index } = cache.get(document);
    const report = runAudit(index, getConfig().auditRuleSeverity);
    void entry.panel.webview.postMessage({ type: "report", report });
  }

  private async reveal(document: vscode.TextDocument, cache: DocumentCache, pointer: string): Promise<void> {
    const editor = await vscode.window.showTextDocument(document, { preserveFocus: false, preview: false });
    const { index } = cache.get(document);
    const node = index.byPointer.get(pointer);
    if (!node) {
      return;
    }
    const range = rangeOfNode(editor.document, node);
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
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

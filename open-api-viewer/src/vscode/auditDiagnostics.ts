import * as vscode from "vscode";
import { SpecIndex } from "../core/types";
import { AuditFinding, AuditSeverity } from "../core/audit/types";
import { runAudit } from "../core/audit/engine";
import { isOpenApiDocument } from "./detector";
import { DocumentCache } from "./documentCache";
import { getConfig } from "./config";
import { rangeOfNode } from "./rangeUtils";

export interface AuditDiagnosticsController extends vscode.Disposable {
  /** Always callable directly regardless of the 'audit.runOn' setting — the manual command always works. */
  refresh(document: vscode.TextDocument): void;
}

const SEVERITY_MAP: Record<AuditSeverity, vscode.DiagnosticSeverity> = {
  critical: vscode.DiagnosticSeverity.Warning,
  high: vscode.DiagnosticSeverity.Warning,
  medium: vscode.DiagnosticSeverity.Information,
  low: vscode.DiagnosticSeverity.Hint,
};

/**
 * Owns one `vscode.DiagnosticCollection` ('openapi-audit') for the 25 audit
 * rules (SEC0xx/DV0xx/QF0xx). Mirrors diagnostics.ts's controller shape.
 * `refresh` is always safe to call directly (the `openapiViewer.runAudit`
 * command does exactly that); whether it *also* runs automatically on
 * save/type is governed by `getConfig().auditRunOn` via the listeners
 * wired up below.
 */
export function createAuditDiagnosticsController(
  context: vscode.ExtensionContext,
  cache: DocumentCache
): AuditDiagnosticsController {
  const collection = vscode.languages.createDiagnosticCollection("openapi-audit");

  function refresh(document: vscode.TextDocument): void {
    if (!isOpenApiDocument(document)) {
      collection.delete(document.uri);
      return;
    }

    const { index } = cache.get(document);
    const report = runAudit(index, getConfig().auditRuleSeverity);

    const diagnostics: vscode.Diagnostic[] = [];
    for (const ruleResult of report.ruleResults) {
      for (const finding of ruleResult.findings) {
        diagnostics.push(toDiagnostic(document, index, finding, ruleResult.rule.severity));
      }
    }

    collection.set(document.uri, diagnostics);
  }

  function refreshIfOpen(uri: vscode.Uri): void {
    const document = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
    if (document) {
      refresh(document);
    }
  }

  // The automatic triggers depend on 'audit.runOn' (re-read live, since we
  // have no onDidChangeConfiguration listener to invalidate a cached
  // value); the manual command (registered in extension.ts) always calls
  // refresh() directly regardless of this setting.
  const changeSub = cache.onDidChange((uri) => {
    if (getConfig().auditRunOn === "type") {
      refreshIfOpen(uri);
    }
  });
  const saveSub = vscode.workspace.onDidSaveTextDocument((document) => {
    const runOn = getConfig().auditRunOn;
    if (runOn === "save" || runOn === "type") {
      refresh(document);
    }
  });
  const closeSub = vscode.workspace.onDidCloseTextDocument((document) => {
    collection.delete(document.uri);
  });

  context.subscriptions.push(changeSub, saveSub, closeSub, collection);

  return {
    refresh,
    dispose(): void {
      changeSub.dispose();
      saveSub.dispose();
      closeSub.dispose();
      collection.dispose();
    },
  };
}

function toDiagnostic(
  document: vscode.TextDocument,
  index: SpecIndex,
  finding: AuditFinding,
  severity: AuditSeverity
): vscode.Diagnostic {
  const node = index.byPointer.get(finding.pointer);
  const range = node ? rangeOfNode(document, node) : fallbackRange(document);
  const diagnostic = new vscode.Diagnostic(range, finding.message, SEVERITY_MAP[severity]);
  diagnostic.source = "openapi-audit";
  diagnostic.code = finding.ruleId;
  return diagnostic;
}

/** Some schemaWalker-derived pointers may not exist in index.byPointer; fall back rather than crash. */
function fallbackRange(document: vscode.TextDocument): vscode.Range {
  const end = Math.min(1, document.getText().length);
  return new vscode.Range(document.positionAt(0), document.positionAt(end));
}

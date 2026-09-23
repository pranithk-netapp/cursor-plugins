import * as vscode from "vscode";
import { Issue, ParseIssue } from "../core/types";
import { validateAgainstSchema } from "../core/validation/schemaValidator";
import { validateSemantics } from "../core/validation/semantic";
import { isOpenApiDocument } from "./detector";
import { DocumentCache } from "./documentCache";
import { getConfig } from "./config";

export interface DiagnosticsController extends vscode.Disposable {
  refresh(document: vscode.TextDocument): void;
}

const SEVERITY_MAP: Record<Issue["severity"], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
};

/**
 * Owns one `vscode.DiagnosticCollection` ('openapi') for parse errors,
 * reduced-schema validation and the OAV1xx semantic rules. The caller
 * (extension.ts) owns the controller's lifecycle and decides when to call
 * `refresh` (on open, on cache.onDidChange, at activation for already-open
 * documents); this module holds no module-level singleton.
 */
export function createDiagnosticsController(
  context: vscode.ExtensionContext,
  cache: DocumentCache
): DiagnosticsController {
  const collection = vscode.languages.createDiagnosticCollection("openapi");

  function refresh(document: vscode.TextDocument): void {
    if (!isOpenApiDocument(document)) {
      collection.delete(document.uri);
      return;
    }

    if (!getConfig().validationEnabled) {
      collection.delete(document.uri);
      return;
    }

    const { parseResult, index } = cache.get(document);
    const diagnostics: vscode.Diagnostic[] = [];

    for (const parseIssue of parseResult.errors) {
      diagnostics.push(toDiagnosticFromParseIssue(document, parseIssue));
    }

    for (const issue of validateAgainstSchema(parseResult, index)) {
      diagnostics.push(toDiagnostic(document, issue));
    }

    const missingDescriptionSeverity = getConfig().missingDescriptions;
    for (const issue of validateSemantics(parseResult, index, { missingDescriptionSeverity })) {
      diagnostics.push(toDiagnostic(document, issue));
    }

    collection.set(document.uri, diagnostics);
  }

  const openSub = vscode.workspace.onDidOpenTextDocument((document) => refresh(document));
  const changeSub = cache.onDidChange((uri) => {
    const document = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
    if (document) {
      refresh(document);
    }
  });
  const closeSub = vscode.workspace.onDidCloseTextDocument((document) => {
    collection.delete(document.uri);
  });

  context.subscriptions.push(openSub, changeSub, closeSub, collection);

  return {
    refresh,
    dispose(): void {
      openSub.dispose();
      changeSub.dispose();
      closeSub.dispose();
      collection.dispose();
    },
  };
}

function toDiagnostic(document: vscode.TextDocument, issue: Issue): vscode.Diagnostic {
  const range = new vscode.Range(
    document.positionAt(issue.offset),
    document.positionAt(issue.offset + issue.length)
  );
  const diagnostic = new vscode.Diagnostic(range, issue.message, SEVERITY_MAP[issue.severity]);
  diagnostic.source = issue.source;
  diagnostic.code = issue.code;
  return diagnostic;
}

function toDiagnosticFromParseIssue(document: vscode.TextDocument, parseIssue: ParseIssue): vscode.Diagnostic {
  const range = new vscode.Range(
    document.positionAt(parseIssue.offset),
    document.positionAt(parseIssue.offset + parseIssue.length)
  );
  const severity =
    parseIssue.severity === "warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
  const diagnostic = new vscode.Diagnostic(range, parseIssue.message, severity);
  diagnostic.source = "openapi";
  diagnostic.code = "openapi-parse";
  return diagnostic;
}

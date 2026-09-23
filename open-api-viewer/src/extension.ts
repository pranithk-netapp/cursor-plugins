import * as vscode from "vscode";
import { detectOpenApi } from "./core/detect";
import { buildIndex } from "./core/specIndex";
import { parseSpec } from "./core/parse";
import { validateAgainstSchema } from "./core/validation/schemaValidator";
import { validateSemantics } from "./core/validation/semantic";
import { summarizeSchemaNode } from "./core/summary";
import { computeRenameEdits } from "./core/rename";
import { computeInsertion, computeRemoval } from "./core/insert";
import { DocumentCache, registerDocumentListeners } from "./vscode/documentCache";
import { registerContextKeyUpdater } from "./vscode/detector";
import { createDiagnosticsController } from "./vscode/diagnostics";
import { OpenApiDocumentSymbolProvider } from "./vscode/symbols";
import { OpenApiDefinitionProvider } from "./vscode/definition";
import { OpenApiHoverProvider } from "./vscode/hover";
import { OpenApiReferenceProvider } from "./vscode/references";
import { OpenApiRenameProvider } from "./vscode/rename";
import { OpenApiOutlineProvider, registerOutlineCommands } from "./vscode/outlineProvider";
import { isOpenApiDocument } from "./vscode/detector";
import { PreviewPanelController, computeSpecPayload } from "./vscode/webview/previewPanel";
import { runAudit } from "./core/audit/engine";
import { scoreReport } from "./core/audit/scoring";
import { walkSchemas } from "./core/audit/schemaWalker";
import { createAuditDiagnosticsController } from "./vscode/auditDiagnostics";
import { ReportPanelController } from "./vscode/webview/reportPanel";
import { registerEditCommands } from "./vscode/commands";
import { OpenApiRefCompletionProvider } from "./vscode/completion";
import { OpenApiCodeActionProvider } from "./vscode/codeActions";
import { generateExample } from "./core/examples";
import { OpenApiTryItCodeLensProvider } from "./vscode/codeLens";
import { TryItPanelController } from "./vscode/webview/tryItPanel";

const DOCUMENT_SELECTOR: vscode.DocumentSelector = [{ language: "json" }, { language: "jsonc" }, { language: "yaml" }];

export function activate(context: vscode.ExtensionContext): void {
  const showInfo = vscode.commands.registerCommand("openapiViewer.showInfo", () => {
    vscode.window.showInformationMessage("OpenAPI Viewer & Reviewer is active.");
  });
  context.subscriptions.push(showInfo);

  const outputChannel = vscode.window.createOutputChannel("OpenAPI Viewer");
  context.subscriptions.push(outputChannel);

  const cache = new DocumentCache();
  activeCache = cache;
  registerContextKeyUpdater(context);
  registerDocumentListeners(context, cache);

  const diagnostics = createDiagnosticsController(context, cache);
  for (const document of vscode.workspace.textDocuments) {
    diagnostics.refresh(document);
  }

  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(DOCUMENT_SELECTOR, new OpenApiDocumentSymbolProvider(cache)),
    vscode.languages.registerDefinitionProvider(DOCUMENT_SELECTOR, new OpenApiDefinitionProvider(cache)),
    vscode.languages.registerHoverProvider(DOCUMENT_SELECTOR, new OpenApiHoverProvider(cache)),
    vscode.languages.registerReferenceProvider(DOCUMENT_SELECTOR, new OpenApiReferenceProvider(cache)),
    vscode.languages.registerRenameProvider(DOCUMENT_SELECTOR, new OpenApiRenameProvider(cache))
  );

  const outlineProvider = new OpenApiOutlineProvider(cache);
  outlineProvider.attachListeners(context);
  context.subscriptions.push(vscode.window.registerTreeDataProvider("openapiViewer.outline", outlineProvider));
  registerOutlineCommands(context, outlineProvider, cache);

  const previewController = new PreviewPanelController();
  activePreviewController = previewController;
  context.subscriptions.push(previewController);
  context.subscriptions.push(
    vscode.commands.registerCommand("openapiViewer.preview", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isOpenApiDocument(editor.document)) {
        void vscode.window.showWarningMessage("Open an OpenAPI (JSON or YAML) document to preview it.");
        return;
      }
      previewController.showPreview(context, editor.document, cache);
    })
  );

  const auditDiagnostics = createAuditDiagnosticsController(context, cache);
  const reportController = new ReportPanelController();
  context.subscriptions.push(reportController);
  context.subscriptions.push(
    vscode.commands.registerCommand("openapiViewer.runAudit", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isOpenApiDocument(editor.document)) {
        void vscode.window.showWarningMessage("Open an OpenAPI (JSON or YAML) document to audit it.");
        return;
      }
      auditDiagnostics.refresh(editor.document);
      reportController.showReport(context, editor.document, cache);
    })
  );

  registerEditCommands(context, cache);
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      DOCUMENT_SELECTOR,
      new OpenApiRefCompletionProvider(cache),
      '"',
      "/",
      ":",
      " "
    ),
    vscode.languages.registerCodeActionsProvider(DOCUMENT_SELECTOR, new OpenApiCodeActionProvider(cache), {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    })
  );

  const tryItCodeLensProvider = new OpenApiTryItCodeLensProvider(cache);
  context.subscriptions.push(
    tryItCodeLensProvider,
    vscode.languages.registerCodeLensProvider(DOCUMENT_SELECTOR, tryItCodeLensProvider)
  );

  const tryItController = new TryItPanelController();
  context.subscriptions.push(tryItController);
  context.subscriptions.push(
    vscode.commands.registerCommand("openapiViewer.tryOperation", async (uri: vscode.Uri, operationPointer: string) => {
      const document = await vscode.workspace.openTextDocument(uri);
      tryItController.showTryIt(context, document, cache, operationPointer, context.secrets, outputChannel);
    })
  );
}

export function deactivate(): void {}

// Re-export pure src/core logic so integration tests (and later phases) can
// reach it through the compiled extension module, following the sibling
// extension's __test convention.
export const __test = {
  detectOpenApi,
  buildIndex,
  parseSpec,
  validateAgainstSchema,
  validateSemantics,
  summarizeSchemaNode,
  computeRenameEdits,
  runAudit,
  scoreReport,
  walkSchemas,
  computeInsertion,
  computeRemoval,
  generateExample,
  isOpenApiDocument,
  computeSpecPayload,
  // Set inside activate() below so integration tests can look up the live
  // PreviewPanelController the same way clicking the toolbar icon would use
  // it (there is no other way to reach a running panel: webviews render in
  // an isolated iframe with no DOM query surface for a test), and the same
  // DocumentCache the real preview command reads from (so a payload
  // assertion exercises the actual running pipeline, not a fresh stand-in).
  getPreviewController: (): PreviewPanelController | undefined => activePreviewController,
  getCache: (): DocumentCache | undefined => activeCache,
};

let activePreviewController: PreviewPanelController | undefined;
let activeCache: DocumentCache | undefined;

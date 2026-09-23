// Quick fixes matching diagnostic codes produced by diagnostics.ts
// ('openapi', OAV1xx) and auditDiagnostics.ts ('openapi-audit', SEC0xx /
// DV00x). Each fix is built from the exact AstNode the diagnostic's range
// points at (found via findNodeOrKeyAtOffset, the same lookup
// diagnostics/audit code uses to compute that range in the first place),
// so the fix always targets precisely what the diagnostic flagged rather
// than re-deriving it from message text.

import * as vscode from "vscode";
import { AstNode, SpecIndex } from "../core/types";
import { findNodeOrKeyAtOffset } from "../core/ast";
import { pointerToSegments, refToPointer } from "../core/pointer";
import { computeInsertion, computeRemoval, InsertError, TextInsertion } from "../core/insert";
import { isOpenApiDocument } from "./detector";
import { DocumentCache } from "./documentCache";
import { detectIndent, insertionsToWorkspaceEdit } from "./editUtils";

const HANDLED_CODES = new Set(["OAV101", "SEC006", "SEC007", "DV001", "DV005", "OAV103"]);

export class OpenApiCodeActionProvider implements vscode.CodeActionProvider {
  constructor(private readonly cache: DocumentCache) {}

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    if (!isOpenApiDocument(document)) {
      return [];
    }

    const relevant = context.diagnostics.filter(
      (d) => (d.source === "openapi" || d.source === "openapi-audit") && typeof d.code === "string" && HANDLED_CODES.has(d.code)
    );
    if (relevant.length === 0) {
      return [];
    }

    const { parseResult, index } = this.cache.get(document);
    const lang: "json" | "yaml" = document.languageId === "yaml" ? "yaml" : "json";
    const { indentUnit, eol } = detectIndent(document);

    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of relevant) {
      const node = findNodeOrKeyAtOffset(index.root, document.offsetAt(diagnostic.range.start))?.node;
      if (!node) {
        continue;
      }
      try {
        const action = buildAction(diagnostic, node, index, document, parseResult.root, lang, indentUnit, eol);
        if (action) {
          actions.push(action);
        }
      } catch (error) {
        if (!(error instanceof InsertError)) {
          throw error;
        }
        // Flow-style YAML target: no fix offered for this diagnostic.
      }
    }
    return actions;
  }
}

function buildAction(
  diagnostic: vscode.Diagnostic,
  node: AstNode,
  index: SpecIndex,
  document: vscode.TextDocument,
  ast: AstNode | undefined,
  lang: "json" | "yaml",
  indentUnit: string,
  eol: string
): vscode.CodeAction | undefined {
  const code = diagnostic.code as string;
  switch (code) {
    case "OAV101":
      return buildCreateComponentAction(diagnostic, node, document, ast, lang, indentUnit, eol);
    case "SEC006":
      return buildAddSecurityResponseAction(diagnostic, node, index, document, ast, lang, indentUnit, eol, "401", "Unauthorized");
    case "SEC007":
      return buildAddSecurityResponseAction(diagnostic, node, index, document, ast, lang, indentUnit, eol, "403", "Forbidden");
    case "DV001":
      return buildAddSiblingKeyAction(diagnostic, node, document, ast, lang, indentUnit, eol, "maxLength", 255);
    case "DV005":
      return buildAddSiblingKeyAction(diagnostic, node, document, ast, lang, indentUnit, eol, "maxItems", 100);
    case "OAV103":
      return buildRemoveComponentAction(diagnostic, node, document, ast, lang, eol);
    default:
      return undefined;
  }
}

/** OAV101: unresolved `$ref` -> "Create component 'X'". `node` is the `$ref` value's own string AstNode. */
function buildCreateComponentAction(
  diagnostic: vscode.Diagnostic,
  node: AstNode,
  document: vscode.TextDocument,
  ast: AstNode | undefined,
  lang: "json" | "yaml",
  indentUnit: string,
  eol: string
): vscode.CodeAction | undefined {
  if (node.kind !== "string" || typeof node.value !== "string") {
    return undefined;
  }
  const pointer = refToPointer(node.value);
  if (pointer === null) {
    return undefined;
  }
  const segments = pointerToSegments(pointer);
  if (segments.length < 3 || segments[0] !== "components") {
    return undefined;
  }
  const componentType = segments[1];
  const name = segments[segments.length - 1];

  const value = stubForComponentType(componentType, name);
  const insertions = computeInsertion({
    text: document.getText(),
    lang,
    ast,
    parentPath: ["components", componentType],
    key: name,
    value,
    indentUnit,
    eol,
  });

  const action = new vscode.CodeAction(`Create component '${name}'`, vscode.CodeActionKind.QuickFix);
  action.diagnostics = [diagnostic];
  action.isPreferred = true;
  action.edit = insertionsToWorkspaceEdit(document, insertions);
  return action;
}

function stubForComponentType(componentType: string, name: string): unknown {
  switch (componentType) {
    case "schemas":
      return { type: "object", properties: {} };
    case "responses":
      return { description: name };
    case "parameters":
      return { name, in: "query", schema: { type: "string" } };
    default:
      return {};
  }
}

/** SEC006/SEC007: secured operation missing a 401/403 response -> "Add <code> response". `node` is the operation AstNode. */
function buildAddSecurityResponseAction(
  diagnostic: vscode.Diagnostic,
  node: AstNode,
  index: SpecIndex,
  document: vscode.TextDocument,
  ast: AstNode | undefined,
  lang: "json" | "yaml",
  indentUnit: string,
  eol: string,
  statusCode: "401" | "403",
  fallbackDescription: string
): vscode.CodeAction | undefined {
  const segments = pointerToSegments(node.pointer);
  if (segments.length < 3 || segments[0] !== "paths") {
    return undefined;
  }
  const path = segments[1];
  const method = segments[2];

  const standardErrorName = `StandardError-${statusCode}`;
  const hasStandardError = index.value?.components?.responses?.[standardErrorName] !== undefined;
  const value = hasStandardError ? { $ref: `#/components/responses/${standardErrorName}` } : { description: fallbackDescription };

  const insertions = computeInsertion({
    text: document.getText(),
    lang,
    ast,
    parentPath: ["paths", path, method, "responses"],
    key: statusCode,
    value,
    indentUnit,
    eol,
  });

  const action = new vscode.CodeAction(`Add ${statusCode} response`, vscode.CodeActionKind.QuickFix);
  action.diagnostics = [diagnostic];
  action.edit = insertionsToWorkspaceEdit(document, insertions);
  return action;
}

/** DV001/DV005: a schema missing maxLength/maxItems -> "Add <key>: <value>". `node` is the schema's own AstNode. */
function buildAddSiblingKeyAction(
  diagnostic: vscode.Diagnostic,
  node: AstNode,
  document: vscode.TextDocument,
  ast: AstNode | undefined,
  lang: "json" | "yaml",
  indentUnit: string,
  eol: string,
  key: "maxLength" | "maxItems",
  value: number
): vscode.CodeAction {
  const parentPath = pointerToSegments(node.pointer);
  const insertions = computeInsertion({
    text: document.getText(),
    lang,
    ast,
    parentPath,
    key,
    value,
    indentUnit,
    eol,
  });

  const action = new vscode.CodeAction(`Add ${key}: ${value}`, vscode.CodeActionKind.QuickFix);
  action.diagnostics = [diagnostic];
  action.edit = insertionsToWorkspaceEdit(document, insertions);
  return action;
}

/** OAV103: unused component -> "Remove unused component 'X'". `node` is the component's own entry AstNode. */
function buildRemoveComponentAction(
  diagnostic: vscode.Diagnostic,
  node: AstNode,
  document: vscode.TextDocument,
  ast: AstNode | undefined,
  lang: "json" | "yaml",
  eol: string
): vscode.CodeAction | undefined {
  const path = pointerToSegments(node.pointer);
  if (path.length === 0) {
    return undefined;
  }
  const name = path[path.length - 1];

  const insertions: TextInsertion[] = computeRemoval({
    text: document.getText(),
    lang,
    ast,
    path,
    eol,
  });

  const action = new vscode.CodeAction(`Remove unused component '${name}'`, vscode.CodeActionKind.QuickFix);
  action.diagnostics = [diagnostic];
  action.edit = insertionsToWorkspaceEdit(document, insertions);
  return action;
}

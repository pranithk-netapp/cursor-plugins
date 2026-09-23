// Edit-helper commands: Add Path, Add Operation, Add Schema, Add Response,
// and Copy JSON Pointer. Each insert command computes a pure TextInsertion[]
// via core/insert.ts, applies it as a vscode.WorkspaceEdit, then reveals the
// newly-inserted node by re-reading the (now re-parsed, since the document
// version changed) cache and reusing the outline's own reveal command.

import * as vscode from "vscode";
import { computeInsertion, InsertError } from "../core/insert";
import { findNodeOrKeyAtOffset } from "../core/ast";
import { joinPointer } from "../core/pointer";
import { isOpenApiDocument } from "./detector";
import { DocumentCache } from "./documentCache";
import { detectIndent, insertionsToWorkspaceEdit } from "./editUtils";

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

/** Minimal shape of the outline's OutlineNode, as passed by a view/item/context menu invocation. */
interface OutlineNodeLike {
  pointer?: string;
  contextValue?: string;
}

export function registerEditCommands(context: vscode.ExtensionContext, cache: DocumentCache): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("openapiViewer.addPath", () => addPath(cache)),
    vscode.commands.registerCommand("openapiViewer.addOperation", (arg?: OutlineNodeLike) => addOperation(cache, arg)),
    vscode.commands.registerCommand("openapiViewer.addSchema", () => addSchema(cache)),
    vscode.commands.registerCommand("openapiViewer.addResponse", (arg?: OutlineNodeLike) => addResponse(cache, arg)),
    vscode.commands.registerCommand("openapiViewer.copyJsonPointer", () => copyJsonPointer(cache))
  );
}

/** The active editor's document, if it's an OpenAPI document; otherwise warns and returns undefined. */
function activeOpenApiDocument(): vscode.TextDocument | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isOpenApiDocument(editor.document)) {
    void vscode.window.showWarningMessage("Open an OpenAPI (JSON or YAML) document first.");
    return undefined;
  }
  return editor.document;
}

async function insertAndReveal(
  document: vscode.TextDocument,
  cache: DocumentCache,
  parentPath: (string | number)[],
  key: string | number,
  value: unknown,
  revealPointer: string
): Promise<void> {
  const { parseResult } = cache.get(document);
  const lang: "json" | "yaml" = document.languageId === "yaml" ? "yaml" : "json";
  const { indentUnit, eol } = detectIndent(document);

  let insertions;
  try {
    insertions = computeInsertion({
      text: document.getText(),
      lang,
      ast: parseResult.root,
      parentPath,
      key,
      value,
      indentUnit,
      eol,
    });
  } catch (error) {
    if (error instanceof InsertError) {
      void vscode.window.showErrorMessage(error.message);
      return;
    }
    throw error;
  }

  const edit = insertionsToWorkspaceEdit(document, insertions);
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    return;
  }
  // The document's version has changed, so cache.get() inside the reveal
  // command below will re-parse before looking up `revealPointer`.
  await vscode.commands.executeCommand("openapiViewer.revealRange", document.uri, revealPointer);
}

async function addPath(cache: DocumentCache): Promise<void> {
  const document = activeOpenApiDocument();
  if (!document) {
    return;
  }
  const { index } = cache.get(document);

  const pathInput = await vscode.window.showInputBox({
    prompt: "New path template (must start with '/')",
    placeHolder: "/v1/things/{id}",
    validateInput: (value) => {
      if (!value.startsWith("/")) {
        return "Path must start with '/'";
      }
      if (index.value?.paths && Object.prototype.hasOwnProperty.call(index.value.paths, value)) {
        return `Path '${value}' already exists`;
      }
      return undefined;
    },
  });
  if (!pathInput) {
    return;
  }

  const operationId = await vscode.window.showInputBox({
    prompt: `operationId for the initial GET operation on '${pathInput}'`,
    validateInput: (value) => (value.trim().length === 0 ? "operationId is required" : undefined),
  });
  if (!operationId) {
    return;
  }
  if (!(await confirmDuplicateOperationId(index, operationId))) {
    return;
  }

  const value = { get: { operationId, responses: { "200": { description: "OK" } } } };
  await insertAndReveal(document, cache, ["paths"], pathInput, value, joinPointer("/paths", pathInput, "get"));
}

async function addOperation(cache: DocumentCache, arg?: OutlineNodeLike): Promise<void> {
  const document = activeOpenApiDocument();
  if (!document) {
    return;
  }
  const { index } = cache.get(document);

  const path = await resolvePathArgument(index, arg);
  if (!path) {
    return;
  }

  const pathValue = index.value?.paths?.[path] ?? {};
  const existingMethods = new Set(HTTP_METHODS.filter((m) => m in pathValue));
  const availableMethods = HTTP_METHODS.filter((m) => !existingMethods.has(m));
  if (availableMethods.length === 0) {
    void vscode.window.showWarningMessage(`'${path}' already has every HTTP method defined.`);
    return;
  }

  const method = await vscode.window.showQuickPick(
    availableMethods.map((m) => m.toUpperCase()),
    { placeHolder: `HTTP method for ${path}` }
  );
  if (!method) {
    return;
  }
  const methodLower = method.toLowerCase();

  const suggestedId = suggestOperationId(methodLower, path);
  const operationId = await vscode.window.showInputBox({
    prompt: `operationId for ${method} ${path}`,
    value: suggestedId,
    validateInput: (v) => (v.trim().length === 0 ? "operationId is required" : undefined),
  });
  if (!operationId) {
    return;
  }
  if (!(await confirmDuplicateOperationId(index, operationId))) {
    return;
  }

  const templateParamNames = extractPathTemplateParams(path);
  const parameters = templateParamNames.map((name) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
  }));

  const value: Record<string, unknown> = { operationId, summary: "" };
  if (parameters.length > 0) {
    value.parameters = parameters;
  }
  value.responses = { "200": { description: "Successful response" } };

  await insertAndReveal(document, cache, ["paths", path], methodLower, value, joinPointer("/paths", path, methodLower));
}

async function addSchema(cache: DocumentCache): Promise<void> {
  const document = activeOpenApiDocument();
  if (!document) {
    return;
  }
  const { index } = cache.get(document);

  const name = await vscode.window.showInputBox({
    prompt: "New component schema name",
    placeHolder: "MyNewSchema",
    validateInput: (value) => (/^[A-Za-z0-9._-]+$/.test(value) ? undefined : "Only letters, digits, '.', '_' and '-' are allowed"),
  });
  if (!name) {
    return;
  }
  if (index.components.has(`schemas/${name}`)) {
    const proceed = await vscode.window.showWarningMessage(
      `A schema named '${name}' already exists. Overwrite it?`,
      { modal: true },
      "Overwrite"
    );
    if (proceed !== "Overwrite") {
      return;
    }
  }

  const value = { type: "object", properties: {}, required: [] };
  await insertAndReveal(document, cache, ["components", "schemas"], name, value, joinPointer("/components/schemas", name));
}

async function addResponse(cache: DocumentCache, arg?: OutlineNodeLike): Promise<void> {
  const document = activeOpenApiDocument();
  if (!document) {
    return;
  }
  const { index } = cache.get(document);

  const target = await resolveOperationArgument(index, arg);
  if (!target) {
    return;
  }
  const { path, method } = target;

  const statusCode = await vscode.window.showInputBox({
    prompt: `Status code for the new response on ${method.toUpperCase()} ${path}`,
    placeHolder: "404, or 'default'",
    validateInput: (value) => (/^([1-5]\d\d|default)$/.test(value) ? undefined : "Must be a 3-digit status code or 'default'"),
  });
  if (!statusCode) {
    return;
  }

  const description = await vscode.window.showInputBox({
    prompt: `Description for the '${statusCode}' response`,
    value: defaultDescriptionForStatus(statusCode),
  });
  if (description === undefined) {
    return;
  }

  await insertAndReveal(
    document,
    cache,
    ["paths", path, method, "responses"],
    statusCode,
    { description },
    joinPointer("/paths", path, method, "responses", statusCode)
  );
}

async function copyJsonPointer(cache: DocumentCache): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isOpenApiDocument(editor.document)) {
    void vscode.window.showWarningMessage("Open an OpenAPI (JSON or YAML) document first.");
    return;
  }
  const { index } = cache.get(editor.document);
  const offset = editor.document.offsetAt(editor.selection.active);
  const found = findNodeOrKeyAtOffset(index.root, offset);
  if (!found) {
    return;
  }
  const pointer = "#" + found.node.pointer;
  await vscode.env.clipboard.writeText(pointer);
  vscode.window.setStatusBarMessage(`Copied: ${pointer}`, 3000);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

async function confirmDuplicateOperationId(index: { operations: { operationId?: string }[] }, operationId: string): Promise<boolean> {
  const duplicate = index.operations.some((op) => op.operationId === operationId);
  if (!duplicate) {
    return true;
  }
  const proceed = await vscode.window.showWarningMessage(
    `operationId '${operationId}' is already used by another operation. Continue anyway?`,
    { modal: true },
    "Continue"
  );
  return proceed === "Continue";
}

async function resolvePathArgument(index: { value: any }, arg?: OutlineNodeLike): Promise<string | undefined> {
  if (arg && arg.pointer && arg.pointer.startsWith("/paths/")) {
    const segments = arg.pointer.split("/").slice(2);
    // Path pointers are exactly /paths/<encoded path>; decode the single
    // segment ourselves (the RFC 6901 escapes are the only encoding used).
    const decoded = segments.join("/").replace(/~1/g, "/").replace(/~0/g, "~");
    if (decoded) {
      return decoded;
    }
  }
  const paths = Object.keys(index.value?.paths ?? {});
  if (paths.length === 0) {
    void vscode.window.showWarningMessage("This document has no paths yet. Use 'Add Path' first.");
    return undefined;
  }
  return vscode.window.showQuickPick(paths, { placeHolder: "Path to add an operation to" });
}

async function resolveOperationArgument(
  index: { operations: { path: string; method: string; operationId?: string }[] },
  arg?: OutlineNodeLike
): Promise<{ path: string; method: string } | undefined> {
  if (arg && arg.pointer) {
    const match = /^\/paths\/([^/]+)\/([a-z]+)$/.exec(arg.pointer);
    if (match) {
      const path = match[1].replace(/~1/g, "/").replace(/~0/g, "~");
      return { path, method: match[2] };
    }
  }
  if (index.operations.length === 0) {
    void vscode.window.showWarningMessage("This document has no operations yet.");
    return undefined;
  }
  const items = index.operations.map((op) => ({
    label: `${op.method.toUpperCase()} ${op.path}`,
    description: op.operationId,
    op,
  }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: "Operation to add a response to" });
  return picked ? { path: picked.op.path, method: picked.op.method } : undefined;
}

function extractPathTemplateParams(path: string): string[] {
  const names: string[] = [];
  const re = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(path))) {
    names.push(match[1]);
  }
  return names;
}

function suggestOperationId(method: string, path: string): string {
  const segments = path.split("/").filter((s) => s.length > 0 && !s.startsWith("{"));
  const last = segments[segments.length - 1] ?? "resource";
  const capitalized = last.charAt(0).toUpperCase() + last.slice(1);
  return method + capitalized;
}

function defaultDescriptionForStatus(statusCode: string): string {
  const known: Record<string, string> = {
    "200": "OK",
    "201": "Created",
    "204": "No Content",
    "400": "Bad Request",
    "401": "Unauthorized",
    "403": "Forbidden",
    "404": "Not Found",
    "409": "Conflict",
    "500": "Internal Server Error",
    default: "Unexpected error",
  };
  return known[statusCode] ?? "Response";
}

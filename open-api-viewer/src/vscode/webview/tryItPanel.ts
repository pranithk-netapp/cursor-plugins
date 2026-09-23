// "Try it" webview panel: one panel per (document, operation) pair, keyed by
// `${document.uri}::${operationPointer}`. Builds a plain-data view model of
// the operation (parameters, request body example, servers, security
// schemes) for the webview to render, injects auth from SecretStorage only
// at send time (never sent to the webview), and sends the actual HTTP
// request from the extension host via vscode/http.ts.

import * as vscode from "vscode";
import { DocumentCache } from "../documentCache";
import { SpecIndex, OperationInfo } from "../../core/types";
import { derefValue } from "../../core/resolve";
import { generateExample } from "../../core/examples";
import { getConfig } from "../config";
import { sendRequest, HttpRequestSpec, HttpResult } from "../http";
import { buildWebviewHtml } from "./html";

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

export interface ParamViewModel {
  name: string;
  in: string;
  required: boolean;
  description?: string;
  defaultValue: string;
}

export interface RequestBodyViewModel {
  required: boolean;
  contentTypes: string[];
  selectedContentType: string;
  examplesByContentType: Record<string, string>;
}

export interface ServerVariableViewModel {
  name: string;
  default: string;
  enum?: string[];
}

export interface ServerViewModel {
  template: string;
  resolvedUrl: string;
  variables: ServerVariableViewModel[];
}

export interface SecuritySchemeViewModel {
  name: string;
  type: string;
  in?: string;
  paramName?: string;
  scheme?: string;
  description?: string;
}

export interface OperationViewModel {
  method: string;
  path: string;
  pointer: string;
  operationId?: string;
  summary?: string;
  description?: string;
  pathParams: ParamViewModel[];
  queryParams: ParamViewModel[];
  headerParams: ParamViewModel[];
  cookieParams: ParamViewModel[];
  requestBody?: RequestBodyViewModel;
  servers: ServerViewModel[];
  defaultServerUrl: string;
  securitySchemes: SecuritySchemeViewModel[];
}

function stringifyExampleValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function buildParam(index: SpecIndex, rawParam: any): ParamViewModel | undefined {
  const param = derefValue(index, rawParam);
  if (!param || typeof param !== "object" || typeof param.name !== "string" || typeof param.in !== "string") {
    return undefined;
  }
  const schema = param.schema !== undefined ? derefValue(index, param.schema) : undefined;
  const example =
    param.example !== undefined
      ? param.example
      : schema !== undefined
        ? generateExample(index, schema, { mode: "request" })
        : "";
  return {
    name: param.name,
    in: param.in,
    required: param.required === true || param.in === "path",
    description: typeof param.description === "string" ? param.description : undefined,
    defaultValue: stringifyExampleValue(example),
  };
}

function mergeParameters(index: SpecIndex, pathItemParams: any[], operationParams: any[]): any[] {
  // Operation-level parameters override a path-item-level parameter with the
  // same (name, in) pair, per OAS 3.0/3.1 semantics.
  const byKey = new Map<string, any>();
  for (const p of pathItemParams) {
    const resolved = derefValue(index, p);
    if (resolved && typeof resolved.name === "string" && typeof resolved.in === "string") {
      byKey.set(`${resolved.in}:${resolved.name}`, p);
    }
  }
  for (const p of operationParams) {
    const resolved = derefValue(index, p);
    if (resolved && typeof resolved.name === "string" && typeof resolved.in === "string") {
      byKey.set(`${resolved.in}:${resolved.name}`, p);
    }
  }
  return Array.from(byKey.values());
}

function exampleForMediaType(index: SpecIndex, mediaType: any): unknown {
  if (mediaType.example !== undefined) {
    return mediaType.example;
  }
  if (mediaType.examples && typeof mediaType.examples === "object") {
    const firstKey = Object.keys(mediaType.examples)[0];
    if (firstKey !== undefined) {
      const entry = mediaType.examples[firstKey];
      return entry && typeof entry === "object" && "value" in entry ? entry.value : entry;
    }
  }
  if (mediaType.schema !== undefined) {
    return generateExample(index, mediaType.schema, { mode: "request" });
  }
  return undefined;
}

function buildRequestBody(index: SpecIndex, rawRequestBody: any): RequestBodyViewModel | undefined {
  const requestBody = derefValue(index, rawRequestBody);
  if (!requestBody || !requestBody.content || typeof requestBody.content !== "object") {
    return undefined;
  }
  const contentTypes = Object.keys(requestBody.content);
  if (contentTypes.length === 0) {
    return undefined;
  }
  const selected = contentTypes.includes("application/json") ? "application/json" : contentTypes[0];
  const examplesByContentType: Record<string, string> = {};
  for (const contentType of contentTypes) {
    const example = exampleForMediaType(index, requestBody.content[contentType] ?? {});
    examplesByContentType[contentType] = example === undefined ? "" : JSON.stringify(example, null, 2);
  }
  return {
    required: requestBody.required === true,
    contentTypes,
    selectedContentType: selected,
    examplesByContentType,
  };
}

function substituteServerVariables(server: any): ServerViewModel {
  const template: string = typeof server?.url === "string" ? server.url : "";
  const variables: ServerVariableViewModel[] = [];
  let resolved = template;
  if (server?.variables && typeof server.variables === "object") {
    for (const [name, def] of Object.entries<any>(server.variables)) {
      const defaultValue = typeof def?.default === "string" ? def.default : "";
      variables.push({ name, default: defaultValue, enum: Array.isArray(def?.enum) ? def.enum : undefined });
      resolved = resolved.split(`{${name}}`).join(defaultValue);
    }
  }
  return { template, resolvedUrl: resolved, variables };
}

function effectiveSecuritySchemeNames(index: SpecIndex, opValue: any): string[] {
  const security: any[] = Array.isArray(opValue?.security) ? opValue.security : Array.isArray(index.value?.security) ? index.value.security : [];
  const names = new Set<string>();
  for (const requirement of security) {
    if (requirement && typeof requirement === "object") {
      for (const name of Object.keys(requirement)) {
        names.add(name);
      }
    }
  }
  return Array.from(names);
}

function buildSecuritySchemes(index: SpecIndex, opValue: any): SecuritySchemeViewModel[] {
  const names = effectiveSecuritySchemeNames(index, opValue);
  const definitions = index.value?.components?.securitySchemes ?? {};
  const result: SecuritySchemeViewModel[] = [];
  for (const name of names) {
    const scheme = derefValue(index, definitions[name]);
    if (!scheme || typeof scheme !== "object") {
      continue;
    }
    result.push({
      name,
      type: scheme.type,
      in: scheme.in,
      paramName: scheme.name,
      scheme: scheme.scheme,
      description: typeof scheme.description === "string" ? scheme.description : undefined,
    });
  }
  return result;
}

export function buildOperationViewModel(index: SpecIndex, op: OperationInfo): OperationViewModel {
  const pathItemValue = index.value?.paths?.[op.path] ?? {};
  const opValue = pathItemValue[op.method] ?? {};

  const mergedParams = mergeParameters(
    index,
    Array.isArray(pathItemValue.parameters) ? pathItemValue.parameters : [],
    Array.isArray(opValue.parameters) ? opValue.parameters : []
  );

  const pathParams: ParamViewModel[] = [];
  const queryParams: ParamViewModel[] = [];
  const headerParams: ParamViewModel[] = [];
  const cookieParams: ParamViewModel[] = [];
  for (const raw of mergedParams) {
    const vm = buildParam(index, raw);
    if (!vm) {
      continue;
    }
    if (vm.in === "path") {
      pathParams.push(vm);
    } else if (vm.in === "query") {
      queryParams.push(vm);
    } else if (vm.in === "header") {
      headerParams.push(vm);
    } else if (vm.in === "cookie") {
      cookieParams.push(vm);
    }
  }

  const requestBody = opValue.requestBody !== undefined ? buildRequestBody(index, opValue.requestBody) : undefined;

  const rawServers: any[] = Array.isArray(opValue.servers)
    ? opValue.servers
    : Array.isArray(pathItemValue.servers)
      ? pathItemValue.servers
      : Array.isArray(index.value?.servers)
        ? index.value.servers
        : [];
  const servers = rawServers.map(substituteServerVariables);

  const configuredDefault = getConfig().tryItDefaultServerUrl;
  const defaultServerUrl = configuredDefault && configuredDefault.length > 0 ? configuredDefault : servers[0]?.resolvedUrl ?? "";

  return {
    method: op.method,
    path: op.path,
    pointer: op.pointer,
    operationId: typeof opValue.operationId === "string" ? opValue.operationId : undefined,
    summary: typeof opValue.summary === "string" ? opValue.summary : undefined,
    description: typeof opValue.description === "string" ? opValue.description : undefined,
    pathParams,
    queryParams,
    headerParams,
    cookieParams,
    requestBody,
    servers,
    defaultServerUrl,
    securitySchemes: buildSecuritySchemes(index, opValue),
  };
}

// ---------------------------------------------------------------------------
// Secret storage keying
// ---------------------------------------------------------------------------

export function secretKeyFor(schemeName: string, serverOrigin: string): string {
  return `openapiViewer.secret:${schemeName}:${serverOrigin}`;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Message protocol payloads
// ---------------------------------------------------------------------------

interface SendRequestPayload {
  server: string;
  path: string;
  pathParams: Record<string, string>;
  queryParams: Record<string, string>;
  headerParams: Record<string, string>;
  body?: string;
  contentType?: string;
}

interface PanelEntry {
  panel: vscode.WebviewPanel;
  messageDisposable: vscode.Disposable;
  operation: OperationViewModel;
  secrets: vscode.SecretStorage;
  outputChannel: vscode.OutputChannel;
  abortController?: AbortController;
}

export class TryItPanelController implements vscode.Disposable {
  private readonly panels = new Map<string, PanelEntry>();

  showTryIt(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    cache: DocumentCache,
    operationPointer: string,
    secrets: vscode.SecretStorage,
    outputChannel: vscode.OutputChannel
  ): void {
    const key = `${document.uri.toString()}::${operationPointer}`;
    const existing = this.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const { index } = cache.get(document);
    const op = index.operations.find((o) => o.pointer === operationPointer);
    if (!op) {
      void vscode.window.showWarningMessage("This operation could not be found (the document may have changed).");
      return;
    }

    const operation = buildOperationViewModel(index, op);
    const title = `Try it: ${op.method.toUpperCase()} ${op.path}`;

    const panel = vscode.window.createWebviewPanel("openapiViewer.tryit", title, vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    });

    panel.webview.html = buildWebviewHtml({
      webview: panel.webview,
      extensionUri: context.extensionUri,
      scriptRelPath: "media/dist/tryit.js",
      cssRelPaths: ["media/css/tryit.css"],
      title,
      bodyHtml: '<div id="app"></div>',
      connectSrc: "'none'",
    });

    const messageDisposable = panel.webview.onDidReceiveMessage((msg: any) => {
      void this.handleMessage(key, msg);
    });

    panel.onDidDispose(() => {
      messageDisposable.dispose();
      this.panels.delete(key);
    });

    this.panels.set(key, { panel, messageDisposable, operation, secrets, outputChannel });
  }

  private async handleMessage(key: string, msg: any): Promise<void> {
    const entry = this.panels.get(key);
    if (!entry || !msg || typeof msg.type !== "string") {
      return;
    }

    if (msg.type === "ready") {
      const secretStatus = await this.computeSecretStatus(entry);
      void entry.panel.webview.postMessage({ type: "init", operation: entry.operation, secretStatus });
      return;
    }

    if (msg.type === "setSecret" && typeof msg.schemeName === "string") {
      const value = await vscode.window.showInputBox({
        password: true,
        prompt: `Enter value for ${msg.schemeName}`,
        ignoreFocusOut: true,
      });
      if (value !== undefined && value.length > 0) {
        const origin = typeof msg.serverOrigin === "string" && msg.serverOrigin.length > 0 ? msg.serverOrigin : originOf(entry.operation.defaultServerUrl);
        await entry.secrets.store(secretKeyFor(msg.schemeName, origin), value);
      }
      const secretStatus = await this.computeSecretStatus(entry, msg.serverOrigin);
      void entry.panel.webview.postMessage({ type: "secretStatus", secretStatus });
      return;
    }

    if (msg.type === "send" && msg.request) {
      await this.handleSend(entry, msg.request as SendRequestPayload);
      return;
    }

    if (msg.type === "cancel") {
      entry.abortController?.abort();
      return;
    }
  }

  private async computeSecretStatus(entry: PanelEntry, serverOrigin?: string): Promise<Record<string, boolean>> {
    const origin = serverOrigin && serverOrigin.length > 0 ? serverOrigin : originOf(entry.operation.defaultServerUrl);
    const status: Record<string, boolean> = {};
    for (const scheme of entry.operation.securitySchemes) {
      const value = await entry.secrets.get(secretKeyFor(scheme.name, origin));
      status[scheme.name] = value !== undefined && value.length > 0;
    }
    return status;
  }

  private async handleSend(entry: PanelEntry, request: SendRequestPayload): Promise<void> {
    const server = (request.server ?? "").replace(/\/+$/, "");
    let path = request.path ?? entry.operation.path;
    for (const [name, value] of Object.entries(request.pathParams ?? {})) {
      path = path.split(`{${name}}`).join(encodeURIComponent(value));
    }

    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(request.queryParams ?? {})) {
      if (value !== undefined && value !== "") {
        query.append(name, value);
      }
    }

    const headers: Record<string, string> = { ...(request.headerParams ?? {}) };

    const origin = originOf(server);
    for (const scheme of entry.operation.securitySchemes) {
      const secret = await entry.secrets.get(secretKeyFor(scheme.name, origin));
      if (!secret) {
        continue;
      }
      if (scheme.type === "apiKey" && scheme.in === "header" && scheme.paramName) {
        headers[scheme.paramName] = secret;
      } else if (scheme.type === "apiKey" && scheme.in === "query" && scheme.paramName) {
        query.append(scheme.paramName, secret);
      } else if (scheme.type === "http" && scheme.scheme === "bearer") {
        headers["Authorization"] = `Bearer ${secret}`;
      } else if (scheme.type === "http" && scheme.scheme === "basic") {
        headers["Authorization"] = `Basic ${Buffer.from(secret, "utf8").toString("base64")}`;
      }
    }

    if (request.body !== undefined && request.body !== "" && request.contentType) {
      headers["Content-Type"] = request.contentType;
    }

    const queryString = query.toString();
    const url = server + path + (queryString ? `?${queryString}` : "");

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      void entry.panel.webview.postMessage({
        type: "result",
        result: { ok: false, error: "The resulting URL is not valid", timeMs: 0 } as HttpResult,
      });
      return;
    }

    const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
    if (parsed.protocol === "http:" && !isLocalhost && !getConfig().tryItAllowInsecure) {
      const choice = await vscode.window.showWarningMessage(
        "This request uses an insecure http:// URL. Send anyway?",
        "Send",
        "Cancel"
      );
      if (choice !== "Send") {
        return;
      }
    }

    const spec: HttpRequestSpec = {
      method: entry.operation.method.toUpperCase(),
      url,
      headers,
      body: request.body,
    };

    const controller = new AbortController();
    entry.abortController = controller;
    const result = await sendRequest(spec, getConfig().tryItTimeoutMs, entry.outputChannel, controller);
    entry.abortController = undefined;
    void entry.panel.webview.postMessage({ type: "result", result });
  }

  dispose(): void {
    for (const entry of this.panels.values()) {
      entry.messageDisposable.dispose();
      entry.panel.dispose();
    }
    this.panels.clear();
  }
}

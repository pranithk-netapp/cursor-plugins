// Browser-side entry point for the "Try it" webview panel. Runs inside the
// webview's sandboxed iframe — no `vscode` module is available here (see
// src/vscode/webview/tryItPanel.ts for the extension-host side of the
// message protocol). Local copies of the view-model shapes are kept in
// sync by hand with tryItPanel.ts's exported interfaces, matching the
// existing preview/report webviews' convention of not importing vscode-side
// modules into a webview bundle.

export {};

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

interface ParamViewModel {
  name: string;
  in: string;
  required: boolean;
  description?: string;
  defaultValue: string;
}

interface RequestBodyViewModel {
  required: boolean;
  contentTypes: string[];
  selectedContentType: string;
  examplesByContentType: Record<string, string>;
}

interface ServerViewModel {
  template: string;
  resolvedUrl: string;
  variables: { name: string; default: string; enum?: string[] }[];
}

interface SecuritySchemeViewModel {
  name: string;
  type: string;
  in?: string;
  paramName?: string;
  scheme?: string;
  description?: string;
}

interface OperationViewModel {
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

interface HttpResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  timeMs: number;
  error?: string;
}

type InitMessage = { type: "init"; operation: OperationViewModel; secretStatus: Record<string, boolean> };
type SecretStatusMessage = { type: "secretStatus"; secretStatus: Record<string, boolean> };
type ResultMessage = { type: "result"; result: HttpResult };
type HostMessage = InitMessage | SecretStatusMessage | ResultMessage;

const vscode = acquireVsCodeApi();
const root = document.getElementById("app")!;

let currentOperation: OperationViewModel | undefined;

// Live input elements, re-populated on each render() so gather() can read
// current values without re-querying the DOM by hand each time.
const pathInputs = new Map<string, HTMLInputElement>();
const queryInputs = new Map<string, HTMLInputElement>();
const headerInputs = new Map<string, HTMLInputElement>();
let serverInput: HTMLInputElement | undefined;
let bodyTextarea: HTMLTextAreaElement | undefined;
let contentTypeSelect: HTMLSelectElement | undefined;
let sendButton: HTMLButtonElement | undefined;
let securitySection: HTMLElement | undefined;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function labeledInput(labelText: string, required: boolean, value: string, description?: string): { row: HTMLElement; input: HTMLInputElement } {
  const row = el("div", "field-row");
  const label = el("label", "field-label", labelText + (required ? " *" : ""));
  if (description) {
    label.title = description;
  }
  const input = el("input", "field-input");
  input.type = "text";
  input.value = value;
  row.appendChild(label);
  row.appendChild(input);
  return { row, input };
}

function renderSecuritySection(operation: OperationViewModel, secretStatus: Record<string, boolean>): HTMLElement {
  const section = el("div", "section security-section");
  section.appendChild(el("div", "section-title", "Security"));
  if (operation.securitySchemes.length === 0) {
    section.appendChild(el("div", "muted", "No security schemes apply to this operation."));
    return section;
  }
  for (const scheme of operation.securitySchemes) {
    const row = el("div", "security-row");
    const isSet = secretStatus[scheme.name] === true;
    row.appendChild(el("span", "security-indicator " + (isSet ? "is-set" : "is-unset"), isSet ? "✓" : "✗"));
    row.appendChild(el("span", "security-name", `${scheme.name} (${scheme.type}${scheme.scheme ? " " + scheme.scheme : ""})`));
    const button = el("button", "secret-button", isSet ? "Update" : "Set");
    button.type = "button";
    button.addEventListener("click", () => {
      const serverOrigin = originOf(serverInput?.value ?? operation.defaultServerUrl);
      vscode.postMessage({ type: "setSecret", schemeName: scheme.name, serverOrigin });
    });
    row.appendChild(button);
    section.appendChild(row);
  }
  return section;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function render(operation: OperationViewModel, secretStatus: Record<string, boolean>): void {
  currentOperation = operation;
  root.innerHTML = "";
  pathInputs.clear();
  queryInputs.clear();
  headerInputs.clear();

  const header = el("div", "op-header");
  header.appendChild(el("span", "method-badge method-" + operation.method, operation.method.toUpperCase()));
  header.appendChild(el("span", "op-path", operation.path));
  root.appendChild(header);
  if (operation.summary || operation.description) {
    root.appendChild(el("div", "op-description", operation.summary || operation.description || ""));
  }

  const serverSection = el("div", "section");
  serverSection.appendChild(el("div", "section-title", "Server"));
  const serverRow = labeledInput("URL", true, operation.defaultServerUrl);
  serverInput = serverRow.input;
  serverSection.appendChild(serverRow.row);
  if (operation.servers.length > 1) {
    const select = el("select", "server-select");
    for (const server of operation.servers) {
      const option = el("option", undefined, server.resolvedUrl);
      option.value = server.resolvedUrl;
      select.appendChild(option);
    }
    select.addEventListener("change", () => {
      if (serverInput) {
        serverInput.value = select.value;
      }
    });
    serverSection.appendChild(select);
  }
  root.appendChild(serverSection);

  if (operation.pathParams.length > 0) {
    const section = el("div", "section");
    section.appendChild(el("div", "section-title", "Path parameters"));
    for (const param of operation.pathParams) {
      const { row, input } = labeledInput(param.name, param.required, param.defaultValue, param.description);
      pathInputs.set(param.name, input);
      section.appendChild(row);
    }
    root.appendChild(section);
  }

  if (operation.queryParams.length > 0) {
    const section = el("div", "section");
    section.appendChild(el("div", "section-title", "Query parameters"));
    for (const param of operation.queryParams) {
      const { row, input } = labeledInput(param.name, param.required, param.defaultValue, param.description);
      queryInputs.set(param.name, input);
      section.appendChild(row);
    }
    root.appendChild(section);
  }

  if (operation.headerParams.length > 0) {
    const section = el("div", "section");
    section.appendChild(el("div", "section-title", "Header parameters"));
    for (const param of operation.headerParams) {
      const { row, input } = labeledInput(param.name, param.required, param.defaultValue, param.description);
      headerInputs.set(param.name, input);
      section.appendChild(row);
    }
    root.appendChild(section);
  }

  securitySection = renderSecuritySection(operation, secretStatus);
  root.appendChild(securitySection);

  if (operation.requestBody) {
    const section = el("div", "section");
    section.appendChild(el("div", "section-title", "Request body" + (operation.requestBody.required ? " *" : "")));
    if (operation.requestBody.contentTypes.length > 1) {
      const select = el("select", "content-type-select");
      for (const contentType of operation.requestBody.contentTypes) {
        const option = el("option", undefined, contentType);
        option.value = contentType;
        select.appendChild(option);
      }
      select.value = operation.requestBody.selectedContentType;
      contentTypeSelect = select;
      select.addEventListener("change", () => {
        if (bodyTextarea) {
          bodyTextarea.value = operation.requestBody!.examplesByContentType[select.value] ?? "";
        }
      });
      section.appendChild(select);
    } else {
      contentTypeSelect = undefined;
    }
    const textarea = el("textarea", "body-textarea");
    textarea.value = operation.requestBody.examplesByContentType[operation.requestBody.selectedContentType] ?? "";
    textarea.rows = 12;
    bodyTextarea = textarea;
    section.appendChild(textarea);
    root.appendChild(section);
  } else {
    bodyTextarea = undefined;
    contentTypeSelect = undefined;
  }

  const actions = el("div", "actions");
  sendButton = el("button", "send-button", "Send");
  sendButton.type = "button";
  sendButton.addEventListener("click", onSend);
  const cancelButton = el("button", "cancel-button", "Cancel");
  cancelButton.type = "button";
  cancelButton.addEventListener("click", () => vscode.postMessage({ type: "cancel" }));
  actions.appendChild(sendButton);
  actions.appendChild(cancelButton);
  root.appendChild(actions);

  const resultContainer = el("div", "result-container");
  resultContainer.id = "result-container";
  root.appendChild(resultContainer);
}

function updateSecretStatus(secretStatus: Record<string, boolean>): void {
  if (!currentOperation || !securitySection) {
    return;
  }
  const replacement = renderSecuritySection(currentOperation, secretStatus);
  securitySection.replaceWith(replacement);
  securitySection = replacement;
}

function collectValues(inputs: Map<string, HTMLInputElement>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, input] of inputs) {
    out[name] = input.value;
  }
  return out;
}

function onSend(): void {
  if (!currentOperation) {
    return;
  }
  const request = {
    server: serverInput?.value ?? currentOperation.defaultServerUrl,
    path: currentOperation.path,
    pathParams: collectValues(pathInputs),
    queryParams: collectValues(queryInputs),
    headerParams: collectValues(headerInputs),
    body: bodyTextarea ? bodyTextarea.value : undefined,
    contentType: contentTypeSelect ? contentTypeSelect.value : currentOperation.requestBody?.selectedContentType,
  };
  renderPendingResult();
  vscode.postMessage({ type: "send", request });
}

function renderPendingResult(): void {
  const container = document.getElementById("result-container");
  if (!container) {
    return;
  }
  container.innerHTML = "";
  container.appendChild(el("div", "muted", "Sending..."));
}

const MAX_DISPLAY_CHARS = 20000;

function renderResult(result: HttpResult): void {
  const container = document.getElementById("result-container");
  if (!container) {
    return;
  }
  container.innerHTML = "";

  if (!result.ok) {
    container.appendChild(el("div", "result-error", `Error (${result.timeMs}ms): ${result.error ?? "unknown error"}`));
    return;
  }

  const statusLine = el("div", "result-status");
  const statusClass = result.status !== undefined && result.status < 400 ? "status-ok" : "status-error";
  statusLine.appendChild(el("span", "status-badge " + statusClass, `${result.status} ${result.statusText ?? ""}`));
  statusLine.appendChild(el("span", "result-time", `${result.timeMs}ms`));
  container.appendChild(statusLine);

  if (result.headers) {
    const details = document.createElement("details");
    details.className = "headers-details";
    const summary = document.createElement("summary");
    summary.textContent = `Response headers (${Object.keys(result.headers).length})`;
    details.appendChild(summary);
    const list = el("div", "headers-list");
    for (const [name, value] of Object.entries(result.headers)) {
      list.appendChild(el("div", "header-row", `${name}: ${value}`));
    }
    details.appendChild(list);
    container.appendChild(details);
  }

  const contentType = result.headers?.["content-type"] ?? "";
  let bodyText = result.body ?? "";
  let truncated = false;
  if (bodyText.length > MAX_DISPLAY_CHARS) {
    bodyText = bodyText.slice(0, MAX_DISPLAY_CHARS);
    truncated = true;
  }
  if (contentType.includes("json") && bodyText.length > 0) {
    try {
      bodyText = JSON.stringify(JSON.parse(bodyText), null, 2);
    } catch {
      // leave as-is if it doesn't actually parse as JSON
    }
  }
  const pre = el("pre", "result-body");
  pre.textContent = bodyText + (truncated ? "\n... (truncated)" : "");
  container.appendChild(pre);
}

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const msg = event.data;
  if (!msg) {
    return;
  }
  if (msg.type === "init") {
    render(msg.operation, msg.secretStatus);
  } else if (msg.type === "secretStatus") {
    updateSecretStatus(msg.secretStatus);
  } else if (msg.type === "result") {
    renderResult(msg.result);
  }
});

vscode.postMessage({ type: "ready" });

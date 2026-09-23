// Sends a "Try it" request from the extension host (never from the
// webview, which has connect-src 'none' per its CSP) using Node's global
// `fetch`. Logs to a shared OutputChannel with auth-shaped header values
// redacted; never logs the request or response body.

import * as vscode from "vscode";

export interface HttpRequestSpec {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  timeMs: number;
  error?: string;
}

const MAX_BODY_CHARS = 1_000_000;
const REDACT_HEADER_RE = /auth|key|token|secret/i;

function redactedHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = REDACT_HEADER_RE.test(name) ? "***" : value;
  }
  return out;
}

/**
 * Send `req`, aborting after `timeoutMs` or when `externalController` (if
 * given) is aborted by the caller (e.g. a webview "Cancel" click). Only
 * http/https URLs are allowed; anything else is rejected before any network
 * activity.
 */
export async function sendRequest(
  req: HttpRequestSpec,
  timeoutMs: number,
  outputChannel: vscode.OutputChannel,
  externalController?: AbortController
): Promise<HttpResult> {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return { ok: false, error: "Only http/https URLs are allowed", timeMs: 0 };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http/https URLs are allowed", timeMs: 0 };
  }

  outputChannel.appendLine(`>> ${req.method} ${req.url}`);
  for (const [name, value] of Object.entries(redactedHeaders(req.headers))) {
    outputChannel.appendLine(`   ${name}: ${value}`);
  }

  const controller = externalController ?? new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const response = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
    });
    const timeMs = Date.now() - start;

    let bodyText = await response.text();
    let truncated = false;
    if (bodyText.length > MAX_BODY_CHARS) {
      bodyText = bodyText.slice(0, MAX_BODY_CHARS) + "\n... (truncated)";
      truncated = true;
    }

    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name] = value;
    });

    outputChannel.appendLine(`<< ${response.status} ${response.statusText} (${timeMs}ms)${truncated ? " [truncated]" : ""}`);

    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers,
      body: bodyText,
      timeMs,
    };
  } catch (error: any) {
    const timeMs = Date.now() - start;
    const message = controller.signal.aborted ? "Request timed out or was cancelled" : error?.message ?? String(error);
    outputChannel.appendLine(`<< error after ${timeMs}ms: ${message}`);
    return { ok: false, error: message, timeMs };
  } finally {
    clearTimeout(timer);
  }
}

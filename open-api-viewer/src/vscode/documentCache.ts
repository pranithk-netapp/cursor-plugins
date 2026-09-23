import * as vscode from "vscode";
import { ParseResult, SpecIndex } from "../core/types";
import { parseSpec } from "../core/parse";
import { buildIndex } from "../core/specIndex";
import { isOpenApiDocument } from "./detector";
import { getConfig } from "./config";

interface CacheEntry {
  version: number;
  parseResult: ParseResult;
  index: SpecIndex;
}

/**
 * Per-URI, version-checked parse+index cache, plus a debounced
 * "re-analyzed" signal. `get()` is synchronous and cheap to call repeatedly
 * (analyzing rpc.json-sized documents is expected to stay well under
 * 100ms per the plan's perf budget) — later phases' providers
 * (diagnostics, outline, hover, ...) all read through this, and subscribe
 * to `onDidChange` instead of listening to workspace events themselves.
 */
export class DocumentCache implements vscode.Disposable {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();

  /** Fires ~debounceMs after a document changes and is an OpenAPI doc. */
  readonly onDidChange: vscode.Event<vscode.Uri> = this.emitter.event;

  get(document: vscode.TextDocument): { parseResult: ParseResult; index: SpecIndex } {
    const key = document.uri.toString();
    const cached = this.entries.get(key);
    if (cached && cached.version === document.version) {
      return { parseResult: cached.parseResult, index: cached.index };
    }

    const lang = document.languageId === "yaml" ? "yaml" : "json";
    const parseResult = parseSpec(document.getText(), lang);
    const index = buildIndex(parseResult);
    this.entries.set(key, { version: document.version, parseResult, index });
    return { parseResult, index };
  }

  delete(uri: vscode.Uri): void {
    this.entries.delete(uri.toString());
    const key = uri.toString();
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  /** Debounce a re-analysis of `document`, then fire onDidChange. No-op for non-OpenAPI docs. */
  scheduleAnalysis(document: vscode.TextDocument): void {
    if (!isOpenApiDocument(document)) {
      return;
    }
    const key = document.uri.toString();
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const debounceMs = getConfig().debounceMs;
    const timer = setTimeout(() => {
      this.timers.delete(key);
      this.get(document);
      this.emitter.fire(document.uri);
    }, debounceMs);
    this.timers.set(key, timer);
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.entries.clear();
    this.emitter.dispose();
  }
}

/**
 * Wire vscode.workspace document events into `cache`'s debounced analysis.
 * Later phases' providers subscribe to `cache.onDidChange` to know when to
 * refresh (diagnostics, outline, ...).
 */
export function registerDocumentListeners(context: vscode.ExtensionContext, cache: DocumentCache): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      cache.scheduleAnalysis(event.document);
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      cache.scheduleAnalysis(document);
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      cache.delete(document.uri);
    })
  );
  context.subscriptions.push(cache);
}

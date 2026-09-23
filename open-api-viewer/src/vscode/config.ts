import * as vscode from "vscode";
import { AuditSeverity } from "../core/audit/types";

// Single interface + single reader function for openapiViewer.* settings.
// Later phases (tryIt, ...) add more keys here rather than growing
// separate config readers.
export interface OpenApiViewerConfig {
  debounceMs: number;
  /** openapiViewer.validation.enabled */
  validationEnabled: boolean;
  /** openapiViewer.validation.missingDescriptions (OAV108 severity, 'off' disables it) */
  missingDescriptions: "off" | "info" | "warning";
  /** openapiViewer.audit.runOn: when the audit diagnostics collection is (re)computed automatically. */
  auditRunOn: "manual" | "save" | "type";
  /** openapiViewer.audit.ruleSeverity: rule id -> 'off' or a replacement severity. */
  auditRuleSeverity: Record<string, "off" | AuditSeverity>;
  /** openapiViewer.codeLens.enabled: show the "▶ Try it" CodeLens above each operation. */
  codeLensEnabled: boolean;
  /** openapiViewer.tryIt.defaultServerUrl: initial server value for new Try-it panels when non-empty. */
  tryItDefaultServerUrl: string;
  /** openapiViewer.tryIt.timeoutMs: request timeout for Try-it requests. */
  tryItTimeoutMs: number;
  /** openapiViewer.tryIt.allowInsecure: skip the http:// confirmation prompt. */
  tryItAllowInsecure: boolean;
}

const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_VALIDATION_ENABLED = true;
const DEFAULT_MISSING_DESCRIPTIONS = "info";
const DEFAULT_AUDIT_RUN_ON = "save";
const DEFAULT_AUDIT_RULE_SEVERITY: Record<string, "off" | AuditSeverity> = {};
const DEFAULT_CODE_LENS_ENABLED = true;
const DEFAULT_TRY_IT_DEFAULT_SERVER_URL = "";
const DEFAULT_TRY_IT_TIMEOUT_MS = 30000;
const DEFAULT_TRY_IT_ALLOW_INSECURE = false;

export function getConfig(): OpenApiViewerConfig {
  const cfg = vscode.workspace.getConfiguration("openapiViewer");
  return {
    debounceMs: cfg.get<number>("debounceMs", DEFAULT_DEBOUNCE_MS),
    validationEnabled: cfg.get<boolean>("validation.enabled", DEFAULT_VALIDATION_ENABLED),
    missingDescriptions: cfg.get<"off" | "info" | "warning">(
      "validation.missingDescriptions",
      DEFAULT_MISSING_DESCRIPTIONS
    ),
    auditRunOn: cfg.get<"manual" | "save" | "type">("audit.runOn", DEFAULT_AUDIT_RUN_ON),
    auditRuleSeverity: cfg.get<Record<string, "off" | AuditSeverity>>(
      "audit.ruleSeverity",
      DEFAULT_AUDIT_RULE_SEVERITY
    ),
    codeLensEnabled: cfg.get<boolean>("codeLens.enabled", DEFAULT_CODE_LENS_ENABLED),
    tryItDefaultServerUrl: cfg.get<string>("tryIt.defaultServerUrl", DEFAULT_TRY_IT_DEFAULT_SERVER_URL),
    tryItTimeoutMs: cfg.get<number>("tryIt.timeoutMs", DEFAULT_TRY_IT_TIMEOUT_MS),
    tryItAllowInsecure: cfg.get<boolean>("tryIt.allowInsecure", DEFAULT_TRY_IT_ALLOW_INSECURE),
  };
}

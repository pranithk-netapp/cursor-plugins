// Pure, vscode-free types for the offline 42Crunch-style audit. Nothing
// here imports "vscode" so it can run in plain Node for fast unit tests,
// matching the rest of src/core.

import { SpecIndex } from "../types";

export type AuditCategory = "security" | "dataValidation" | "quality";
export type AuditSeverity = "critical" | "high" | "medium" | "low";

/** One finding produced by a rule for one location in the document. */
export interface AuditFinding {
  ruleId: string;
  pointer: string;
  message: string;
}

/** What a rule's run() receives. `value` is provided for convenience/symmetry with AuditContext consumers. */
export interface AuditContext {
  index: SpecIndex;
  value: any;
}

/** What a rule's run() returns: the findings, plus how many "sites" the rule's precondition applied to. */
export interface AuditRuleRunResult {
  findings: AuditFinding[];
  /** Count of all sites the rule's applicability predicate matched, pass or fail (see scoring.ts). */
  eligible: number;
}

export interface AuditRule {
  id: string;
  category: AuditCategory;
  severity: AuditSeverity;
  weight: number;
  title: string;
  description: string;
  run(ctx: AuditContext): AuditRuleRunResult;
}

/**
 * One rule's contribution to the final report: the (possibly
 * severity-overridden) rule, its raw findings/eligible count, and the
 * scoring math scoring.ts derived from them (effectiveWeight already
 * accounts for redistribution from any 'off' rules in the same category;
 * deduction is effectiveWeight * min(1, findings/eligible)). `off` rules
 * are still included (with empty findings, eligible 0, deduction 0) so the
 * report webview can show every rule's status.
 */
export interface AuditRuleResult {
  rule: AuditRule;
  findings: AuditFinding[];
  eligible: number;
  effectiveWeight: number;
  deduction: number;
  off: boolean;
}

export interface AuditReport {
  total: number;
  categories: Record<AuditCategory, { score: number; max: number }>;
  ruleResults: AuditRuleResult[];
}

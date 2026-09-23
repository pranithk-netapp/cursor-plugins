// Entry point for the offline audit: wires the three rule categories
// together and runs them against a SpecIndex. Pure, no vscode dependency.

import { SpecIndex } from "../types";
import { securityRules } from "./rules/security";
import { dataValidationRules } from "./rules/dataValidation";
import { qualityRules } from "./rules/quality";
import { AuditFinding, AuditReport, AuditRule, AuditSeverity } from "./types";
import { scoreReport, RawRuleResult } from "./scoring";

/** All 25 rules (9 security + 9 dataValidation + 7 quality). */
export const ALL_RULES: AuditRule[] = [...securityRules, ...dataValidationRules, ...qualityRules];

/**
 * Run every rule not overridden to 'off' against `index`, then score the
 * results. `ruleOverrides` maps rule id -> 'off' (skip entirely, weight
 * redistributed within its category) or a replacement severity (rule
 * still runs, but its findings report the overridden severity).
 */
export function runAudit(index: SpecIndex, ruleOverrides: Record<string, "off" | AuditSeverity> = {}): AuditReport {
  const offRuleIds = new Set<string>();
  const results: RawRuleResult[] = [];

  for (const rule of ALL_RULES) {
    const override = ruleOverrides[rule.id];
    if (override === "off") {
      offRuleIds.add(rule.id);
      results.push({ rule, findings: [], eligible: 0 });
      continue;
    }

    const effectiveRule: AuditRule = override ? { ...rule, severity: override } : rule;
    const { findings, eligible }: { findings: AuditFinding[]; eligible: number } = rule.run({ index, value: index.value });
    results.push({ rule: effectiveRule, findings, eligible });
  }

  return scoreReport(results, offRuleIds);
}

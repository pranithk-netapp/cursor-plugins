// Turns raw {rule, findings, eligible} rule results into the final scored
// AuditReport. Pure, no vscode dependency.

import { AuditCategory, AuditFinding, AuditReport, AuditRule, AuditRuleResult } from "./types";

/** Category maximums. These are exact sums of each category's rule weights (see audit.test.ts). */
export const CATEGORY_MAX: Record<AuditCategory, number> = {
  security: 30,
  dataValidation: 50,
  quality: 20,
};

const CATEGORIES: AuditCategory[] = ["security", "dataValidation", "quality"];

export interface RawRuleResult {
  rule: AuditRule;
  findings: AuditFinding[];
  eligible: number;
}

/**
 * `ruleResults` covers every rule (25), including ones turned `off` — for
 * an off rule, findings/eligible are expected to be `[]`/`0` (the caller
 * didn't run it), and `offRuleIds` is how we know to exclude it from
 * deduction and redistribute its weight onto the remaining active rules in
 * the same category. If every rule in a category is off, that category
 * scores its full max (deductionByCategory naturally stays 0 in that case).
 */
export function scoreReport(ruleResults: RawRuleResult[], offRuleIds: Set<string>): AuditReport {
  const offWeightByCategory: Record<AuditCategory, number> = { security: 0, dataValidation: 0, quality: 0 };
  for (const { rule } of ruleResults) {
    if (offRuleIds.has(rule.id)) {
      offWeightByCategory[rule.category] += rule.weight;
    }
  }

  const finalRuleResults: AuditRuleResult[] = [];
  const deductionByCategory: Record<AuditCategory, number> = { security: 0, dataValidation: 0, quality: 0 };

  for (const { rule, findings, eligible } of ruleResults) {
    if (offRuleIds.has(rule.id)) {
      finalRuleResults.push({ rule, findings: [], eligible: 0, effectiveWeight: 0, deduction: 0, off: true });
      continue;
    }

    const max = CATEGORY_MAX[rule.category];
    const remaining = max - offWeightByCategory[rule.category];
    const redistributionFactor = remaining > 0 ? max / remaining : 1;
    const effectiveWeight = rule.weight * redistributionFactor;
    const ratio = eligible > 0 ? Math.min(1, findings.length / eligible) : 0;
    const deduction = effectiveWeight * ratio;

    deductionByCategory[rule.category] += deduction;
    finalRuleResults.push({ rule, findings, eligible, effectiveWeight, deduction, off: false });
  }

  const categories = {} as Record<AuditCategory, { score: number; max: number }>;
  let total = 0;
  for (const category of CATEGORIES) {
    const max = CATEGORY_MAX[category];
    const score = Math.max(0, Math.min(max, Math.round(max - deductionByCategory[category])));
    categories[category] = { score, max };
    total += score;
  }

  return { total, categories, ruleResults: finalRuleResults };
}

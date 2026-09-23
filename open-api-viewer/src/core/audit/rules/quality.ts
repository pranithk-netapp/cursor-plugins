// Quality audit rules QF001-QF007. Pure, no vscode dependency. Category
// max is 20 (3+3+2+3+4+3+2), asserted in audit.test.ts.

import { derefValue } from "../../resolve";
import { joinPointer } from "../../pointer";
import { AuditContext, AuditFinding, AuditRule, AuditRuleRunResult } from "../types";

function finding(ruleId: string, pointer: string, message: string): AuditFinding {
  return { ruleId, pointer, message };
}

function runQF001(ctx: AuditContext): AuditRuleRunResult {
  const findings: AuditFinding[] = [];
  for (const op of ctx.index.operations) {
    const opValue = ctx.value?.paths?.[op.path]?.[op.method];
    const hasSummary = typeof opValue?.summary === "string" && opValue.summary.length > 0;
    const hasDescription = typeof opValue?.description === "string" && opValue.description.length > 0;
    if (!hasSummary && !hasDescription) {
      findings.push(finding("QF001", op.pointer, "Operation is missing both 'summary' and 'description'"));
    }
  }
  return { findings, eligible: ctx.index.operations.length };
}

function runQF002(ctx: AuditContext): AuditRuleRunResult {
  const findings: AuditFinding[] = [];
  for (const op of ctx.index.operations) {
    if (!op.operationId) {
      findings.push(finding("QF002", op.pointer, "Operation is missing 'operationId'"));
    }
  }
  return { findings, eligible: ctx.index.operations.length };
}

function runQF003(ctx: AuditContext): AuditRuleRunResult {
  const findings: AuditFinding[] = [];
  for (const op of ctx.index.operations) {
    const opValue = ctx.value?.paths?.[op.path]?.[op.method];
    if (!Array.isArray(opValue?.tags) || opValue.tags.length === 0) {
      findings.push(finding("QF003", op.pointer, "Operation is missing 'tags'"));
    }
  }
  return { findings, eligible: ctx.index.operations.length };
}

function runQF004(ctx: AuditContext): AuditRuleRunResult {
  const declared = new Set<string>(
    Array.isArray(ctx.value?.tags) ? ctx.value.tags.map((t: any) => t?.name).filter((n: any) => typeof n === "string") : []
  );
  const usedTagPointer = new Map<string, string>();
  for (const op of ctx.index.operations) {
    const opValue = ctx.value?.paths?.[op.path]?.[op.method];
    if (!Array.isArray(opValue?.tags)) {
      continue;
    }
    for (const tag of opValue.tags) {
      if (typeof tag === "string" && !usedTagPointer.has(tag)) {
        usedTagPointer.set(tag, op.pointer);
      }
    }
  }

  const findings: AuditFinding[] = [];
  const rootTagsPointer = ctx.index.byPointer.has("/tags") ? "/tags" : "";
  for (const [tag, opPointer] of usedTagPointer) {
    if (!declared.has(tag)) {
      findings.push(finding("QF004", rootTagsPointer || opPointer, `Tag '${tag}' is used but not declared in the root 'tags' array`));
    }
  }
  return { findings, eligible: usedTagPointer.size };
}

function runQF005(ctx: AuditContext): AuditRuleRunResult {
  const findings: AuditFinding[] = [];
  let eligible = 0;
  for (const op of ctx.index.operations) {
    const opValue = ctx.value?.paths?.[op.path]?.[op.method];
    const pathValue = ctx.value?.paths?.[op.path];
    const hasParams =
      (Array.isArray(pathValue?.parameters) && pathValue.parameters.length > 0) ||
      (Array.isArray(opValue?.parameters) && opValue.parameters.length > 0);
    const hasRequestBody = opValue?.requestBody !== undefined;
    if (!hasParams && !hasRequestBody) {
      continue;
    }
    eligible++;
    const responses = opValue?.responses;
    const has400 = !!responses && typeof responses === "object" && "400" in responses;
    if (!has400) {
      findings.push(finding("QF005", op.pointer, `Operation '${op.method.toUpperCase()} ${op.path}' takes input but has no '400' response`));
    }
  }
  return { findings, eligible };
}

function runQF006(ctx: AuditContext): AuditRuleRunResult {
  const findings: AuditFinding[] = [];
  let eligible = 0;

  const checkContent = (content: any, basePointer: string, describe: (mt: string) => string): void => {
    if (!content || typeof content !== "object") {
      return;
    }
    for (const mediaType of Object.keys(content)) {
      const mtValue = content[mediaType];
      eligible++;
      const hasExample = mtValue && typeof mtValue === "object" && (mtValue.example !== undefined || mtValue.examples !== undefined);
      if (!hasExample) {
        const direct = joinPointer(basePointer, "content", mediaType);
        const pointer = ctx.index.byPointer.has(direct) ? direct : basePointer;
        findings.push(finding("QF006", pointer, describe(mediaType)));
      }
    }
  };

  for (const op of ctx.index.operations) {
    const opValue = ctx.value?.paths?.[op.path]?.[op.method];
    if (!opValue) {
      continue;
    }

    if (opValue.requestBody !== undefined) {
      const rb = derefValue(ctx.index, opValue.requestBody);
      checkContent(rb?.content, joinPointer(op.pointer, "requestBody"), (mt) => `Request body media type '${mt}' has no example/examples`);
    }

    if (opValue.responses && typeof opValue.responses === "object") {
      for (const status of Object.keys(opValue.responses)) {
        const resp = derefValue(ctx.index, opValue.responses[status]);
        checkContent(resp?.content, joinPointer(op.pointer, "responses", status), (mt) => `Response '${status}' media type '${mt}' has no example/examples`);
      }
    }
  }

  return { findings, eligible };
}

function runQF007(ctx: AuditContext): AuditRuleRunResult {
  const hasContact = ctx.value?.info?.contact !== undefined;
  const hasLicense = ctx.value?.info?.license !== undefined;
  const fires = !hasContact && !hasLicense;
  return {
    eligible: 1,
    findings: fires ? [finding("QF007", "/info", "info.contact and info.license are both missing")] : [],
  };
}

export const qualityRules: AuditRule[] = [
  { id: "QF001", category: "quality", severity: "low", weight: 3, title: "Missing summary/description", description: "Operation missing both summary and description.", run: runQF001 },
  { id: "QF002", category: "quality", severity: "medium", weight: 3, title: "Missing operationId", description: "Operation missing operationId.", run: runQF002 },
  { id: "QF003", category: "quality", severity: "low", weight: 2, title: "Missing tags", description: "Operation missing tags (absent or empty array).", run: runQF003 },
  { id: "QF004", category: "quality", severity: "low", weight: 3, title: "Undeclared tag", description: "A tag used by an operation is not declared in the root tags array.", run: runQF004 },
  { id: "QF005", category: "quality", severity: "medium", weight: 4, title: "Missing 400 response", description: "Operation with input (parameters or requestBody) has no 400 response.", run: runQF005 },
  { id: "QF006", category: "quality", severity: "low", weight: 3, title: "Missing example", description: "A top-level request/response media-type object has no example/examples.", run: runQF006 },
  { id: "QF007", category: "quality", severity: "low", weight: 2, title: "Missing contact and license", description: "info.contact AND info.license both missing (fires once per doc).", run: runQF007 },
];

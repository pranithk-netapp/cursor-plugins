// Security audit rules SEC001-SEC009. Pure, no vscode dependency. Each
// rule is a small, independently testable function; `securityRules` wires
// them into AuditRule objects for engine.ts. Category max is 30
// (6+3+3+3+4+4+2+3+2), asserted in audit.test.ts.

import { encodeSegment, joinPointer } from "../../pointer";
import { AuditContext, AuditFinding, AuditRule, AuditRuleRunResult } from "../types";

function finding(ruleId: string, pointer: string, message: string): AuditFinding {
  return { ruleId, pointer, message };
}

/** Operation's own `security` if present (even `[]`), else root's, else undefined (uncovered). */
function effectiveSecurity(ctx: AuditContext, opValue: any): any[] | undefined {
  if (Array.isArray(opValue?.security)) {
    return opValue.security;
  }
  if (opValue && "security" in opValue) {
    return opValue.security;
  }
  if (Array.isArray(ctx.value?.security)) {
    return ctx.value.security;
  }
  return undefined;
}

function hasStatusOrDefault(responses: any, status: string): boolean {
  if (!responses || typeof responses !== "object") {
    return false;
  }
  return status in responses || "default" in responses;
}

function runSEC001(ctx: AuditContext): AuditRuleRunResult {
  const hasGlobalSecurity = Array.isArray(ctx.value?.security) && ctx.value.security.length > 0;
  let hasUncoveredOperation = false;
  let sampleOp: string | undefined;
  for (const op of ctx.index.operations) {
    const opValue = ctx.value?.paths?.[op.path]?.[op.method];
    if (opValue?.security === undefined) {
      hasUncoveredOperation = true;
      sampleOp = op.pointer;
      break;
    }
  }
  const fires = !hasGlobalSecurity && hasUncoveredOperation;
  return {
    eligible: 1,
    findings: fires
      ? [
          finding(
            "SEC001",
            sampleOp ?? "",
            "No global 'security' requirement, and at least one operation has no 'security' of its own"
          ),
        ]
      : [],
  };
}

function runSEC002(ctx: AuditContext): AuditRuleRunResult {
  const findings: AuditFinding[] = [];
  for (const op of ctx.index.operations) {
    const opValue = ctx.value?.paths?.[op.path]?.[op.method];
    if (Array.isArray(opValue?.security) && opValue.security.length === 0) {
      findings.push(finding("SEC002", op.pointer, `Operation '${op.method.toUpperCase()} ${op.path}' overrides security with an explicit empty array`));
    }
  }
  return { findings, eligible: ctx.index.operations.length };
}

function runSEC003(ctx: AuditContext): AuditRuleRunResult {
  const findings: AuditFinding[] = [];
  let eligible = 0;
  const schemeNames = new Set(Object.keys(ctx.value?.components?.securitySchemes ?? {}));

  const checkArray = (securityValue: any, pointer: string): void => {
    if (!Array.isArray(securityValue)) {
      return;
    }
    for (let i = 0; i < securityValue.length; i++) {
      const requirement = securityValue[i];
      if (!requirement || typeof requirement !== "object") {
        continue;
      }
      for (const name of Object.keys(requirement)) {
        eligible++;
        if (!schemeNames.has(name)) {
          findings.push(
            finding("SEC003", joinPointer(pointer, i), `Security requirement references undeclared scheme '${name}'`)
          );
        }
      }
    }
  };

  checkArray(ctx.value?.security, "/security");
  for (const op of ctx.index.operations) {
    const opValue = ctx.value?.paths?.[op.path]?.[op.method];
    checkArray(opValue?.security, joinPointer(op.pointer, "security"));
  }

  return { findings, eligible };
}

function runSEC004(ctx: AuditContext): AuditRuleRunResult {
  const findings: AuditFinding[] = [];
  const schemes = ctx.value?.components?.securitySchemes ?? {};
  const names = Object.keys(schemes);
  for (const name of names) {
    const scheme = schemes[name];
    if (scheme?.type === "apiKey" && scheme?.in === "query") {
      findings.push(
        finding(
          "SEC004",
          joinPointer("/components/securitySchemes", name),
          `securityScheme '${name}' is type 'apiKey' with 'in: query' (prefer a header)`
        )
      );
    }
  }
  return { findings, eligible: names.length };
}

function isInsecureHttpUrl(url: unknown): boolean {
  if (typeof url !== "string" || !url.startsWith("http://")) {
    return false;
  }
  return !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);
}

function runSEC005(ctx: AuditContext): AuditRuleRunResult {
  const findings: AuditFinding[] = [];
  const servers = Array.isArray(ctx.value?.servers) ? ctx.value.servers : [];
  let eligible = servers.length;
  servers.forEach((server: any, i: number) => {
    if (isInsecureHttpUrl(server?.url)) {
      findings.push(finding("SEC005", joinPointer("/servers", i), `Server URL '${server.url}' uses http:// instead of https://`));
    }
  });
  return { findings, eligible };
}

function isOperationSecured(ctx: AuditContext, opValue: any): boolean {
  const effective = effectiveSecurity(ctx, opValue);
  return Array.isArray(effective) && effective.length > 0;
}

function runSEC006(ctx: AuditContext): AuditRuleRunResult {
  const findings: AuditFinding[] = [];
  let eligible = 0;
  for (const op of ctx.index.operations) {
    const opValue = ctx.value?.paths?.[op.path]?.[op.method];
    if (!isOperationSecured(ctx, opValue)) {
      continue;
    }
    eligible++;
    if (!hasStatusOrDefault(opValue?.responses, "401")) {
      findings.push(finding("SEC006", op.pointer, `Secured operation '${op.method.toUpperCase()} ${op.path}' has no '401' response`));
    }
  }
  return { findings, eligible };
}

function runSEC007(ctx: AuditContext): AuditRuleRunResult {
  const findings: AuditFinding[] = [];
  let eligible = 0;
  for (const op of ctx.index.operations) {
    const opValue = ctx.value?.paths?.[op.path]?.[op.method];
    if (!isOperationSecured(ctx, opValue)) {
      continue;
    }
    eligible++;
    if (!hasStatusOrDefault(opValue?.responses, "403")) {
      findings.push(finding("SEC007", op.pointer, `Secured operation '${op.method.toUpperCase()} ${op.path}' has no '403' response`));
    }
  }
  return { findings, eligible };
}

function isWeakScheme(scheme: any): boolean {
  if (!scheme || typeof scheme !== "object") {
    return false;
  }
  if (scheme.type === "http" && scheme.scheme === "basic") {
    return true;
  }
  if (scheme.type === "oauth2" && scheme.flows && typeof scheme.flows === "object") {
    return "implicit" in scheme.flows || "password" in scheme.flows;
  }
  return false;
}

function runSEC008(ctx: AuditContext): AuditRuleRunResult {
  const findings: AuditFinding[] = [];
  const schemes = ctx.value?.components?.securitySchemes ?? {};
  const names = Object.keys(schemes);
  for (const name of names) {
    if (isWeakScheme(schemes[name])) {
      findings.push(finding("SEC008", joinPointer("/components/securitySchemes", name), `securityScheme '${name}' uses a weak scheme (http/basic, or oauth2 implicit/password flow)`));
    }
  }
  return { findings, eligible: names.length };
}

function serverHasUnresolvedVariable(server: any): boolean {
  const url = typeof server?.url === "string" ? server.url : "";
  const tokens = Array.from(url.matchAll(/\{([^}]+)\}/g)).map((m) => (m as RegExpMatchArray)[1]);
  if (tokens.length === 0) {
    return false;
  }
  return tokens.some((token) => server?.variables?.[token]?.default === undefined);
}

function runSEC009(ctx: AuditContext): AuditRuleRunResult {
  const servers = Array.isArray(ctx.value?.servers) ? ctx.value.servers : [];
  const hasServers = servers.length > 0;
  const fires = !hasServers || servers.every((server: any) => serverHasUnresolvedVariable(server));
  return {
    eligible: 1,
    findings: fires
      ? [finding("SEC009", "/servers", hasServers ? "Every server URL has an unresolved {variable} with no default" : "No 'servers' array is defined")]
      : [],
  };
}

export const securityRules: AuditRule[] = [
  { id: "SEC001", category: "security", severity: "critical", weight: 6, title: "No effective security", description: "No global security AND at least one operation has no own security either.", run: runSEC001 },
  { id: "SEC002", category: "security", severity: "high", weight: 3, title: "Explicit empty security override", description: "Operation has security: [] (explicit empty override).", run: runSEC002 },
  { id: "SEC003", category: "security", severity: "critical", weight: 3, title: "Undeclared security scheme", description: "A security requirement references a scheme name not declared in components.securitySchemes.", run: runSEC003 },
  { id: "SEC004", category: "security", severity: "high", weight: 3, title: "apiKey in query", description: "A securityScheme of type apiKey has in: query.", run: runSEC004 },
  { id: "SEC005", category: "security", severity: "high", weight: 4, title: "Insecure server URL", description: "A server URL uses http:// (not https://, and not localhost/127.0.0.1).", run: runSEC005 },
  { id: "SEC006", category: "security", severity: "medium", weight: 4, title: "Missing 401 response", description: "A secured operation has no 401 response (and no default).", run: runSEC006 },
  { id: "SEC007", category: "security", severity: "low", weight: 2, title: "Missing 403 response", description: "A secured operation has no 403 response (and no default).", run: runSEC007 },
  { id: "SEC008", category: "security", severity: "medium", weight: 3, title: "Weak security scheme", description: "securityScheme is http/basic, or oauth2 with an implicit/password flow.", run: runSEC008 },
  { id: "SEC009", category: "security", severity: "low", weight: 2, title: "Unresolved server variable / no servers", description: "No servers array, or every server URL has an unresolved {variable} with no default.", run: runSEC009 },
];

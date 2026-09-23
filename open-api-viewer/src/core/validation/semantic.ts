// Semantic (non-schema) OpenAPI review rules, OAV101-OAV110. Pure, no
// vscode dependency. Each rule is a separately named function so it can be
// reasoned about (and unit tested) independently; validateSemantics just
// concatenates their results.

import { AstNode, Issue, OperationInfo, ParseResult, SpecIndex } from "../types";
import { childByKey } from "../ast";
import { encodeSegment } from "../pointer";
import { resolveRef, derefValue } from "../resolve";

export interface SemanticOptions {
  /** Default 'info'. 'off' disables OAV108 entirely. */
  missingDescriptionSeverity?: "off" | "info" | "warning";
}

export function validateSemantics(
  parseResult: ParseResult,
  index: SpecIndex,
  opts: SemanticOptions = {}
): Issue[] {
  // parseResult is accepted (and part of the public signature) for
  // symmetry with validateAgainstSchema and in case a future rule needs
  // raw text/line info; the current rules only need `index`.
  void parseResult;
  const missingDescriptionSeverity = opts.missingDescriptionSeverity ?? "info";

  return [
    ...ruleOAV101(index),
    ...ruleOAV102(index),
    ...ruleOAV103(index),
    ...ruleOAV104(index),
    ...ruleOAV105(index),
    ...ruleOAV106(index),
    ...ruleOAV107(index),
    ...ruleOAV108(index, missingDescriptionSeverity),
    ...ruleOAV109(index),
    ...ruleOAV110(index),
  ];
}

/** A node's own key range, falling back to its value range if it has none. */
function keyRange(node: AstNode): { offset: number; length: number } {
  if (node.keyOffset !== undefined && node.keyLength !== undefined) {
    return { offset: node.keyOffset, length: node.keyLength };
  }
  return { offset: node.offset, length: Math.max(node.length, 1) };
}

function issue(
  code: string,
  message: string,
  severity: Issue["severity"],
  range: { offset: number; length: number }
): Issue {
  return { code, message, severity, offset: range.offset, length: range.length, source: "openapi" };
}

/** OAV101: unresolved local `$ref`. */
export function ruleOAV101(index: SpecIndex): Issue[] {
  const issues: Issue[] = [];
  for (const ref of index.refs) {
    if (ref.external) {
      continue;
    }
    if (resolveRef(index, ref.target) === undefined) {
      issues.push(
        issue(
          "OAV101",
          `Unresolved reference '${ref.target}'`,
          "error",
          { offset: ref.node.offset, length: ref.node.length }
        )
      );
    }
  }
  return issues;
}

/** OAV102: external `$ref` (multi-file specs are out of scope, informational only). */
export function ruleOAV102(index: SpecIndex): Issue[] {
  const issues: Issue[] = [];
  for (const ref of index.refs) {
    if (!ref.external) {
      continue;
    }
    issues.push(
      issue(
        "OAV102",
        `External reference '${ref.target}' is not resolved (multi-file specs are not supported)`,
        "info",
        { offset: ref.node.offset, length: ref.node.length }
      )
    );
  }
  return issues;
}

/** OAV103: a component with no incoming `$ref` (and, for securitySchemes, no security requirement). */
export function ruleOAV103(index: SpecIndex): Issue[] {
  const issues: Issue[] = [];
  const securityNames = collectSecurityRequirementNames(index.value);
  for (const info of index.components.values()) {
    const incoming = index.refsByTarget.get(info.pointer) ?? [];
    if (incoming.length > 0) {
      continue;
    }
    if (info.type === "securitySchemes" && securityNames.has(info.name)) {
      continue;
    }
    issues.push(
      issue(
        "OAV103",
        `Component '${info.name}' (${info.type}) is not referenced anywhere`,
        "warning",
        keyRange(info.node)
      )
    );
  }
  return issues;
}

/** Every security-requirement key ("scheme name") used anywhere in the document. */
function collectSecurityRequirementNames(value: any): Set<string> {
  const names = new Set<string>();
  const visit = (node: any): void => {
    if (node === null || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (Array.isArray(node.security)) {
      for (const requirement of node.security) {
        if (requirement && typeof requirement === "object") {
          for (const key of Object.keys(requirement)) {
            names.add(key);
          }
        }
      }
    }
    for (const key of Object.keys(node)) {
      visit(node[key]);
    }
  };
  visit(value);
  return names;
}

/** OAV104: duplicate operationId across operations. */
export function ruleOAV104(index: SpecIndex): Issue[] {
  const issues: Issue[] = [];
  const groups = new Map<string, OperationInfo[]>();
  for (const op of index.operations) {
    if (!op.operationId) {
      continue;
    }
    const list = groups.get(op.operationId);
    if (list) {
      list.push(op);
    } else {
      groups.set(op.operationId, [op]);
    }
  }
  for (const [id, ops] of groups) {
    if (ops.length <= 1) {
      continue;
    }
    for (const op of ops) {
      const sibling = ops.find((o) => o !== op)!;
      issues.push(
        issue(
          "OAV104",
          `Duplicate operationId '${id}' (also used by ${sibling.path} ${sibling.method.toUpperCase()})`,
          "error",
          { offset: op.keyOffset, length: op.keyLength }
        )
      );
    }
  }
  return issues;
}

interface DeclaredPathParam {
  name: string;
  required: boolean;
  node: AstNode;
}

/** Dereference an operation/path-item `parameters` array and keep only `in: path` entries. */
function collectPathParams(
  index: SpecIndex,
  arrayValue: any,
  arrayNode: AstNode | undefined
): DeclaredPathParam[] {
  const result: DeclaredPathParam[] = [];
  if (!Array.isArray(arrayValue)) {
    return result;
  }
  for (let i = 0; i < arrayValue.length; i++) {
    const resolved = derefValue(index, arrayValue[i]);
    if (!resolved || typeof resolved !== "object" || resolved.in !== "path" || typeof resolved.name !== "string") {
      continue;
    }
    const node = arrayNode?.children?.[i] ?? arrayNode;
    if (!node) {
      continue;
    }
    result.push({ name: resolved.name, required: resolved.required === true, node });
  }
  return result;
}

/** OAV105: path-template <-> `in: path` parameter mismatches, and missing `required: true`. */
export function ruleOAV105(index: SpecIndex): Issue[] {
  const issues: Issue[] = [];
  const templateRe = /\{([^}]+)\}/g;

  for (const op of index.operations) {
    const pathValue = index.value?.paths?.[op.path];
    if (pathValue && typeof pathValue === "object" && typeof pathValue.$ref === "string") {
      continue; // whole path item is a $ref: multi-file/indirection, out of scope.
    }

    const templateNames = new Set<string>();
    let match: RegExpExecArray | null;
    templateRe.lastIndex = 0;
    while ((match = templateRe.exec(op.path))) {
      templateNames.add(match[1]);
    }

    const pathItemNode = index.byPointer.get("/paths/" + encodeSegment(op.path));
    const pathParamsNode = pathItemNode ? childByKey(pathItemNode, "parameters") : undefined;
    const pathLevelParams = collectPathParams(index, pathValue?.parameters, pathParamsNode);

    const opParamsNode = childByKey(op.node, "parameters");
    const opValue = index.value?.paths?.[op.path]?.[op.method];
    const opLevelParams = collectPathParams(index, opValue?.parameters, opParamsNode);

    const declared = [...pathLevelParams, ...opLevelParams];
    const declaredNames = new Set(declared.map((param) => param.name));

    for (const name of templateNames) {
      if (declaredNames.has(name)) {
        continue;
      }
      if (!pathItemNode) {
        continue;
      }
      issues.push(
        issue(
          "OAV105",
          `Path template parameter '{${name}}' has no matching 'in: path' parameter declaration`,
          "error",
          keyRange(pathItemNode)
        )
      );
    }

    for (const param of declared) {
      if (!templateNames.has(param.name)) {
        issues.push(
          issue(
            "OAV105",
            `Parameter '${param.name}' declared 'in: path' but '{${param.name}}' does not appear in the path template`,
            "error",
            keyRange(param.node)
          )
        );
      } else if (!param.required) {
        issues.push(
          issue("OAV105", `Path parameters must have 'required: true'`, "warning", keyRange(param.node))
        );
      }
    }
  }

  return issues;
}

/** OAV106: an operation with no responses at all. */
export function ruleOAV106(index: SpecIndex): Issue[] {
  const issues: Issue[] = [];
  for (const op of index.operations) {
    const responses = index.value?.paths?.[op.path]?.[op.method]?.responses;
    const isEmpty = !responses || typeof responses !== "object" || Object.keys(responses).length === 0;
    if (isEmpty) {
      issues.push(
        issue("OAV106", "Operation has no responses defined", "error", {
          offset: op.keyOffset,
          length: op.keyLength,
        })
      );
    }
  }
  return issues;
}

/** OAV107: an operation with responses but no 2xx/3xx/default. */
export function ruleOAV107(index: SpecIndex): Issue[] {
  const issues: Issue[] = [];
  const successRe = /^[23]\d\d$/;
  for (const op of index.operations) {
    const responses = index.value?.paths?.[op.path]?.[op.method]?.responses;
    if (!responses || typeof responses !== "object") {
      continue; // OAV106 already flags "no responses at all".
    }
    const keys = Object.keys(responses);
    if (keys.length === 0) {
      continue;
    }
    const hasSuccess = keys.some((key) => key === "default" || successRe.test(key));
    if (!hasSuccess) {
      issues.push(
        issue("OAV107", "Operation has no 2xx/3xx success response (and no 'default')", "warning", {
          offset: op.keyOffset,
          length: op.keyLength,
        })
      );
    }
  }
  return issues;
}

/** OAV108: missing `info.description`, or an operation missing both `description` and `summary`. */
export function ruleOAV108(index: SpecIndex, severity: "off" | "info" | "warning"): Issue[] {
  if (severity === "off") {
    return [];
  }
  const issues: Issue[] = [];

  const infoNode = childByKey(index.root, "info");
  const infoDescription = index.value?.info?.description;
  if (infoNode && (typeof infoDescription !== "string" || infoDescription.length === 0)) {
    issues.push(issue("OAV108", "Missing 'info.description'", severity, keyRange(infoNode)));
  }

  for (const op of index.operations) {
    const opValue = index.value?.paths?.[op.path]?.[op.method];
    const hasDescription = typeof opValue?.description === "string" && opValue.description.length > 0;
    const hasSummary = typeof opValue?.summary === "string" && opValue.summary.length > 0;
    if (!hasDescription && !hasSummary) {
      issues.push(
        issue("OAV108", "Operation is missing both 'description' and 'summary'", severity, {
          offset: op.keyOffset,
          length: op.keyLength,
        })
      );
    }
  }

  return issues;
}

/** OAV109: a security requirement names a scheme that isn't declared in components.securitySchemes. */
export function ruleOAV109(index: SpecIndex): Issue[] {
  const issues: Issue[] = [];
  const schemeNames = new Set(Object.keys(index.value?.components?.securitySchemes ?? {}));

  const checkSecurityArray = (securityValue: any, pointer: string): void => {
    if (!Array.isArray(securityValue)) {
      return;
    }
    const arrayNode = index.byPointer.get(pointer);
    for (let i = 0; i < securityValue.length; i++) {
      const requirement = securityValue[i];
      if (!requirement || typeof requirement !== "object") {
        continue;
      }
      const requirementNode = arrayNode?.children?.[i] ?? arrayNode;
      for (const name of Object.keys(requirement)) {
        if (schemeNames.has(name)) {
          continue;
        }
        const range = requirementNode ? keyRange(requirementNode) : { offset: 0, length: 1 };
        issues.push(
          issue("OAV109", `Security requirement references undeclared scheme '${name}'`, "error", range)
        );
      }
    }
  };

  checkSecurityArray(index.value?.security, "/security");
  for (const op of index.operations) {
    const opValue = index.value?.paths?.[op.path]?.[op.method];
    checkSecurityArray(opValue?.security, op.pointer + "/security");
  }

  return issues;
}

/** OAV110: two path templates that normalize to the same shape (param names differ only). */
export function ruleOAV110(index: SpecIndex): Issue[] {
  const issues: Issue[] = [];
  const uniquePaths = Array.from(new Set(index.operations.map((op) => op.path)));
  const groups = new Map<string, string[]>();
  for (const path of uniquePaths) {
    const shape = path.replace(/\{[^}]*\}/g, "{}");
    const list = groups.get(shape);
    if (list) {
      list.push(path);
    } else {
      groups.set(shape, [path]);
    }
  }

  for (const paths of groups.values()) {
    if (paths.length <= 1) {
      continue;
    }
    for (const path of paths) {
      const node = index.byPointer.get("/paths/" + encodeSegment(path));
      if (!node) {
        continue;
      }
      const other = paths.find((p) => p !== path)!;
      issues.push(
        issue(
          "OAV110",
          `Path template collides with '${other}' (parameter names differ but shape is identical)`,
          "warning",
          keyRange(node)
        )
      );
    }
  }

  return issues;
}

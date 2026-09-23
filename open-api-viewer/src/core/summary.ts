// Markdown summaries for schema/response/parameter component nodes, used by
// hover.ts (and available for other providers). Pure, no vscode dependency.

import { AstNode, SpecIndex } from "./types";
import { childByKey } from "./ast";
import { resolveRef } from "./resolve";
import { pointerToSegments, refToPointer } from "./pointer";

const MAX_DEPTH = 8;
const DESCRIPTION_MAX = 300;

/**
 * Describe the schema at `pointer` as Markdown. `pointer` may point directly
 * at a schema object, or at a node that is itself a `{ $ref: ... }` wrapper
 * (e.g. a property's schema, or a requestBody/response schema) — in the
 * latter case the ref chain is followed (via resolve.ts's `resolveRef`,
 * cycle- and depth-guarded) until a non-ref schema node is reached, and that
 * resolved node's own pointer is used for the heading name.
 */
export function summarizeSchemaNode(index: SpecIndex, pointer: string, opts?: { maxProps?: number }): string {
  const maxProps = opts?.maxProps ?? 25;
  const node = resolveToSchemaNode(index, pointer);
  if (!node) {
    return `Cannot resolve \`${pointer}\`.`;
  }

  const name = lastSegment(node.pointer);
  const lines: string[] = [`**${name}** · ${describeType(node)}`];

  const description = getStringValue(node, "description");
  if (description) {
    lines.push("", truncate(description, DESCRIPTION_MAX));
  }

  const { properties, required } = collectProperties(index, node);
  const propNames = Object.keys(properties);
  if (propNames.length > 0) {
    lines.push("");
    const shown = propNames.slice(0, maxProps);
    for (const propName of shown) {
      const marker = required.has(propName) ? "*" : "";
      lines.push(`- ${propName}${marker}: ${describePropSchemaType(properties[propName])}`);
    }
    if (propNames.length > maxProps) {
      lines.push(`- …${propNames.length - maxProps} more`);
    }
  }

  return lines.join("\n");
}

/**
 * Describe a components/{responses,parameters,requestBodies,headers} node
 * (or, defensively, an operation node) as Markdown for hover on a non-schema
 * `$ref`.
 */
export function summarizeOperationNode(index: SpecIndex, pointer: string): string {
  const node = index.byPointer.get(pointer);
  if (!node) {
    return `Cannot resolve \`${pointer}\`.`;
  }

  const operation = index.operations.find((op) => op.pointer === pointer);
  if (operation) {
    const lines = [`**${operation.method.toUpperCase()} ${operation.path}**`];
    const description = getStringValue(node, "description") ?? getStringValue(node, "summary");
    if (description) {
      lines.push("", truncate(description, DESCRIPTION_MAX));
    }
    return lines.join("\n");
  }

  const segments = pointerToSegments(pointer);
  const name = segments.length ? segments[segments.length - 1] : pointer;
  const componentType = segments.length >= 2 ? segments[segments.length - 2] : undefined;

  if (componentType === "responses" || componentType === "requestBodies") {
    const label = componentType === "responses" ? "response" : "request body";
    const lines = [`**${name}** · ${label}`];
    const description = getStringValue(node, "description");
    if (description) {
      lines.push("", truncate(description, DESCRIPTION_MAX));
    }
    const contentTypes = getContentTypes(node);
    if (contentTypes.length) {
      lines.push("", `Content: ${contentTypes.join(", ")}`);
    }
    if (componentType === "requestBodies") {
      lines.push("", `required: ${getBooleanValue(node, "required") ? "true" : "false"}`);
    }
    return lines.join("\n");
  }

  if (componentType === "parameters") {
    const lines = [`**${name}** · parameter`];
    const parts: string[] = [];
    const nameValue = getStringValue(node, "name");
    if (nameValue) {
      parts.push(`name: ${nameValue}`);
    }
    const inValue = getStringValue(node, "in");
    if (inValue) {
      parts.push(`in: ${inValue}`);
    }
    parts.push(`required: ${getBooleanValue(node, "required") ? "true" : "false"}`);
    const schemaNode = childByKey(node, "schema");
    const schemaType = schemaNode ? getTypeValue(schemaNode) : undefined;
    if (schemaType) {
      parts.push(`type: ${schemaType}`);
    }
    lines.push("", parts.join(", "));
    const description = getStringValue(node, "description");
    if (description) {
      lines.push("", truncate(description, DESCRIPTION_MAX));
    }
    return lines.join("\n");
  }

  if (componentType === "headers") {
    const lines = [`**${name}** · header`];
    const description = getStringValue(node, "description");
    if (description) {
      lines.push("", truncate(description, DESCRIPTION_MAX));
    }
    const schemaNode = childByKey(node, "schema");
    const schemaType = schemaNode ? getTypeValue(schemaNode) : undefined;
    if (schemaType) {
      lines.push("", `type: ${schemaType}`);
    }
    return lines.join("\n");
  }

  const lines = [`**${name}**`];
  const description = getStringValue(node, "description");
  if (description) {
    lines.push("", truncate(description, DESCRIPTION_MAX));
  }
  return lines.join("\n");
}

/** Dispatch by component type to the schema summary or the operation summary. */
export function summarizeRefTarget(index: SpecIndex, pointer: string): string {
  if (pointer.startsWith("/components/schemas/")) {
    return summarizeSchemaNode(index, pointer);
  }
  if (
    pointer.startsWith("/components/responses/") ||
    pointer.startsWith("/components/parameters/") ||
    pointer.startsWith("/components/requestBodies/") ||
    pointer.startsWith("/components/headers/")
  ) {
    return summarizeOperationNode(index, pointer);
  }
  return `\`${pointer}\``;
}

function resolveToSchemaNode(index: SpecIndex, pointer: string): AstNode | undefined {
  let node = index.byPointer.get(pointer);
  const seen = new Set<string>();
  let depth = 0;
  while (node && node.kind === "object" && depth < MAX_DEPTH) {
    const refChild = childByKey(node, "$ref");
    if (!refChild || refChild.kind !== "string" || typeof refChild.value !== "string") {
      break;
    }
    if (seen.has(refChild.value)) {
      break;
    }
    seen.add(refChild.value);
    const next = resolveRef(index, refChild.value);
    if (!next) {
      break;
    }
    node = next;
    depth++;
  }
  return node;
}

function describeType(node: AstNode): string {
  if (childByKey(node, "oneOf")) {
    return "oneOf";
  }
  if (childByKey(node, "anyOf")) {
    return "anyOf";
  }
  if (childByKey(node, "allOf")) {
    return "allOf";
  }
  const type = getTypeValue(node);
  if (type) {
    return type;
  }
  return "object";
}

function getTypeValue(node: AstNode): string | undefined {
  const typeNode = childByKey(node, "type");
  if (!typeNode) {
    return undefined;
  }
  if (typeNode.kind === "string" && typeof typeNode.value === "string") {
    return typeNode.value;
  }
  if (typeNode.kind === "array" && typeNode.children) {
    const values = typeNode.children
      .filter((child) => child.kind === "string" && typeof child.value === "string")
      .map((child) => String(child.value));
    return values.length ? values.join(" | ") : undefined;
  }
  return undefined;
}

/**
 * Merge `.properties`/`.required` from `node` itself plus, for `allOf`, one
 * level of each branch (following at most one `$ref` per branch — nested
 * `allOf`/`$ref` inside a branch is intentionally not expanded further).
 */
function collectProperties(index: SpecIndex, node: AstNode): { properties: Record<string, AstNode>; required: Set<string> } {
  const properties: Record<string, AstNode> = {};
  const required = new Set<string>();

  const mergeFrom = (source: AstNode | undefined): void => {
    if (!source || source.kind !== "object") {
      return;
    }
    const propsNode = childByKey(source, "properties");
    if (propsNode && propsNode.kind === "object" && propsNode.children) {
      for (const prop of propsNode.children) {
        properties[String(prop.key)] = prop;
      }
    }
    const requiredNode = childByKey(source, "required");
    if (requiredNode && requiredNode.kind === "array" && requiredNode.children) {
      for (const item of requiredNode.children) {
        if (item.kind === "string" && typeof item.value === "string") {
          required.add(item.value);
        }
      }
    }
  };

  mergeFrom(node);

  const allOfNode = childByKey(node, "allOf");
  if (allOfNode && allOfNode.kind === "array" && allOfNode.children) {
    for (const branch of allOfNode.children) {
      let resolvedBranch: AstNode | undefined = branch;
      if (branch.kind === "object") {
        const refChild = childByKey(branch, "$ref");
        if (refChild && refChild.kind === "string" && typeof refChild.value === "string") {
          resolvedBranch = resolveRef(index, refChild.value) ?? branch;
        }
      }
      mergeFrom(resolvedBranch);
    }
  }

  return { properties, required };
}

function describePropSchemaType(propNode: AstNode): string {
  if (!propNode || propNode.kind !== "object") {
    return "unknown";
  }
  const refChild = childByKey(propNode, "$ref");
  if (refChild && refChild.kind === "string" && typeof refChild.value === "string") {
    const target = refToPointer(refChild.value);
    return target ? lastSegment(target) : "ref";
  }
  if (childByKey(propNode, "oneOf")) {
    return "oneOf";
  }
  if (childByKey(propNode, "anyOf")) {
    return "anyOf";
  }
  if (childByKey(propNode, "allOf")) {
    return "allOf";
  }
  const type = getTypeValue(propNode);
  if (type === "array") {
    const itemsNode = childByKey(propNode, "items");
    const itemType = itemsNode ? describePropSchemaType(itemsNode) : "unknown";
    return `${itemType}[]`;
  }
  if (type) {
    return type;
  }
  if (childByKey(propNode, "properties")) {
    return "object";
  }
  return "object";
}

function getContentTypes(node: AstNode): string[] {
  const contentNode = childByKey(node, "content");
  if (!contentNode || contentNode.kind !== "object" || !contentNode.children) {
    return [];
  }
  return contentNode.children.map((child) => String(child.key));
}

function getStringValue(node: AstNode, key: string): string | undefined {
  const child = childByKey(node, key);
  return child && child.kind === "string" && typeof child.value === "string" ? child.value : undefined;
}

function getBooleanValue(node: AstNode, key: string): boolean {
  const child = childByKey(node, key);
  return !!child && child.kind === "boolean" && child.value === true;
}

function lastSegment(pointer: string): string {
  const segments = pointerToSegments(pointer);
  return segments.length ? segments[segments.length - 1] : pointer;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "…";
}

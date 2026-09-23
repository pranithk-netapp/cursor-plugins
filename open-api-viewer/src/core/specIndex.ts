// Build a SpecIndex from a ParseResult in a single DFS. Pure, no vscode dependency.

import { AstNode, ComponentInfo, OperationInfo, ParseResult, RefSite, SpecIndex } from "./types";
import { walk, childByKey } from "./ast";
import { encodeSegment, decodeSegment, refToPointer } from "./pointer";

const COMPONENT_TYPES = [
  "schemas",
  "responses",
  "parameters",
  "examples",
  "requestBodies",
  "headers",
  "securitySchemes",
  "links",
  "callbacks",
];

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

const EMPTY_ROOT: AstNode = { kind: "null", offset: 0, length: 0, pointer: "" };

export function buildIndex(parseResult: ParseResult): SpecIndex {
  if (!parseResult.root) {
    return {
      version: "unknown",
      root: EMPTY_ROOT,
      value: parseResult.value,
      byPointer: new Map(),
      refs: [],
      refsByTarget: new Map(),
      components: new Map(),
      operations: [],
    };
  }

  const root = parseResult.root;
  const byPointer = new Map<string, AstNode>();
  const refs: RefSite[] = [];

  walk(root, (node) => {
    byPointer.set(node.pointer, node);
    if (node.kind === "string" && node.key === "$ref") {
      const target = String(node.value);
      refs.push({
        pointer: node.pointer,
        target,
        node,
        external: !target.startsWith("#"),
      });
    }
  });

  const refsByTarget = new Map<string, RefSite[]>();
  for (const ref of refs) {
    if (ref.external) {
      continue;
    }
    const pointer = refToPointer(ref.target);
    if (pointer === null) {
      continue;
    }
    const list = refsByTarget.get(pointer);
    if (list) {
      list.push(ref);
    } else {
      refsByTarget.set(pointer, [ref]);
    }
  }

  const components = buildComponents(root);
  const operations = buildOperations(root);
  const version = detectVersion(parseResult.value);

  return {
    version,
    root,
    value: parseResult.value,
    byPointer,
    refs,
    refsByTarget,
    components,
    operations,
  };
}

/** Reverse lookup: find the ComponentInfo (if any) whose own pointer is `pointer`. */
export function findComponentByPointer(index: SpecIndex, pointer: string): ComponentInfo | undefined {
  for (const info of index.components.values()) {
    if (info.pointer === pointer) {
      return info;
    }
  }
  return undefined;
}

function buildComponents(root: AstNode): Map<string, ComponentInfo> {
  const components = new Map<string, ComponentInfo>();
  const componentsNode = childByKey(root, "components");
  if (!componentsNode || componentsNode.kind !== "object") {
    return components;
  }

  for (const type of COMPONENT_TYPES) {
    const typeNode = childByKey(componentsNode, type);
    if (!typeNode || typeNode.kind !== "object" || !typeNode.children) {
      continue;
    }
    for (const entry of typeNode.children) {
      const name = String(entry.key);
      const pointer = "/components/" + encodeSegment(type) + "/" + encodeSegment(name);
      const key = type + "/" + name;
      components.set(key, { type, name, pointer, node: entry });
    }
  }

  return components;
}

function buildOperations(root: AstNode): OperationInfo[] {
  const operations: OperationInfo[] = [];
  const pathsNode = childByKey(root, "paths");
  if (!pathsNode || pathsNode.kind !== "object" || !pathsNode.children) {
    return operations;
  }

  for (const pathItem of pathsNode.children) {
    if (pathItem.kind !== "object" || !pathItem.children) {
      continue;
    }
    const encodedPath = String(pathItem.key);
    const path = decodeSegment(encodedPath);

    for (const method of HTTP_METHODS) {
      const opNode = childByKey(pathItem, method);
      if (!opNode) {
        continue;
      }
      const value = opNode.kind === "object" ? nodeToPlainValue(opNode) : undefined;
      operations.push({
        path,
        method,
        operationId: value?.operationId,
        pointer: opNode.pointer,
        node: opNode,
        keyOffset: opNode.keyOffset ?? opNode.offset,
        keyLength: opNode.keyLength ?? opNode.length,
      });
    }
  }

  return operations;
}

/** Minimal AstNode -> plain value conversion, only used to read operationId cheaply. */
function nodeToPlainValue(node: AstNode): any {
  if (node.kind === "object") {
    const obj: any = {};
    for (const child of node.children ?? []) {
      obj[String(child.key)] = nodeToPlainValue(child);
    }
    return obj;
  }
  if (node.kind === "array") {
    return (node.children ?? []).map(nodeToPlainValue);
  }
  return node.value;
}

function detectVersion(value: any): SpecIndex["version"] {
  const openapi = value?.openapi;
  if (typeof openapi === "string") {
    if (openapi.startsWith("3.1")) {
      return "3.1";
    }
    if (openapi.startsWith("3.0")) {
      return "3.0";
    }
  }
  if (value?.swagger === "2.0") {
    return "2.0";
  }
  return "unknown";
}

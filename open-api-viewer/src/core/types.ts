// Pure, vscode-free shared types for the OpenAPI parsing/indexing core.
// Nothing in src/core may import "vscode" so this module (and everything
// that depends on it) can run in plain Node for fast unit tests.

export type AstKind = "object" | "array" | "string" | "number" | "boolean" | "null";

/**
 * A unified positional AST node produced by either the JSON (jsonc-parser)
 * or YAML (yaml) parser. Object children are the *value* nodes of each
 * property (the property "wrapper" that jsonc-parser/yaml use internally is
 * flattened away) — key metadata lives on the child itself via `key`,
 * `keyOffset` and `keyLength`.
 */
export interface AstNode {
  kind: AstKind;
  offset: number;
  length: number;
  value?: unknown;
  parent?: AstNode;
  key?: string | number;
  keyOffset?: number;
  keyLength?: number;
  children?: AstNode[];
  /** RFC 6901 JSON Pointer from the document root to this node ("" for root). */
  pointer: string;
  /**
   * True for a YAML mapping/sequence written in flow style (`{a: 1}` /
   * `[1, 2]`). Always false/undefined for JSON nodes (JSON has no block
   * style) and for YAML scalars. src/core/insert.ts refuses to perform a
   * structural edit inside a flow-style YAML container.
   */
  isFlow?: boolean;
}

export type SpecLang = "json" | "yaml";

export interface ParseIssue {
  message: string;
  offset: number;
  length: number;
  severity: "error" | "warning";
}

export interface ParseResult {
  root: AstNode | undefined;
  value: any;
  errors: ParseIssue[];
  lang: SpecLang;
  text: string;
}

export interface RefSite {
  /** Pointer of the `$ref` string node itself (e.g. ".../$ref"). */
  pointer: string;
  /** Raw ref target string, e.g. "#/components/schemas/Foo" or "other.yaml#/X". */
  target: string;
  node: AstNode;
  external: boolean;
}

export interface ComponentInfo {
  type: string;
  name: string;
  pointer: string;
  node: AstNode;
}

export interface OperationInfo {
  path: string;
  method: string;
  operationId?: string;
  pointer: string;
  node: AstNode;
  keyOffset: number;
  keyLength: number;
}

export interface SpecIndex {
  version: "3.0" | "3.1" | "2.0" | "unknown";
  root: AstNode;
  value: any;
  byPointer: Map<string, AstNode>;
  refs: RefSite[];
  refsByTarget: Map<string, RefSite[]>;
  components: Map<string, ComponentInfo>;
  operations: OperationInfo[];
}

/**
 * A validation/diagnostic finding produced by src/core/validation. Both the
 * schema validator and the semantic rules produce these; src/vscode/
 * diagnostics.ts converts them (plus ParseIssues) into vscode.Diagnostic.
 */
export interface Issue {
  code: string;
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  offset: number;
  length: number;
  source: string;
}

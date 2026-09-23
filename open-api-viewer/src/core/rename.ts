// Pure rename edit computation for OpenAPI components: renaming a component
// rewrites its own definition key, every `$ref` whose target is EXACTLY
// that component's pointer (boundary-checked so a same-prefix/suffix name
// is never touched), and — for securitySchemes — every security
// requirement object key equal to the old name. No vscode dependency;
// src/vscode/rename.ts converts these offset/length/newText triples into
// vscode.TextEdit via document.positionAt.

import { AstNode, SpecIndex } from "./types";
import { childByKey } from "./ast";

export interface RenameEdit {
  offset: number;
  length: number;
  newText: string;
}

/**
 * Compute every text edit needed to rename `oldName` (a component of
 * `componentType`, e.g. "schemas", living at `componentPointer`) to
 * `newName`.
 */
export function computeRenameEdits(
  index: SpecIndex,
  text: string,
  componentPointer: string,
  componentType: string,
  oldName: string,
  newName: string
): RenameEdit[] {
  const edits: RenameEdit[] = [];

  const defNode = index.byPointer.get(componentPointer);
  if (defNode && defNode.keyOffset !== undefined && defNode.keyLength !== undefined) {
    const { offset, length } = unquoteRange(text, defNode.keyOffset, defNode.keyLength);
    edits.push({ offset, length, newText: newName });
  }

  const prefix = `#/components/${componentType}/${oldName}`;
  const prefixLength = prefix.length - oldName.length;
  const sites = index.refsByTarget.get(componentPointer) ?? [];
  for (const site of sites) {
    if (!matchesBoundary(site.target, prefix)) {
      continue;
    }
    const { offset: contentOffset } = unquoteRange(text, site.node.offset, site.node.length);
    edits.push({ offset: contentOffset + prefixLength, length: oldName.length, newText: newName });
  }

  if (componentType === "securitySchemes") {
    edits.push(...findSecurityKeyEdits(index, text, oldName, newName));
  }

  return edits;
}

/**
 * True when `target` is exactly `prefix`, or `prefix` followed by a "/" (a
 * further path segment) — never when `target` merely starts or ends with
 * `prefix`/`oldName` as a plain string prefix/suffix (e.g. renaming
 * "StandardError-404" must not touch a ref to
 * "StandardError-4040" or "OtherStandardError-404").
 */
function matchesBoundary(target: string, prefix: string): boolean {
  return target === prefix || target.startsWith(prefix + "/");
}

function findSecurityKeyEdits(index: SpecIndex, text: string, oldName: string, newName: string): RenameEdit[] {
  const edits: RenameEdit[] = [];
  collectFromSecurityArray(childByKey(index.root, "security"), text, oldName, newName, edits);
  for (const op of index.operations) {
    collectFromSecurityArray(childByKey(op.node, "security"), text, oldName, newName, edits);
  }
  return edits;
}

function collectFromSecurityArray(
  securityNode: AstNode | undefined,
  text: string,
  oldName: string,
  newName: string,
  edits: RenameEdit[]
): void {
  if (!securityNode || securityNode.kind !== "array" || !securityNode.children) {
    return;
  }
  for (const requirement of securityNode.children) {
    if (requirement.kind !== "object" || !requirement.children) {
      continue;
    }
    for (const entry of requirement.children) {
      if (entry.key === oldName && entry.keyOffset !== undefined && entry.keyLength !== undefined) {
        const { offset, length } = unquoteRange(text, entry.keyOffset, entry.keyLength);
        edits.push({ offset, length, newText: newName });
      }
    }
  }
}

/**
 * Strip a matching pair of surrounding quote characters from a raw
 * offset/length range, if present. JSON key/string ranges from jsonc-parser
 * always include the surrounding quotes; YAML key/string ranges from the
 * `yaml` package include them only for quoted scalars (a plain YAML
 * scalar's range is already quote-free). Detecting quotes dynamically from
 * the document text — rather than branching on language — handles both
 * parsers' conventions correctly without guessing.
 */
export function unquoteRange(text: string, offset: number, length: number): { offset: number; length: number } {
  if (length >= 2) {
    const first = text.charAt(offset);
    const last = text.charAt(offset + length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return { offset: offset + 1, length: length - 2 };
    }
  }
  return { offset, length };
}

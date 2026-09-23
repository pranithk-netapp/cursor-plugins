// Pure helpers operating on our unified AstNode shape. No vscode dependency.

import { AstNode } from "./types";

/**
 * Find the deepest AstNode whose range [offset, offset+length] contains the
 * given offset. Ranges are end-inclusive so callers can query the position
 * right after the last character of a value.
 */
export function findNodeAtOffset(root: AstNode, offset: number): AstNode | undefined {
  if (offset < root.offset || offset > root.offset + root.length) {
    return undefined;
  }
  if (root.children) {
    for (const child of root.children) {
      const found = findNodeAtOffset(child, offset);
      if (found) {
        return found;
      }
    }
  }
  return root;
}

/**
 * Like `findNodeAtOffset`, but also recognizes an offset that falls within a
 * *key's* range rather than any child's value range. `findNodeAtOffset`
 * alone can never land "on" a key: a key's text sits before its value's own
 * [offset, offset+length), so when the offset is over key text, none of the
 * deepest node's children match and the deepest node's *own* value range is
 * returned instead (its immediate parent, one level up from the key). This
 * helper does that same lookup, then — since a key can only ever belong to
 * a direct child of the node `findNodeAtOffset` lands on — checks that
 * node's direct children for a `keyOffset`/`keyLength` range containing the
 * offset, returning `{ node: child, isKey: true }` when found.
 */
export function findNodeOrKeyAtOffset(root: AstNode, offset: number): { node: AstNode; isKey: boolean } | undefined {
  const node = findNodeAtOffset(root, offset);
  if (!node) {
    return undefined;
  }
  if (node.children) {
    for (const child of node.children) {
      if (
        child.keyOffset !== undefined &&
        child.keyLength !== undefined &&
        offset >= child.keyOffset &&
        offset <= child.keyOffset + child.keyLength
      ) {
        return { node: child, isKey: true };
      }
    }
  }
  return { node, isKey: false };
}

/** For an object-kind node, find the child whose `.key` matches. */
export function childByKey(node: AstNode, key: string): AstNode | undefined {
  if (node.kind !== "object" || !node.children) {
    return undefined;
  }
  return node.children.find((child) => child.key === key);
}

/** Walk up the parent chain collecting `.key`s, root-first. */
export function getPath(node: AstNode): (string | number)[] {
  const path: (string | number)[] = [];
  let current: AstNode | undefined = node;
  while (current) {
    if (current.key !== undefined) {
      path.push(current.key);
    }
    current = current.parent;
  }
  return path.reverse();
}

/** Pre-order depth-first traversal over a node and its descendants. */
export function walk(root: AstNode, visit: (node: AstNode) => void): void {
  visit(root);
  if (root.children) {
    for (const child of root.children) {
      walk(child, visit);
    }
  }
}

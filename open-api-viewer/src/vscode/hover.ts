import * as vscode from "vscode";
import { findNodeOrKeyAtOffset } from "../core/ast";
import { refToPointer } from "../core/pointer";
import { findComponentByPointer } from "../core/specIndex";
import { summarizeRefTarget } from "../core/summary";
import { isOpenApiDocument } from "./detector";
import { DocumentCache } from "./documentCache";
import { rangeOfNode } from "./rangeUtils";

export class OpenApiHoverProvider implements vscode.HoverProvider {
  constructor(private readonly cache: DocumentCache) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    if (!isOpenApiDocument(document)) {
      return undefined;
    }
    const { index } = this.cache.get(document);
    const offset = document.offsetAt(position);
    const found = findNodeOrKeyAtOffset(index.root, offset);
    if (!found) {
      return undefined;
    }
    const { node, isKey } = found;

    // Bonus: hovering directly over a component's own key.
    if (isKey) {
      const component = findComponentByPointer(index, node.pointer);
      if (!component) {
        return undefined;
      }
      const refCount = index.refsByTarget.get(component.pointer)?.length ?? 0;
      const md = `${summarizeRefTarget(index, component.pointer)}\n\nReferenced by ${refCount} location(s)`;
      return new vscode.Hover(new vscode.MarkdownString(md), rangeOfNode(document, node));
    }

    if (node.key === "$ref" && node.kind === "string" && typeof node.value === "string") {
      const pointer = refToPointer(node.value);
      if (pointer === null) {
        return undefined;
      }
      const md = summarizeRefTarget(index, pointer);
      return new vscode.Hover(new vscode.MarkdownString(md), rangeOfNode(document, node));
    }

    return undefined;
  }
}

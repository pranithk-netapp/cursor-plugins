import * as vscode from "vscode";
import { findNodeOrKeyAtOffset } from "../core/ast";
import { refToPointer } from "../core/pointer";
import { findComponentByPointer } from "../core/specIndex";
import { isOpenApiDocument } from "./detector";
import { DocumentCache } from "./documentCache";
import { rangeOfNode } from "./rangeUtils";

export class OpenApiReferenceProvider implements vscode.ReferenceProvider {
  constructor(private readonly cache: DocumentCache) {}

  provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext
  ): vscode.Location[] {
    if (!isOpenApiDocument(document)) {
      return [];
    }
    const { index } = this.cache.get(document);
    const offset = document.offsetAt(position);
    const found = findNodeOrKeyAtOffset(index.root, offset);
    if (!found) {
      return [];
    }
    const { node, isKey } = found;

    let targetPointer: string | undefined;
    if (isKey) {
      targetPointer = findComponentByPointer(index, node.pointer)?.pointer;
    } else if (node.key === "$ref" && node.kind === "string" && typeof node.value === "string") {
      const pointer = refToPointer(node.value);
      targetPointer = pointer === null ? undefined : pointer;
    }
    if (!targetPointer) {
      return [];
    }

    const sites = index.refsByTarget.get(targetPointer) ?? [];
    const locations = sites.map((site) => new vscode.Location(document.uri, rangeOfNode(document, site.node)));

    if (context.includeDeclaration) {
      const defNode = index.byPointer.get(targetPointer);
      if (defNode) {
        locations.push(new vscode.Location(document.uri, rangeOfNode(document, defNode)));
      }
    }

    return locations;
  }
}

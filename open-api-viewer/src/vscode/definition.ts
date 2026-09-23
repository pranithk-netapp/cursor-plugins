import * as vscode from "vscode";
import { findNodeAtOffset } from "../core/ast";
import { resolveRef } from "../core/resolve";
import { isOpenApiDocument } from "./detector";
import { DocumentCache } from "./documentCache";
import { rangeOfNode } from "./rangeUtils";

export class OpenApiDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly cache: DocumentCache) {}

  provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.Definition | undefined {
    if (!isOpenApiDocument(document)) {
      return undefined;
    }
    const { index } = this.cache.get(document);
    const offset = document.offsetAt(position);
    const node = findNodeAtOffset(index.root, offset);
    if (!node || node.key !== "$ref" || node.kind !== "string" || typeof node.value !== "string") {
      return undefined;
    }
    const target = resolveRef(index, node.value);
    if (!target) {
      return undefined;
    }
    return new vscode.Location(document.uri, rangeOfNode(document, target));
  }
}

import * as vscode from "vscode";
import { AstNode } from "../core/types";
import { childByKey } from "../core/ast";
import { isOpenApiDocument } from "./detector";
import { DocumentCache } from "./documentCache";
import { fullRangeOfNode, rangeOfNode } from "./rangeUtils";

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

export class OpenApiDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  constructor(private readonly cache: DocumentCache) {}

  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] | undefined {
    if (!isOpenApiDocument(document)) {
      return undefined;
    }
    const { index } = this.cache.get(document);
    const root = index.root;
    const symbols: vscode.DocumentSymbol[] = [];

    const infoNode = childByKey(root, "info");
    if (infoNode) {
      symbols.push(makeSymbol(document, "Info", vscode.SymbolKind.Namespace, infoNode));
    }

    const serversNode = childByKey(root, "servers");
    if (serversNode && serversNode.children && serversNode.children.length > 0) {
      symbols.push(makeSymbol(document, "Servers", vscode.SymbolKind.Array, serversNode));
    }

    const pathsNode = childByKey(root, "paths");
    if (pathsNode && pathsNode.children) {
      const pathsSymbol = makeSymbol(document, "Paths", vscode.SymbolKind.Namespace, pathsNode);
      pathsSymbol.children = pathsNode.children.map((pathItem) => buildPathSymbol(document, pathItem));
      symbols.push(pathsSymbol);
    }

    const componentsNode = childByKey(root, "components");
    if (componentsNode && componentsNode.children) {
      const componentsSymbol = makeSymbol(document, "Components", vscode.SymbolKind.Namespace, componentsNode);
      componentsSymbol.children = componentsNode.children.map((groupNode) => buildComponentGroupSymbol(document, groupNode));
      symbols.push(componentsSymbol);
    }

    return symbols;
  }
}

function makeSymbol(
  document: vscode.TextDocument,
  name: string,
  kind: vscode.SymbolKind,
  node: AstNode
): vscode.DocumentSymbol {
  return new vscode.DocumentSymbol(name, "", kind, fullRangeOfNode(document, node), rangeOfNode(document, node));
}

function buildPathSymbol(document: vscode.TextDocument, pathItem: AstNode): vscode.DocumentSymbol {
  const name = String(pathItem.key ?? "");
  const symbol = makeSymbol(document, name, vscode.SymbolKind.Namespace, pathItem);
  const children: vscode.DocumentSymbol[] = [];
  for (const opNode of pathItem.children ?? []) {
    const method = String(opNode.key ?? "");
    if (!HTTP_METHODS.includes(method)) {
      continue;
    }
    const operationId = getOperationId(opNode);
    const label = `${method.toUpperCase()} ${operationId ?? ""}`.trim();
    children.push(makeSymbol(document, label, vscode.SymbolKind.Method, opNode));
  }
  symbol.children = children;
  return symbol;
}

function getOperationId(opNode: AstNode): string | undefined {
  const idNode = childByKey(opNode, "operationId");
  return idNode && idNode.kind === "string" && typeof idNode.value === "string" ? idNode.value : undefined;
}

function buildComponentGroupSymbol(document: vscode.TextDocument, groupNode: AstNode): vscode.DocumentSymbol {
  const typeName = String(groupNode.key ?? "");
  const symbol = makeSymbol(document, typeName, vscode.SymbolKind.Interface, groupNode);
  symbol.children = (groupNode.children ?? []).map((entry) => {
    const name = String(entry.key ?? "");
    const kind = typeName === "schemas" ? vscode.SymbolKind.Struct : vscode.SymbolKind.Class;
    return makeSymbol(document, name, kind, entry);
  });
  return symbol;
}

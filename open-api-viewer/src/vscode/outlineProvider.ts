import * as vscode from "vscode";
import { AstNode, SpecIndex } from "../core/types";
import { childByKey } from "../core/ast";
import { encodeSegment } from "../core/pointer";
import { isOpenApiDocument } from "./detector";
import { DocumentCache } from "./documentCache";
import { rangeOfNode } from "./rangeUtils";

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

export interface OutlineNode {
  id: string;
  label: string;
  description?: string;
  kind:
    | "root"
    | "info"
    | "servers"
    | "server"
    | "tags"
    | "tag"
    | "paths"
    | "path"
    | "operation"
    | "components"
    | "componentGroup"
    | "component"
    | "security";
  pointer?: string;
  children?: OutlineNode[];
  contextValue?: string;
}

/**
 * Tree view for the "Outline" activity-bar view. Tracks the active editor's
 * OpenAPI document (if any) and rebuilds on `cache.onDidChange`. `TreeItem.id`
 * is always pointer-derived (never an array index) so VS Code's built-in
 * expansion-state persistence keeps working across rebuilds.
 */
export class OpenApiOutlineProvider implements vscode.TreeDataProvider<OutlineNode> {
  private readonly emitter = new vscode.EventEmitter<OutlineNode | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  private activeDocument: vscode.TextDocument | undefined;
  private fullTree: OutlineNode[] = [];
  private filterText = "";
  private filteredTree: OutlineNode[] | undefined;

  constructor(private readonly cache: DocumentCache) {}

  /** Wire up active-editor tracking and cache invalidation. Call once from extension.ts. */
  attachListeners(context: vscode.ExtensionContext): void {
    this.setActiveEditor(vscode.window.activeTextEditor);
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => this.setActiveEditor(editor)),
      this.cache.onDidChange((uri) => {
        if (this.activeDocument && this.activeDocument.uri.toString() === uri.toString()) {
          this.rebuild();
        }
      })
    );
  }

  getActiveDocument(): vscode.TextDocument | undefined {
    return this.activeDocument;
  }

  refresh(): void {
    this.rebuild();
  }

  setFilter(text: string): void {
    this.filterText = text.trim().toLowerCase();
    this.applyFilter();
    this.emitter.fire();
  }

  clearFilter(): void {
    this.filterText = "";
    this.filteredTree = undefined;
    this.emitter.fire();
  }

  isFiltered(): boolean {
    return this.filterText.length > 0;
  }

  getTreeItem(node: OutlineNode): vscode.TreeItem {
    const hasChildren = !!node.children && node.children.length > 0;
    const item = new vscode.TreeItem(
      node.label,
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    item.id = node.id;
    item.description = node.description;
    item.contextValue = node.contextValue ?? node.kind;
    item.iconPath = iconForKind(node.kind);
    if (!hasChildren && (node.kind === "operation" || node.kind === "component") && node.pointer && this.activeDocument) {
      item.command = {
        command: "openapiViewer.revealRange",
        title: "Reveal in editor",
        arguments: [this.activeDocument.uri, node.pointer],
      };
    }
    return item;
  }

  getChildren(node?: OutlineNode): OutlineNode[] {
    const tree = this.filteredTree ?? this.fullTree;
    return node ? node.children ?? [] : tree;
  }

  private setActiveEditor(editor: vscode.TextEditor | undefined): void {
    this.activeDocument = editor && isOpenApiDocument(editor.document) ? editor.document : undefined;
    this.rebuild();
  }

  private rebuild(): void {
    this.fullTree = this.activeDocument ? buildTree(this.cache.get(this.activeDocument).index) : [];
    this.applyFilter();
    this.emitter.fire();
  }

  private applyFilter(): void {
    this.filteredTree = this.filterText ? filterTree(this.fullTree, this.filterText) : undefined;
  }
}

function iconForKind(kind: OutlineNode["kind"]): vscode.ThemeIcon {
  switch (kind) {
    case "operation":
      return new vscode.ThemeIcon("symbol-method");
    case "component":
      return new vscode.ThemeIcon("symbol-class");
    case "componentGroup":
    case "components":
    case "paths":
    case "path":
      return new vscode.ThemeIcon("symbol-namespace");
    case "info":
      return new vscode.ThemeIcon("info");
    case "servers":
    case "server":
      return new vscode.ThemeIcon("server-environment");
    case "tags":
    case "tag":
      return new vscode.ThemeIcon("tag");
    case "security":
      return new vscode.ThemeIcon("shield");
    default:
      return new vscode.ThemeIcon("symbol-namespace");
  }
}

function buildTree(index: SpecIndex): OutlineNode[] {
  const nodes: OutlineNode[] = [];
  const root = index.root;

  const infoNode = childByKey(root, "info");
  if (infoNode) {
    const title = getStringChild(infoNode, "title");
    const version = getStringChild(infoNode, "version");
    nodes.push({
      id: "info",
      label: "Info",
      description: [title, version].filter(Boolean).join(" · "),
      kind: "info",
      pointer: infoNode.pointer,
      contextValue: "info",
    });
  }

  const serversNode = childByKey(root, "servers");
  if (serversNode && serversNode.kind === "array" && serversNode.children && serversNode.children.length > 0) {
    nodes.push({
      id: "servers",
      label: "Servers",
      kind: "servers",
      contextValue: "servers",
      children: serversNode.children.map((serverNode, i) => ({
        id: `servers/${i}`,
        label: getStringChild(serverNode, "url") ?? `Server ${i}`,
        kind: "server" as const,
        pointer: serverNode.pointer,
        contextValue: "server",
      })),
    });
  }

  const tagNames = collectTagNames(index);
  if (tagNames.length > 0) {
    nodes.push({
      id: "tags",
      label: "Tags",
      kind: "tags",
      contextValue: "tags",
      children: tagNames.map((tag) => ({
        id: `tags/${encodeSegment(tag)}`,
        label: tag,
        kind: "tag" as const,
        contextValue: "tag",
      })),
    });
  }

  const pathsNode = childByKey(root, "paths");
  if (pathsNode && pathsNode.children) {
    nodes.push({
      id: "paths",
      label: "Paths",
      kind: "paths",
      pointer: pathsNode.pointer,
      contextValue: "paths",
      children: pathsNode.children.map((pathItem) => buildPathNode(pathItem)),
    });
  }

  const componentsNode = childByKey(root, "components");
  if (componentsNode && componentsNode.children) {
    nodes.push({
      id: "components",
      label: "Components",
      kind: "components",
      pointer: componentsNode.pointer,
      contextValue: "components",
      children: componentsNode.children.map((groupNode) => buildComponentGroupNode(groupNode)),
    });
  }

  const securityNode = childByKey(root, "security");
  if (securityNode && securityNode.kind === "array" && securityNode.children && securityNode.children.length > 0) {
    nodes.push({
      id: "security",
      label: "Security",
      kind: "security",
      pointer: securityNode.pointer,
      contextValue: "security",
    });
  }

  return nodes;
}

function buildPathNode(pathItem: AstNode): OutlineNode {
  const pathName = String(pathItem.key ?? "");
  const children: OutlineNode[] = [];
  for (const opNode of pathItem.children ?? []) {
    const method = String(opNode.key ?? "");
    if (!HTTP_METHODS.includes(method)) {
      continue;
    }
    const operationId = getStringChild(opNode, "operationId");
    children.push({
      id: opNode.pointer,
      label: `${method.toUpperCase()} ${operationId ?? ""}`.trim(),
      kind: "operation",
      pointer: opNode.pointer,
      contextValue: "operation",
    });
  }
  return {
    id: pathItem.pointer,
    label: pathName,
    kind: "path",
    pointer: pathItem.pointer,
    contextValue: "path",
    children,
  };
}

function buildComponentGroupNode(groupNode: AstNode): OutlineNode {
  const typeName = String(groupNode.key ?? "");
  const entries = groupNode.children ?? [];
  return {
    id: groupNode.pointer,
    label: typeName,
    description: `${entries.length}`,
    kind: "componentGroup",
    pointer: groupNode.pointer,
    contextValue: "componentGroup",
    children: entries.map((entry) => ({
      id: entry.pointer,
      label: String(entry.key ?? ""),
      kind: "component" as const,
      pointer: entry.pointer,
      contextValue: "component",
    })),
  };
}

function collectTagNames(index: SpecIndex): string[] {
  const tags = new Set<string>();
  for (const op of index.operations) {
    const tagsNode = childByKey(op.node, "tags");
    if (tagsNode && tagsNode.kind === "array" && tagsNode.children) {
      for (const tagNode of tagsNode.children) {
        if (tagNode.kind === "string" && typeof tagNode.value === "string") {
          tags.add(tagNode.value);
        }
      }
    }
  }
  return Array.from(tags).sort();
}

function getStringChild(node: AstNode, key: string): string | undefined {
  const child = childByKey(node, key);
  return child && child.kind === "string" && typeof child.value === "string" ? child.value : undefined;
}

function filterTree(nodes: OutlineNode[], filterText: string): OutlineNode[] {
  const result: OutlineNode[] = [];
  for (const node of nodes) {
    const selfMatches = matchesFilter(node, filterText);
    const filteredChildren = node.children ? filterTree(node.children, filterText) : undefined;
    if (selfMatches || (filteredChildren && filteredChildren.length > 0)) {
      result.push({ ...node, children: selfMatches ? node.children : filteredChildren });
    }
  }
  return result;
}

function matchesFilter(node: OutlineNode, filterText: string): boolean {
  const haystack = `${node.label} ${node.description ?? ""}`.toLowerCase();
  return haystack.includes(filterText);
}

/**
 * Register the outline's commands: filter, clearFilter, refresh and
 * revealRange. `openapiViewer.outlineFiltered` is kept in sync with
 * `provider.isFiltered()` so `menus.view/title`'s `when` clauses can swap
 * the filter/clearFilter buttons.
 */
export function registerOutlineCommands(
  context: vscode.ExtensionContext,
  provider: OpenApiOutlineProvider,
  cache: DocumentCache
): void {
  const setFilteredContext = (value: boolean) =>
    vscode.commands.executeCommand("setContext", "openapiViewer.outlineFiltered", value);

  context.subscriptions.push(
    vscode.commands.registerCommand("openapiViewer.outline.filter", async () => {
      const text = await vscode.window.showInputBox({
        prompt: "Filter the OpenAPI outline",
        placeHolder: "Type to filter by label",
      });
      if (text === undefined) {
        return;
      }
      provider.setFilter(text);
      await setFilteredContext(provider.isFiltered());
    }),
    vscode.commands.registerCommand("openapiViewer.outline.clearFilter", async () => {
      provider.clearFilter();
      await setFilteredContext(false);
    }),
    vscode.commands.registerCommand("openapiViewer.outline.refresh", () => {
      provider.refresh();
    }),
    vscode.commands.registerCommand("openapiViewer.revealRange", async (uri: vscode.Uri, pointer: string) => {
      await revealRange(cache, uri, pointer);
    })
  );
}

async function revealRange(cache: DocumentCache, uri: vscode.Uri, pointer: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  let editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString());
  if (!editor) {
    editor = await vscode.window.showTextDocument(document, { preview: false });
  }
  const { index } = cache.get(document);
  const node = index.byPointer.get(pointer);
  if (!node) {
    return;
  }
  const range = rangeOfNode(editor.document, node);
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

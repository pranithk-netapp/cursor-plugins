import * as vscode from "vscode";
import { findNodeOrKeyAtOffset } from "../core/ast";
import { refToPointer } from "../core/pointer";
import { computeRenameEdits, unquoteRange } from "../core/rename";
import { findComponentByPointer } from "../core/specIndex";
import { isOpenApiDocument } from "./detector";
import { DocumentCache } from "./documentCache";

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

interface RenameTarget {
  componentPointer: string;
  componentType: string;
  oldName: string;
  range: vscode.Range;
}

export class OpenApiRenameProvider implements vscode.RenameProvider {
  constructor(private readonly cache: DocumentCache) {}

  prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position
  ): { range: vscode.Range; placeholder: string } {
    const target = this.resolveTarget(document, position);
    if (!target) {
      throw new Error("This element cannot be renamed.");
    }
    return { range: target.range, placeholder: target.oldName };
  }

  provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string
  ): vscode.WorkspaceEdit {
    if (!NAME_PATTERN.test(newName)) {
      throw new Error("Component names may only contain letters, digits, '.', '_' and '-'.");
    }
    const target = this.resolveTarget(document, position);
    if (!target) {
      throw new Error("This element cannot be renamed.");
    }

    const { index } = this.cache.get(document);
    const text = document.getText();
    const rawEdits = computeRenameEdits(index, text, target.componentPointer, target.componentType, target.oldName, newName);

    const edit = new vscode.WorkspaceEdit();
    for (const rawEdit of rawEdits) {
      const range = new vscode.Range(
        document.positionAt(rawEdit.offset),
        document.positionAt(rawEdit.offset + rawEdit.length)
      );
      edit.replace(document.uri, range, rawEdit.newText);
    }
    return edit;
  }

  private resolveTarget(document: vscode.TextDocument, position: vscode.Position): RenameTarget | undefined {
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
    const text = document.getText();

    if (isKey) {
      if (node.keyOffset === undefined || node.keyLength === undefined) {
        return undefined;
      }
      const component = findComponentByPointer(index, node.pointer);
      if (!component) {
        return undefined;
      }
      const { offset: nameOffset, length: nameLength } = unquoteRange(text, node.keyOffset, node.keyLength);
      return {
        componentPointer: component.pointer,
        componentType: component.type,
        oldName: component.name,
        range: toVscodeRange(document, nameOffset, nameLength),
      };
    }

    if (node.key === "$ref" && node.kind === "string" && typeof node.value === "string") {
      const pointer = refToPointer(node.value);
      if (pointer === null) {
        return undefined;
      }
      const component = findComponentByPointer(index, pointer);
      if (!component) {
        return undefined;
      }
      const { offset: nameOffset, length: fullLength } = unquoteRange(text, node.offset, node.length);
      // The ref content is exactly "#/components/<type>/<name>" for a
      // renameable target (findComponentByPointer only matches an EXACT
      // component pointer), so the name occupies the tail of the content.
      const nameLength = component.name.length;
      const nameStart = nameOffset + fullLength - nameLength;
      return {
        componentPointer: component.pointer,
        componentType: component.type,
        oldName: component.name,
        range: toVscodeRange(document, nameStart, nameLength),
      };
    }

    return undefined;
  }
}

function toVscodeRange(document: vscode.TextDocument, offset: number, length: number): vscode.Range {
  return new vscode.Range(document.positionAt(offset), document.positionAt(offset + length));
}

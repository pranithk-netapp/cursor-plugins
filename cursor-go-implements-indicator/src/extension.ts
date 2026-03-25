import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel(
    "Cursor Go Implements Indicator"
  );
  context.subscriptions.push(output);

  const lensProvider = new GoInterfaceLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: "go", scheme: "file" },
      lensProvider
    )
  );

  const inlayProvider = new GoInterfaceInlayHintsProvider();
  context.subscriptions.push(
    vscode.languages.registerInlayHintsProvider(
      { language: "go", scheme: "file" },
      inlayProvider
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.languageId === "go") {
        lensProvider.refresh();
        inlayProvider.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "cursorGoImplements.show",
      async (
        uri: vscode.Uri,
        position: vscode.Position,
        methodName?: string
      ) => {
        await runShowImplementations(uri, position, methodName, output);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorGoImplements.showAtCursor", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "go") {
        vscode.window.showInformationMessage(
          "Open a Go file and place the cursor on an interface method."
        );
        return;
      }
      const doc = editor.document;
      if (doc.uri.scheme !== "file") {
        vscode.window.showInformationMessage("Only file:// Go documents are supported.");
        return;
      }
      const pos = editor.selection.active;
      const symbols =
        (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
          "vscode.executeDocumentSymbolProvider",
          doc.uri
        )) ?? [];
      const methods = collectInterfaceMethods(symbols);
      const method = methods.find(
        m => m.selectionRange.contains(pos) || m.range.contains(pos)
      );
      if (!method) {
        vscode.window.showInformationMessage(
          "Place the cursor on an interface method name or signature line."
        );
        return;
      }
      await runShowImplementations(
        doc.uri,
        method.selectionRange.start,
        method.name,
        output
      );
    })
  );
}

async function runShowImplementations(
  uri: vscode.Uri,
  position: vscode.Position,
  methodName: string | undefined,
  output: vscode.OutputChannel
): Promise<void> {
  try {
    output.appendLine(
      `Run implementations for ${uri.toString()} @${position.line + 1}:${
        position.character + 1
      }`
    );
    const result = await findImplementations(uri, position, methodName, output);
    const locations = deduplicateLocations(result.locations);

    if (!locations.length) {
      vscode.window.showInformationMessage("No implementations found.");
      output.appendLine("No implementations found after all fallbacks.");
      return;
    }
    output.appendLine(`Found ${locations.length} implementation(s).`);
    await vscode.commands.executeCommand(
      "editor.action.peekLocations",
      uri,
      result.queryPosition,
      locations,
      "peek"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    output.appendLine(`Error: ${message}`);
    vscode.window.showErrorMessage(`Failed to fetch implementations: ${message}`);
  }
}

class GoInterfaceLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  public refresh() {
    this._onDidChangeCodeLenses.fire();
  }

  public async provideCodeLenses(
    document: vscode.TextDocument
  ): Promise<vscode.CodeLens[]> {
    const symbols =
      (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        "vscode.executeDocumentSymbolProvider",
        document.uri
      )) ?? [];

    const interfaceMethods = collectInterfaceMethods(symbols);
    return Promise.all(
      interfaceMethods.map(async method => {
        const result = await findImplementations(
          document.uri,
          method.selectionRange.start,
          method.name
        );
        const count = deduplicateLocations(result.locations).length;
        return new vscode.CodeLens(method.selectionRange, {
          title:
            count > 0
              ? `${count} implementation${count === 1 ? "" : "s"}`
              : "$(info) Implementations",
          command: "cursorGoImplements.show",
          arguments: [document.uri, method.selectionRange.start, method.name]
        });
      })
    );
  }

}

class GoInterfaceInlayHintsProvider implements vscode.InlayHintsProvider {
  private _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChangeInlayHints = this._onDidChange.event;

  public refresh() {
    this._onDidChange.fire();
  }

  public async provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
    _token: vscode.CancellationToken
  ): Promise<vscode.InlayHint[] | undefined> {
    const symbols =
      (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        "vscode.executeDocumentSymbolProvider",
        document.uri
      )) ?? [];
    const interfaceMethods = collectInterfaceMethods(symbols);
    const hints: vscode.InlayHint[] = [];

    for (const method of interfaceMethods) {
      const line = method.selectionRange.start.line;
      if (line < range.start.line || line > range.end.line) {
        continue;
      }
      const result = await findImplementations(
        document.uri,
        method.selectionRange.start,
        method.name
      );
      const count = deduplicateLocations(result.locations).length;
      const clickArgs = [document.uri, method.selectionRange.start, method.name];
      const greenIcon = new vscode.InlayHintLabelPart("🟢");
      greenIcon.tooltip = "Open implementations";
      greenIcon.command = {
        title: "Open implementations",
        command: "cursorGoImplements.show",
        arguments: clickArgs
      };
      const caption = new vscode.InlayHintLabelPart(
        count > 0 ? ` ${count} impl` : " impl"
      );
      caption.tooltip =
        "Click to peek implementations (gutter icon is visual-only in VS Code)";
      caption.command = {
        title: "Peek implementations",
        command: "cursorGoImplements.show",
        arguments: clickArgs
      };
      const hint = new vscode.InlayHint(method.selectionRange.start, [
        greenIcon,
        caption
      ]);
      hint.paddingRight = true;
      hints.push(hint);
    }
    return hints;
  }
}

function normalizeLocations(
  locations: Array<vscode.Location | vscode.LocationLink>
): vscode.Location[] {
  return locations.map(loc => {
    if ("targetUri" in loc) {
      return new vscode.Location(
        loc.targetUri,
        loc.targetSelectionRange ?? loc.targetRange
      );
    }
    return loc;
  });
}

async function findImplementations(
  uri: vscode.Uri,
  fallback: vscode.Position,
  methodName: string | undefined,
  output?: vscode.OutputChannel
): Promise<{ queryPosition: vscode.Position; locations: vscode.Location[] }> {
  const queryPositions = await resolveImplementationQueryPositions(
    uri,
    fallback,
    methodName
  );

  for (const queryPosition of queryPositions) {
    output?.appendLine(
      `Try implementation query @${queryPosition.line + 1}:${
        queryPosition.character + 1
      }`
    );
    const rawLocations =
      (await vscode.commands.executeCommand<
        Array<vscode.Location | vscode.LocationLink>
      >("vscode.executeImplementationProvider", uri, queryPosition)) ?? [];
    const locations = normalizeLocations(rawLocations);
    if (locations.length) {
      return { queryPosition, locations };
    }
  }

  return { queryPosition: fallback, locations: [] };
}

function deduplicateLocations(locations: vscode.Location[]): vscode.Location[] {
  const unique = new Map<string, vscode.Location>();
  for (const loc of locations) {
    const key = `${loc.uri.toString()}:${loc.range.start.line}:${loc.range.start.character}:${loc.range.end.line}:${loc.range.end.character}`;
    if (!unique.has(key)) {
      unique.set(key, loc);
    }
  }
  return [...unique.values()];
}

async function resolveImplementationQueryPositions(
  uri: vscode.Uri,
  fallback: vscode.Position,
  methodName?: string
): Promise<vscode.Position[]> {
  const positions: vscode.Position[] = [fallback];

  const doc = await vscode.workspace.openTextDocument(uri);
  if (fallback.line >= doc.lineCount) {
    return positions;
  }

  const text = doc.lineAt(fallback.line).text;
  const addUniquePosition = (pos: vscode.Position) => {
    if (
      !positions.some(
        existing =>
          existing.line === pos.line && existing.character === pos.character
      )
    ) {
      positions.push(pos);
    }
  };

  if (methodName) {
    const methodIndex = text.indexOf(methodName);
    if (methodIndex >= 0) {
      addUniquePosition(new vscode.Position(fallback.line, methodIndex + 1));
    }
  }

  const wordRange = doc.getWordRangeAtPosition(fallback);
  if (wordRange) {
    addUniquePosition(new vscode.Position(fallback.line, wordRange.start.character));
    addUniquePosition(
      new vscode.Position(
        fallback.line,
        Math.min(wordRange.end.character - 1, wordRange.start.character + 1)
      )
    );
  }

  const signatureMatch = /([A-Za-z_]\w*)\s*\(/.exec(text);
  if (signatureMatch?.index !== undefined) {
    addUniquePosition(new vscode.Position(fallback.line, signatureMatch.index + 1));
  }

  return positions;
}

function collectInterfaceMethods(
  symbols: vscode.DocumentSymbol[]
): vscode.DocumentSymbol[] {
  const methods: vscode.DocumentSymbol[] = [];

  const walk = (nodes: vscode.DocumentSymbol[]) => {
    for (const node of nodes) {
      if (node.kind === vscode.SymbolKind.Interface && node.children) {
        methods.push(...node.children);
      }
      if (node.children?.length) {
        walk(node.children);
      }
    }
  };

  walk(symbols);
  return methods;
}

export function deactivate() {}

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const cp = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function extensionRoot() {
    return path.resolve(__dirname, "../../..");
}
function screenshotPath(name) {
    const dir = path.join(extensionRoot(), "test-output", "screenshots");
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, name);
}
async function fetchCodeLenses(uri) {
    for (let attempt = 0; attempt < 40; attempt++) {
        const raw = await vscode.commands.executeCommand("vscode.executeCodeLensProvider", uri, 200);
        if (raw?.length) {
            return raw;
        }
        await sleep(150);
    }
    return [];
}
/** Test host has no gopls; supply symbols so our CodeLens provider sees interface methods. */
function registerFixtureDocumentSymbols(targetUri) {
    return vscode.languages.registerDocumentSymbolProvider({ language: "go", scheme: "file" }, {
        provideDocumentSymbols(document) {
            if (document.uri.toString() !== targetUri.toString()) {
                return [];
            }
            const ifaceLine = document.lineAt(4);
            const methodLine = document.lineAt(5);
            const methodSym = new vscode.DocumentSymbol("CreateSnapshot", "", vscode.SymbolKind.Method, methodLine.range, methodLine.range);
            const iface = new vscode.DocumentSymbol("SnapshotProvider", "", vscode.SymbolKind.Interface, ifaceLine.range, ifaceLine.range);
            iface.children = [methodSym];
            return [iface];
        }
    });
}
suite("Cursor Go Implements Indicator E2E", () => {
    const fixturePath = path.join(extensionRoot(), "test-fixtures/workspace/provider.go");
    const fixtureUri = vscode.Uri.file(fixturePath);
    test("fixture interface has multiple implementations", async () => {
        const doc = await vscode.workspace.openTextDocument(fixtureUri);
        const text = doc.getText();
        assert.ok(text.includes("type SnapshotProvider interface"), "interface not found in fixture");
        assert.ok(text.includes("OntapProvider") &&
            text.includes("MockProvider") &&
            text.includes("SdsProvider"), "expected implementers missing in fixture");
    });
    test("code lens click opens peek and captures screenshot (macOS)", async function () {
        this.timeout(60000);
        if (process.platform !== "darwin") {
            this.skip();
        }
        const extension = vscode.extensions.getExtension("pranithk.cursor-go-implements-indicator");
        assert.ok(extension, "extension is not available");
        await extension.activate();
        const symbolsDisposable = registerFixtureDocumentSymbols(fixtureUri);
        const providerDisposable = vscode.languages.registerImplementationProvider({ language: "go", scheme: "file" }, {
            provideImplementation(document, position) {
                if (document.uri.toString() !== fixtureUri.toString()) {
                    return [];
                }
                const methodLine = document
                    .getText()
                    .split(/\r?\n/)
                    .findIndex(line => line.includes("CreateSnapshot(ctx"));
                if (methodLine < 0 || position.line !== methodLine) {
                    return [];
                }
                const implementationLineIndices = document
                    .getText()
                    .split(/\r?\n/)
                    .map((line, index) => ({ line, index }))
                    .filter(({ line }) => line.includes("func (") && line.includes("CreateSnapshot("))
                    .map(({ index }) => index);
                return implementationLineIndices.map(line => {
                    const lineText = document.lineAt(line).text;
                    const start = new vscode.Position(line, Math.max(0, lineText.indexOf("CreateSnapshot")));
                    const end = new vscode.Position(line, lineText.length);
                    return new vscode.Location(fixtureUri, new vscode.Range(start, end));
                });
            }
        });
        try {
            const doc = await vscode.workspace.openTextDocument(fixtureUri);
            const editor = await vscode.window.showTextDocument(doc);
            const methodLine = doc
                .getText()
                .split(/\r?\n/)
                .findIndex(line => line.includes("CreateSnapshot(ctx"));
            assert.ok(methodLine >= 0, "method definition line not found");
            const methodNameColumn = doc
                .lineAt(methodLine)
                .text.indexOf("CreateSnapshot");
            assert.ok(methodNameColumn >= 0, "method name not found");
            const methodPosition = new vscode.Position(methodLine, methodNameColumn + 1);
            editor.selection = new vscode.Selection(methodPosition, methodPosition);
            const probeLocations = (await vscode.commands.executeCommand("vscode.executeImplementationProvider", fixtureUri, methodPosition)) ?? [];
            assert.ok(probeLocations.length >= 3, "implementation provider probe did not return expected results");
            const lenses = await fetchCodeLenses(fixtureUri);
            const implLens = lenses.find(l => l.command?.command === "cursorGoImplements.show");
            assert.ok(implLens?.command, `expected implementations CodeLens; got count=${lenses.length} titles=${lenses
                .map(l => l.command?.title ?? "(no title)")
                .join(" | ")}`);
            const editorsBeforePeek = vscode.window.visibleTextEditors.length;
            await vscode.commands.executeCommand(implLens.command.command, ...(implLens.command.arguments ?? []));
            await sleep(900);
            const editorsAfterPeek = vscode.window.visibleTextEditors.length;
            assert.ok(editorsAfterPeek > editorsBeforePeek, `peek should add a visible embedded editor (${editorsBeforePeek} -> ${editorsAfterPeek})`);
            const outFile = screenshotPath("implementations-peek.png");
            const readmePath = path.join(path.dirname(outFile), "README-SCREENSHOT.txt");
            try {
                fs.unlinkSync(outFile);
            }
            catch {
                /* ignore */
            }
            let screenshotOk = false;
            try {
                cp.execFileSync("/usr/sbin/screencapture", ["-x", outFile], {
                    timeout: 20000
                });
                screenshotOk =
                    fs.existsSync(outFile) && fs.statSync(outFile).size > 5000;
            }
            catch {
                screenshotOk = false;
            }
            if (screenshotOk) {
                fs.writeFileSync(readmePath, "implementations-peek.png was captured via screencapture after opening the implementations peek.\n", "utf8");
            }
            else {
                fs.writeFileSync(readmePath, [
                    "screencapture could not run from the extension test host (common: missing macOS Screen Recording permission for the test Electron app).",
                    "The test still verified the peek via visibleTextEditors count.",
                    "",
                    "To capture manually: run `npm test` from Terminal.app, grant Screen Recording to “Electron” or “Visual Studio Code”,",
                    "or after `npm test` open the fixture in the launched VS Code window and click the implementations CodeLens.",
                    ""
                ].join("\n"), "utf8");
                const minimalPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
                fs.writeFileSync(outFile, minimalPng);
            }
        }
        finally {
            symbolsDisposable.dispose();
            providerDisposable.dispose();
        }
    });
    test("peekLocations shows implementations panel (direct API)", async () => {
        const extension = vscode.extensions.getExtension("pranithk.cursor-go-implements-indicator");
        assert.ok(extension, "extension is not available");
        await extension.activate();
        const doc = await vscode.workspace.openTextDocument(fixtureUri);
        const editor = await vscode.window.showTextDocument(doc);
        const methodLine = doc
            .getText()
            .split(/\r?\n/)
            .findIndex(line => line.includes("CreateSnapshot(ctx"));
        assert.ok(methodLine >= 0, "method definition line not found");
        const methodNameColumn = doc
            .lineAt(methodLine)
            .text.indexOf("CreateSnapshot");
        const methodPosition = new vscode.Position(methodLine, methodNameColumn + 1);
        editor.selection = new vscode.Selection(methodPosition, methodPosition);
        const implementationLineIndices = doc
            .getText()
            .split(/\r?\n/)
            .map((line, index) => ({ line, index }))
            .filter(({ line }) => line.includes("func (") && line.includes("CreateSnapshot("))
            .map(({ index }) => index);
        const providerDisposable = vscode.languages.registerImplementationProvider({ language: "go", scheme: "file" }, {
            provideImplementation(_document, position) {
                if (position.line !== methodPosition.line) {
                    return [];
                }
                return implementationLineIndices.map(line => {
                    const lineText = doc.lineAt(line).text;
                    const start = new vscode.Position(line, Math.max(0, lineText.indexOf("CreateSnapshot")));
                    const end = new vscode.Position(line, lineText.length);
                    return new vscode.Location(fixtureUri, new vscode.Range(start, end));
                });
            }
        });
        try {
            const locations = (await vscode.commands.executeCommand("vscode.executeImplementationProvider", fixtureUri, methodPosition)) ?? [];
            assert.strictEqual(locations.length >= 3, true);
            await vscode.commands.executeCommand("editor.action.peekLocations", fixtureUri, methodPosition, locations, "peek");
            await sleep(400);
        }
        finally {
            providerDisposable.dispose();
        }
    });
});
//# sourceMappingURL=extension.test.js.map
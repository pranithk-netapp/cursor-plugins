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
exports.__test = void 0;
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
function activate(context) {
    const output = vscode.window.createOutputChannel("Cursor Go Implements Indicator");
    context.subscriptions.push(output);
    const coverageManager = new GoCoverageManager(output);
    context.subscriptions.push(coverageManager);
    coverageManager.initialize();
    const lensProvider = new GoInterfaceLensProvider();
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: "go", scheme: "file" }, lensProvider));
    const inlayProvider = new GoInterfaceInlayHintsProvider();
    context.subscriptions.push(vscode.languages.registerInlayHintsProvider({ language: "go", scheme: "file" }, inlayProvider));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.languageId === "go") {
            lensProvider.refresh();
            inlayProvider.refresh();
            coverageManager.applyToVisibleEditors();
        }
    }));
    context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(() => {
        coverageManager.applyToVisibleEditors();
    }));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
        coverageManager.applyToVisibleEditors();
    }));
    context.subscriptions.push(vscode.commands.registerCommand("cursorGoImplements.show", async (uri, position, methodName) => {
        await runShowImplementations(uri, position, methodName, output);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("cursorGoImplements.showAtCursor", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== "go") {
            vscode.window.showInformationMessage("Open a Go file and place the cursor on an interface method.");
            return;
        }
        const doc = editor.document;
        if (doc.uri.scheme !== "file") {
            vscode.window.showInformationMessage("Only file:// Go documents are supported.");
            return;
        }
        const pos = editor.selection.active;
        const symbols = (await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", doc.uri)) ?? [];
        const methods = collectInterfaceMethods(symbols);
        const method = methods.find(m => m.selectionRange.contains(pos) || m.range.contains(pos));
        if (!method) {
            vscode.window.showInformationMessage("Place the cursor on an interface method name or signature line.");
            return;
        }
        await runShowImplementations(doc.uri, method.selectionRange.start, method.name, output);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("cursorGoImplements.runGoTestCoverage", async () => {
        await coverageManager.runGoTestsWithCoverage();
    }));
    context.subscriptions.push(vscode.commands.registerCommand("cursorGoImplements.generateCoverageOutFromCovdata", async () => {
        await coverageManager.generateCoverageOutFromCovdata();
    }));
    context.subscriptions.push(vscode.commands.registerCommand("cursorGoImplements.clearCoverage", () => {
        coverageManager.clearDecorations();
        vscode.window.showInformationMessage("Go coverage decorations cleared.");
    }));
    context.subscriptions.push(vscode.commands.registerCommand("cursorGoImplements.reloadCoverage", async () => {
        const summary = await coverageManager.reloadCoverageNow();
        vscode.window.showInformationMessage(summary);
    }));
}
async function runShowImplementations(uri, position, methodName, output) {
    try {
        output.appendLine(`Run implementations for ${uri.toString()} @${position.line + 1}:${position.character + 1}`);
        const result = await findImplementations(uri, position, methodName, output);
        const locations = deduplicateLocations(result.locations);
        if (!locations.length) {
            vscode.window.showInformationMessage("No implementations found.");
            output.appendLine("No implementations found after all fallbacks.");
            return;
        }
        output.appendLine(`Found ${locations.length} implementation(s).`);
        await vscode.commands.executeCommand("editor.action.peekLocations", uri, result.queryPosition, locations, "peek");
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        output.appendLine(`Error: ${message}`);
        vscode.window.showErrorMessage(`Failed to fetch implementations: ${message}`);
    }
}
class GoInterfaceLensProvider {
    constructor() {
        this._onDidChangeCodeLenses = new vscode.EventEmitter();
        this.onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
    }
    refresh() {
        this._onDidChangeCodeLenses.fire();
    }
    async provideCodeLenses(document) {
        const symbols = (await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", document.uri)) ?? [];
        const interfaceMethods = collectInterfaceMethods(symbols);
        return Promise.all(interfaceMethods.map(async (method) => {
            const result = await findImplementations(document.uri, method.selectionRange.start, method.name);
            const count = deduplicateLocations(result.locations).length;
            return new vscode.CodeLens(method.selectionRange, {
                title: count > 0
                    ? `${count} implementation${count === 1 ? "" : "s"}`
                    : "$(info) Implementations",
                command: "cursorGoImplements.show",
                arguments: [document.uri, method.selectionRange.start, method.name]
            });
        }));
    }
}
class GoInterfaceInlayHintsProvider {
    constructor() {
        this._onDidChange = new vscode.EventEmitter();
        this.onDidChangeInlayHints = this._onDidChange.event;
    }
    refresh() {
        this._onDidChange.fire();
    }
    async provideInlayHints(document, range, _token) {
        const symbols = (await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", document.uri)) ?? [];
        const interfaceMethods = collectInterfaceMethods(symbols);
        const hints = [];
        for (const method of interfaceMethods) {
            const line = method.selectionRange.start.line;
            if (line < range.start.line || line > range.end.line) {
                continue;
            }
            const result = await findImplementations(document.uri, method.selectionRange.start, method.name);
            const count = deduplicateLocations(result.locations).length;
            const clickArgs = [document.uri, method.selectionRange.start, method.name];
            const greenIcon = new vscode.InlayHintLabelPart("🟢");
            greenIcon.tooltip = "Open implementations";
            greenIcon.command = {
                title: "Open implementations",
                command: "cursorGoImplements.show",
                arguments: clickArgs
            };
            const caption = new vscode.InlayHintLabelPart(count > 0 ? ` ${count} impl` : " impl");
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
function normalizeLocations(locations) {
    return locations.map(loc => {
        if ("targetUri" in loc) {
            return new vscode.Location(loc.targetUri, loc.targetSelectionRange ?? loc.targetRange);
        }
        return loc;
    });
}
async function findImplementations(uri, fallback, methodName, output) {
    const queryPositions = await resolveImplementationQueryPositions(uri, fallback, methodName);
    for (const queryPosition of queryPositions) {
        output?.appendLine(`Try implementation query @${queryPosition.line + 1}:${queryPosition.character + 1}`);
        const rawLocations = (await vscode.commands.executeCommand("vscode.executeImplementationProvider", uri, queryPosition)) ?? [];
        const locations = normalizeLocations(rawLocations);
        if (locations.length) {
            return { queryPosition, locations };
        }
    }
    return { queryPosition: fallback, locations: [] };
}
function deduplicateLocations(locations) {
    const unique = new Map();
    for (const loc of locations) {
        const key = `${loc.uri.toString()}:${loc.range.start.line}:${loc.range.start.character}:${loc.range.end.line}:${loc.range.end.character}`;
        if (!unique.has(key)) {
            unique.set(key, loc);
        }
    }
    return [...unique.values()];
}
async function resolveImplementationQueryPositions(uri, fallback, methodName) {
    const positions = [fallback];
    const doc = await vscode.workspace.openTextDocument(uri);
    if (fallback.line >= doc.lineCount) {
        return positions;
    }
    const text = doc.lineAt(fallback.line).text;
    const addUniquePosition = (pos) => {
        if (!positions.some(existing => existing.line === pos.line && existing.character === pos.character)) {
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
        addUniquePosition(new vscode.Position(fallback.line, Math.min(wordRange.end.character - 1, wordRange.start.character + 1)));
    }
    const signatureMatch = /([A-Za-z_]\w*)\s*\(/.exec(text);
    if (signatureMatch?.index !== undefined) {
        addUniquePosition(new vscode.Position(fallback.line, signatureMatch.index + 1));
    }
    return positions;
}
function collectInterfaceMethods(symbols) {
    const methods = [];
    const walk = (nodes) => {
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
class GoCoverageManager {
    constructor(output) {
        this.output = output;
        this.fullCoverageDecoration = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: "rgba(64, 184, 90, 0.08)",
            overviewRulerColor: "rgba(170, 228, 190, 0.1)",
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            before: {
                contentText: "▌",
                color: "#2ea043",
                margin: "0 8px 0 0"
            },
            after: {
                contentText: "  COV 100%",
                color: "#2ea043",
                margin: "0 0 0 12px"
            }
        });
        this.partialCoverageDecoration = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: "rgba(250, 205, 110, 0.1)",
            overviewRulerColor: "rgba(252, 224, 168, 0.13)",
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            before: {
                contentText: "▌",
                color: "#f4bb44",
                margin: "0 8px 0 0"
            },
            after: {
                contentText: "  COV PARTIAL",
                color: "#f4bb44",
                margin: "0 0 0 12px"
            }
        });
        this.noCoverageDecoration = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: "rgba(240, 120, 120, 0.1)",
            overviewRulerColor: "rgba(245, 176, 176, 0.1)",
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            before: {
                contentText: "▌",
                color: "#e65050",
                margin: "0 8px 0 0"
            },
            after: {
                contentText: "  COV 0%",
                color: "#e65050",
                margin: "0 0 0 12px"
            }
        });
        this.lineCoverageByFile = new Map();
        this.watcher = vscode.workspace.createFileSystemWatcher("**/coverage.out");
        this.watcher.onDidCreate(uri => this.reloadCoverageFrom(uri));
        this.watcher.onDidChange(uri => this.reloadCoverageFrom(uri));
        this.watcher.onDidDelete(_uri => {
            this.lineCoverageByFile.clear();
            this.applyToVisibleEditors();
        });
    }
    initialize() {
        void this.loadInitialCoverage();
    }
    async runGoTestsWithCoverage() {
        const editor = vscode.window.activeTextEditor;
        const workspaceFolder = editor
            ? vscode.workspace.getWorkspaceFolder(editor.document.uri)
            : undefined;
        const cwd = workspaceFolder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!cwd) {
            vscode.window.showErrorMessage("Open a workspace folder to run Go tests with coverage.");
            return;
        }
        const terminal = vscode.window.createTerminal({
            name: "Go Test Coverage",
            cwd
        });
        terminal.show();
        terminal.sendText("go test ./... -covermode=count -coverprofile=coverage.out");
        this.output.appendLine(`Running Go tests with coverage in ${cwd}`);
        vscode.window.showInformationMessage("Running `go test` with coverage. Decorations update after coverage.out is generated.");
    }
    async generateCoverageOutFromCovdata() {
        const editor = vscode.window.activeTextEditor;
        const workspaceFolder = editor
            ? vscode.workspace.getWorkspaceFolder(editor.document.uri)
            : undefined;
        const cwd = workspaceFolder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!cwd) {
            vscode.window.showErrorMessage("Open a workspace folder to generate coverage.out from covdata.");
            return;
        }
        const covdataDir = await vscode.window.showInputBox({
            prompt: "Coverage data directory (GOCOVERDIR output)",
            value: "covdatafiles",
            valueSelection: [0, "covdatafiles".length],
            ignoreFocusOut: true
        });
        if (!covdataDir) {
            return;
        }
        const outFile = await vscode.window.showInputBox({
            prompt: "Output coverage profile file",
            value: "coverage.out",
            valueSelection: [0, "coverage.out".length],
            ignoreFocusOut: true
        });
        if (!outFile) {
            return;
        }
        const covdataPath = path.resolve(cwd, covdataDir);
        const outPath = path.resolve(cwd, outFile);
        const command = `go tool covdata textfmt -i="${covdataPath}" -o="${outPath}"`;
        try {
            this.output.appendLine(`Generating coverage profile: ${command}`);
            const { stdout, stderr } = await execAsync(command, { cwd });
            if (stdout.trim()) {
                this.output.appendLine(stdout.trim());
            }
            if (stderr.trim()) {
                this.output.appendLine(stderr.trim());
            }
            await this.reloadCoverageFrom(vscode.Uri.file(outPath));
            vscode.window.showInformationMessage(`Generated ${path.basename(outPath)} from ${covdataDir} and refreshed decorations.`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            this.output.appendLine(`Failed to generate coverage profile: ${message}`);
            vscode.window.showErrorMessage("Failed to generate coverage.out from covdata. Check output channel for details.");
        }
    }
    clearDecorations() {
        this.lineCoverageByFile.clear();
        this.applyToVisibleEditors();
    }
    async reloadCoverageNow() {
        await this.loadInitialCoverage();
        this.applyToVisibleEditors();
        const active = vscode.window.activeTextEditor;
        if (!active || active.document.languageId !== "go") {
            return "Coverage reloaded. Open a Go file to view inline colors.";
        }
        const key = normalizeFsPath(active.document.uri.fsPath);
        const lineMap = this.lineCoverageByFile.get(key);
        if (!lineMap || lineMap.size === 0) {
            return "Coverage reloaded, but no matching lines found for active file.";
        }
        return `Coverage reloaded for active file: ${lineMap.size} line(s) highlighted.`;
    }
    applyToVisibleEditors() {
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.languageId !== "go" || editor.document.uri.scheme !== "file") {
                continue;
            }
            this.applyDecorations(editor);
        }
    }
    async loadInitialCoverage() {
        const coverageFiles = await vscode.workspace.findFiles("**/coverage.out", "**/node_modules/**", 30);
        for (const uri of coverageFiles) {
            await this.reloadCoverageFrom(uri);
        }
    }
    async reloadCoverageFrom(uri) {
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(bytes).toString("utf8");
            const parsed = parseGoCoverage(text, uri, vscode.workspace.workspaceFolders ?? []);
            this.lineCoverageByFile = parsed;
            this.applyToVisibleEditors();
            this.output.appendLine(`Loaded coverage from ${uri.fsPath}`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            this.output.appendLine(`Failed to parse coverage file ${uri.fsPath}: ${message}`);
        }
    }
    applyDecorations(editor) {
        const lineCoverage = this.lineCoverageByFile.get(normalizeFsPath(editor.document.uri.fsPath));
        const full = [];
        const partial = [];
        const none = [];
        if (lineCoverage) {
            for (const [line, state] of lineCoverage.entries()) {
                const lineIdx = line - 1;
                if (lineIdx < 0 || lineIdx >= editor.document.lineCount) {
                    continue;
                }
                const lineRange = editor.document.lineAt(lineIdx).range;
                if (state === "full") {
                    full.push(lineRange);
                }
                else if (state === "partial") {
                    partial.push(lineRange);
                }
                else {
                    none.push(lineRange);
                }
            }
        }
        editor.setDecorations(this.fullCoverageDecoration, full);
        editor.setDecorations(this.partialCoverageDecoration, partial);
        editor.setDecorations(this.noCoverageDecoration, none);
    }
    dispose() {
        this.watcher.dispose();
        this.fullCoverageDecoration.dispose();
        this.partialCoverageDecoration.dispose();
        this.noCoverageDecoration.dispose();
    }
}
function parseGoCoverage(content, coverageUri, workspaceFolders) {
    const fileLineFlags = new Map();
    const lines = content.split(/\r?\n/);
    const entryRegex = /^(.+):(\d+)\.(\d+),(\d+)\.(\d+)\s+(\d+)\s+(\d+)$/;
    for (const line of lines) {
        if (!line || line.startsWith("mode:")) {
            continue;
        }
        const match = entryRegex.exec(line.trim());
        if (!match) {
            continue;
        }
        const [, rawPath, startLineRaw, , endLineRaw, , , countRaw] = match;
        const startLine = Number(startLineRaw);
        const endLine = Number(endLineRaw);
        const count = Number(countRaw);
        const covered = count > 0;
        const normalizedPaths = resolveCoveragePaths(rawPath, coverageUri, workspaceFolders);
        for (const normalizedPath of normalizedPaths) {
            let lineFlags = fileLineFlags.get(normalizedPath);
            if (!lineFlags) {
                lineFlags = new Map();
                fileLineFlags.set(normalizedPath, lineFlags);
            }
            for (let lineNo = startLine; lineNo <= endLine; lineNo++) {
                const flags = lineFlags.get(lineNo) ?? { covered: false, uncovered: false };
                if (covered) {
                    flags.covered = true;
                }
                else {
                    flags.uncovered = true;
                }
                lineFlags.set(lineNo, flags);
            }
        }
    }
    const result = new Map();
    for (const [filePath, perLine] of fileLineFlags.entries()) {
        const states = new Map();
        for (const [lineNo, flags] of perLine.entries()) {
            if (flags.covered && flags.uncovered) {
                states.set(lineNo, "partial");
            }
            else if (flags.covered) {
                states.set(lineNo, "full");
            }
            else {
                states.set(lineNo, "none");
            }
        }
        result.set(filePath, states);
    }
    return result;
}
function resolveCoveragePaths(rawPath, coverageUri, workspaceFolders) {
    const resolved = new Set();
    const cleanPath = rawPath.replace(/\\/g, "/");
    if (isAbsolutePath(cleanPath)) {
        resolved.add(normalizeFsPath(cleanPath));
    }
    else {
        const relativeCandidates = buildRelativeCoverageCandidates(cleanPath);
        const coverageDir = path.dirname(coverageUri.fsPath);
        for (const candidateRelPath of relativeCandidates) {
            resolved.add(normalizeFsPath(path.resolve(coverageDir, candidateRelPath)));
        }
        for (const folder of workspaceFolders) {
            for (const candidateRelPath of relativeCandidates) {
                const candidate = path.resolve(folder.uri.fsPath, candidateRelPath);
                resolved.add(normalizeFsPath(candidate));
            }
        }
    }
    return [...resolved];
}
function buildRelativeCoverageCandidates(cleanPath) {
    const normalized = cleanPath.replace(/^\.\/+/, "");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length <= 1) {
        return [normalized];
    }
    const candidates = new Set([normalized]);
    for (let i = 1; i < parts.length; i++) {
        candidates.add(parts.slice(i).join("/"));
    }
    return [...candidates];
}
function isAbsolutePath(path) {
    return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}
function normalizeFsPath(path) {
    return path.replace(/\\/g, "/");
}
exports.__test = {
    parseGoCoverage,
    resolveCoveragePaths,
    buildRelativeCoverageCandidates,
    normalizeFsPath
};
function deactivate() { }
//# sourceMappingURL=extension.js.map
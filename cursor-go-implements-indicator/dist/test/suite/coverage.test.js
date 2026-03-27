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
const vscode = __importStar(require("vscode"));
const extension_1 = require("../../extension");
suite("Coverage Parsing", () => {
    test("classifies full, partial, and no coverage lines", () => {
        const coverageContent = [
            "mode: count",
            "pkg/service.go:10.1,12.2 2 1",
            "pkg/service.go:12.1,13.9 1 0",
            "pkg/service.go:20.1,20.10 1 0"
        ].join("\n");
        const coverageUri = vscode.Uri.file("/workspace/coverage.out");
        const folders = [
            {
                uri: vscode.Uri.file("/workspace"),
                name: "workspace",
                index: 0
            }
        ];
        const parsed = extension_1.__test.parseGoCoverage(coverageContent, coverageUri, folders);
        const key = extension_1.__test.normalizeFsPath("/workspace/pkg/service.go");
        const fileCoverage = parsed.get(key);
        assert.ok(fileCoverage, "expected coverage map for pkg/service.go");
        assert.strictEqual(fileCoverage?.get(10), "full");
        assert.strictEqual(fileCoverage?.get(11), "full");
        assert.strictEqual(fileCoverage?.get(12), "partial");
        assert.strictEqual(fileCoverage?.get(13), "none");
        assert.strictEqual(fileCoverage?.get(20), "none");
    });
    test("resolves relative and absolute coverage paths", () => {
        const coverageUri = vscode.Uri.file("/repo/sub/coverage.out");
        const folders = [
            {
                uri: vscode.Uri.file("/repo"),
                name: "repo",
                index: 0
            }
        ];
        const relative = extension_1.__test.resolveCoveragePaths("pkg/a.go", coverageUri, folders);
        assert.ok(relative.includes("/repo/sub/pkg/a.go"), "should resolve relative path from coverage.out directory");
        assert.ok(relative.includes("/repo/pkg/a.go"), "should also resolve relative path from workspace root");
        const absolute = extension_1.__test.resolveCoveragePaths("/tmp/other/module/b.go", coverageUri, folders);
        assert.deepStrictEqual(absolute, ["/tmp/other/module/b.go"]);
    });
    test("ignores malformed coverage lines", () => {
        const coverageContent = [
            "mode: count",
            "this is not valid coverage syntax",
            "pkg/ok.go:2.1,2.8 1 1"
        ].join("\n");
        const coverageUri = vscode.Uri.file("/workspace/coverage.out");
        const folders = [
            {
                uri: vscode.Uri.file("/workspace"),
                name: "workspace",
                index: 0
            }
        ];
        const parsed = extension_1.__test.parseGoCoverage(coverageContent, coverageUri, folders);
        const key = extension_1.__test.normalizeFsPath("/workspace/pkg/ok.go");
        const fileCoverage = parsed.get(key);
        assert.ok(fileCoverage, "valid line should still be parsed");
        assert.strictEqual(fileCoverage?.get(2), "full");
        assert.ok(parsed.size >= 1, "parser should return at least one mapped file");
    });
    test("normalizes Windows-style paths from coverage data", () => {
        const coverageContent = [
            "mode: count",
            "C:\\repo\\pkg\\win.go:7.1,7.20 1 1"
        ].join("\n");
        const coverageUri = vscode.Uri.file("/workspace/coverage.out");
        const parsed = extension_1.__test.parseGoCoverage(coverageContent, coverageUri, []);
        const key = "C:/repo/pkg/win.go";
        const fileCoverage = parsed.get(key);
        assert.ok(fileCoverage, "expected normalized windows path key");
        assert.strictEqual(fileCoverage?.get(7), "full");
    });
    test("resolves module import-style paths to local files", () => {
        const coverageUri = vscode.Uri.file("/repo/test-fixtures/workspace/coverage.out");
        const folders = [
            {
                uri: vscode.Uri.file("/repo"),
                name: "repo",
                index: 0
            }
        ];
        const resolved = extension_1.__test.resolveCoveragePaths("example.com/goimplfixture/provider.go", coverageUri, folders);
        assert.ok(resolved.includes("/repo/test-fixtures/workspace/provider.go"), "should include stripped module path resolved from coverage file directory");
    });
});
//# sourceMappingURL=coverage.test.js.map
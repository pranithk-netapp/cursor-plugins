import * as assert from "assert";
import * as vscode from "vscode";
import { __test } from "../../extension";

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
    ] as unknown as readonly vscode.WorkspaceFolder[];

    const parsed = __test.parseGoCoverage(coverageContent, coverageUri, folders);
    const key = __test.normalizeFsPath("/workspace/pkg/service.go");
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
    ] as unknown as readonly vscode.WorkspaceFolder[];

    const relative = __test.resolveCoveragePaths("pkg/a.go", coverageUri, folders);
    assert.ok(
      relative.includes("/repo/sub/pkg/a.go"),
      "should resolve relative path from coverage.out directory"
    );
    assert.ok(
      relative.includes("/repo/pkg/a.go"),
      "should also resolve relative path from workspace root"
    );

    const absolute = __test.resolveCoveragePaths(
      "/tmp/other/module/b.go",
      coverageUri,
      folders
    );
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
    ] as unknown as readonly vscode.WorkspaceFolder[];

    const parsed = __test.parseGoCoverage(coverageContent, coverageUri, folders);
    const key = __test.normalizeFsPath("/workspace/pkg/ok.go");
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

    const parsed = __test.parseGoCoverage(coverageContent, coverageUri, []);
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
    ] as unknown as readonly vscode.WorkspaceFolder[];

    const resolved = __test.resolveCoveragePaths(
      "example.com/goimplfixture/provider.go",
      coverageUri,
      folders
    );

    assert.ok(
      resolved.includes("/repo/test-fixtures/workspace/provider.go"),
      "should include stripped module path resolved from coverage file directory"
    );
  });
});

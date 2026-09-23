import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Why this test is structured the way it is
//
// The thing we actually need to prove is "clicking the Preview icon in the
// editor-title toolbar works, and the icon shows up there in the first
// place." @vscode/test-electron gives us a real Extension Development Host,
// but it does NOT give us any way to inspect VS Code's native chrome (the
// editor-title toolbar is not DOM we can query from an extension test), and
// the Preview panel is a webview, which VS Code renders inside an isolated
// iframe with no API for an extension (or an extension test) to reach into
// its rendered contents.
//
// So instead of trying (and failing) to screenshot a toolbar button or poke
// at a webview's DOM, this test proves the same outcome via its necessary
// and sufficient preconditions:
//
//   1. The command the icon invokes is actually registered.
//   2. The manifest actually still wires `editor/title` -> that command,
//      gated by `openapiViewer.isOpenApi`, with an `icon` pointing at the
//      badge SVG added for this change -- read live from the running
//      extension's `packageJSON`, not from a static file, so a manifest
//      regression (e.g. someone reverts the icon field, or drops the menu
//      entry) fails this test. And the runtime predicate that drives that
//      `when` clause (`isOpenApiDocument`) actually evaluates to `true` for
//      the fixture we open.
//   3. Executing the command -- which is *exactly* what clicking the icon
//      does, VS Code menu items are not a separate code path from the
//      command they invoke -- produces a real webview panel with the right
//      viewType and HTML containing the CSP tag and both expected script
//      tags.
//   4. The actual data that would be posted into that webview (the parsed
//      spec) is computed correctly for the fixture, asserted directly
//      against `computeSpecPayload` rather than faking a postMessage round
//      trip through an iframe that doesn't exist in this test context.
//
// Together these are necessary and sufficient: if all four hold, the icon
// is wired correctly and clicking it does the right thing, regardless of
// whether we can literally see the pixel.
// ---------------------------------------------------------------------------

const EXTENSION_ID = "pranithk.open-api-viewer";

/** Small retry-loop helper, matching this suite's existing polling style:
 * short sleeps, bounded attempts, no long fixed waits. Used to avoid a race
 * against the debounced analysis / context-key update that runs after a
 * document becomes active. */
async function waitUntil(check: () => boolean, attempts = 40, delayMs = 100): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  assert.ok(check(), `condition did not become true after ${attempts * delayMs}ms`);
}

suite("OpenAPI Viewer Preview", () => {
  test("preview icon wiring + command execution produce a correct webview and payload", async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, "extension is not available");
    await extension!.activate();

    // __dirname at runtime is out/test/suite; the project root is three
    // levels up (out/test/suite -> out/test -> out -> project root).
    const testWorkspaceRoot = path.resolve(__dirname, "../../..");
    const fixtureUri = vscode.Uri.file(path.join(testWorkspaceRoot, "test-fixtures", "rpc.json"));
    const document = await vscode.workspace.openTextDocument(fixtureUri);
    await vscode.window.showTextDocument(document);

    // The extension's activate() returns void (not an API object), so
    // `__test` is a module-level export of the compiled bundle, not
    // something reachable via `extension.exports`. Re-requiring the exact
    // same absolute path VS Code already loaded it from returns Node's
    // cached module instance -- same process, same singletons -- which is
    // how the sibling extension's __test convention is meant to be used
    // from an integration test.
    const extModule = requireExtensionModule(extension!);

    // (2b) Runtime predicate: poll briefly since the context-key updater
    // reacts to onDidChangeActiveTextEditor / debounced text-change events
    // rather than being synchronously guaranteed by showTextDocument.
    await waitUntil(() => extModule.__test.isOpenApiDocument(document));
    assert.strictEqual(extModule.__test.isOpenApiDocument(document), true, "fixture should be detected as an OpenAPI document");

    // (2a) Manifest wiring, read from the ACTIVE extension's packageJSON,
    // not a static file read -- proves what's actually loaded.
    const packageJSON = extension!.packageJSON;
    const editorTitleMenu: Array<{ command: string; when?: string; group?: string }> =
      packageJSON.contributes.menus["editor/title"];
    const previewMenuEntry = editorTitleMenu.find((entry) => entry.command === "openapiViewer.preview");
    assert.ok(previewMenuEntry, "openapiViewer.preview should be wired into editor/title");
    assert.strictEqual(previewMenuEntry!.when, "openapiViewer.isOpenApi");
    assert.strictEqual(previewMenuEntry!.group, "navigation");

    const previewCommandDecl = (packageJSON.contributes.commands as Array<{ command: string; icon?: unknown }>).find(
      (entry) => entry.command === "openapiViewer.preview"
    );
    assert.ok(previewCommandDecl, "openapiViewer.preview should be a declared command");
    assert.strictEqual(previewCommandDecl!.icon, "media/icons/preview-badge.svg");

    // (1) The command the icon invokes is registered.
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("openapiViewer.preview"), "openapiViewer.preview should be registered");

    // (3) Executing the command is exactly what clicking the icon does.
    await vscode.commands.executeCommand("openapiViewer.preview");

    const previewController = extModule.__test.getPreviewController();
    assert.ok(previewController, "PreviewPanelController should be reachable via __test after activate()");

    await waitUntil(() => previewController.getPanelCount() >= 1);
    const panel = previewController.getPanel(document.uri);
    assert.ok(panel, "a preview panel for the opened document should exist after executing the command");
    assert.strictEqual(panel!.viewType, "openapiViewer.preview");

    const html: string = panel!.webview.html;
    assert.match(html, /Content-Security-Policy/, "webview HTML should contain a CSP meta tag");
    assert.match(html, /swagger-ui-bundle\.js/, "webview HTML should load the copied swagger-ui-bundle.js");
    assert.match(html, /media\/dist\/preview\.js/, "webview HTML should load our own preview.js bundle");
    assert.match(html, /<script nonce="/, "scripts should be nonced per the strict CSP");

    // (4) The data that would actually be sent into the webview -- computed
    // against the same DocumentCache the real preview command reads from.
    const cache = extModule.__test.getCache();
    assert.ok(cache, "DocumentCache should be reachable via __test after activate()");
    const payload: any = extModule.__test.computeSpecPayload(document, cache);
    assert.strictEqual(payload.info.title, "Resource Provider Controller");
    assert.strictEqual(payload.info.version, "2024-09-01");
    assert.strictEqual(Object.keys(payload.paths).length, 11);
    assert.ok(Object.prototype.hasOwnProperty.call(payload.paths, "/v1/nicMigration/prepare"));

    panel!.dispose();
  });
});

/**
 * Reach the compiled extension module's exports (which include `__test`)
 * the same way Node's own require cache already has it loaded, since
 * `vscode.Extension.exports` is `undefined` for this extension (activate()
 * returns void, not an API object) -- __test is a module-level export, not
 * an activate() return value.
 */
function requireExtensionModule(extension: vscode.Extension<unknown>): { __test: any } {
  const mainPath = path.join(extension.extensionPath, "dist", "extension.js");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(mainPath);
}

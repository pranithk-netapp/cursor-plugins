import * as assert from "assert";
import * as vscode from "vscode";

suite("OpenAPI Viewer Activation", () => {
  test("extension activates and registers showInfo command", async () => {
    const extension = vscode.extensions.getExtension("pranithk.open-api-viewer");
    assert.ok(extension, "extension is not available");
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("openapiViewer.showInfo"), "command not registered");
  });
});

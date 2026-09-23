import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main() {
  try {
    delete process.env.ELECTRON_RUN_AS_NODE;
    const extensionDevelopmentPath = path.resolve(__dirname, "../..");
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath
    });
  } catch (error) {
    console.error("Failed to run tests", error);
    process.exit(1);
  }
}

void main();

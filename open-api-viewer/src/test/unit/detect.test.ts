import * as assert from "assert";
import { detectOpenApi } from "../../core/detect";

suite("core/detect", () => {
  test("JSON openapi 3.0.0 -> '3.0'", () => {
    const text = `{\n  "openapi": "3.0.0",\n  "info": {}\n}`;
    assert.strictEqual(detectOpenApi(text), "3.0");
  });

  test("JSON openapi 3.1.0 -> '3.1'", () => {
    const text = `{\n  "openapi": "3.1.0",\n  "info": {}\n}`;
    assert.strictEqual(detectOpenApi(text), "3.1");
  });

  test("YAML openapi: \"3.1.0\" -> '3.1'", () => {
    const text = `openapi: "3.1.0"\ninfo:\n  title: x\n`;
    assert.strictEqual(detectOpenApi(text), "3.1");
  });

  test("YAML swagger: \"2.0\" -> '2.0'", () => {
    const text = `swagger: "2.0"\ninfo:\n  title: x\n`;
    assert.strictEqual(detectOpenApi(text), "2.0");
  });

  test("JSON swagger 2.0 -> '2.0'", () => {
    const text = `{"swagger": "2.0", "info": {}}`;
    assert.strictEqual(detectOpenApi(text), "2.0");
  });

  test("package.json-like text -> null", () => {
    const text = `{\n  "name": "open-api-viewer",\n  "version": "0.1.0",\n  "main": "./dist/extension.js"\n}`;
    assert.strictEqual(detectOpenApi(text), null);
  });

  test("full-text fallback finds a reordered key in a small file", () => {
    const padding = "x".repeat(5000);
    const text = `// ${padding}\nopenapi: "3.0.1"\n`;
    assert.strictEqual(detectOpenApi(text), "3.0");
  });
});

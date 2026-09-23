import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseSpec } from "../../core/parse";
import { buildIndex } from "../../core/specIndex";
import { validateAgainstSchema } from "../../core/validation/schemaValidator";
import { LineIndex } from "../../core/lineIndex";

const FIXTURES = path.join(__dirname, "..", "..", "..", "test-fixtures");

suite("core/validation/schemaValidator", () => {
  test("rpc.json passes with 0 schema issues", () => {
    const text = fs.readFileSync(path.join(FIXTURES, "rpc.json"), "utf8");
    const result = parseSpec(text, "json");
    const index = buildIndex(result);
    const issues = validateAgainstSchema(result, index);
    assert.deepStrictEqual(issues, []);
  });

  test("a fixture missing info.title produces exactly one issue mapped to the 'info' node's range", () => {
    const text = `{\n  "openapi": "3.0.0",\n  "info": {\n    "version": "1.0.0"\n  },\n  "paths": {}\n}\n`;
    const result = parseSpec(text, "json");
    const index = buildIndex(result);
    const issues = validateAgainstSchema(result, index);

    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].code, "openapi-schema/required");
    assert.strictEqual(issues[0].severity, "error");

    // The 'info' key ("info") starts on line 2 (0-based) — assert on the
    // line rather than a raw offset for readability, per the plan.
    const lineIndex = new LineIndex(text);
    const start = lineIndex.positionAt(issues[0].offset);
    const infoLine = text.split("\n").findIndex((line) => line.includes(`"info"`));
    assert.strictEqual(start.line, infoLine);
  });

  test("openapi: '3.0' (bad pattern, missing patch component) is flagged", () => {
    // NOTE: an openapi value like "2.5.0" cannot be used here — buildIndex's
    // own version detection (specIndex.ts detectVersion) only recognizes
    // "3.0"/"3.1"-prefixed strings as OAS3 and everything else as
    // version:"unknown", and validateAgainstSchema intentionally skips
    // (returns []) when the version is unknown (nothing to validate
    // against — see its own doc comment). So the "bad pattern" case that
    // actually reaches ajv is a 3.0.x-shaped string that's still malformed,
    // such as a missing patch number.
    const text = `{\n  "openapi": "3.0",\n  "info": {\n    "title": "x",\n    "version": "1.0.0"\n  },\n  "paths": {}\n}\n`;
    const result = parseSpec(text, "json");
    const index = buildIndex(result);
    assert.strictEqual(index.version, "3.0");
    const issues = validateAgainstSchema(result, index);

    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].code, "openapi-schema/pattern");

    const lineIndex = new LineIndex(text);
    const start = lineIndex.positionAt(issues[0].offset);
    const openapiLine = text.split("\n").findIndex((line) => line.includes(`"openapi"`));
    assert.strictEqual(start.line, openapiLine);
  });
});

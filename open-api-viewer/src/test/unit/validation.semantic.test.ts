import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseSpec } from "../../core/parse";
import { buildIndex } from "../../core/specIndex";
import {
  validateSemantics,
  ruleOAV101,
  ruleOAV102,
  ruleOAV103,
  ruleOAV104,
  ruleOAV105,
  ruleOAV106,
  ruleOAV107,
  ruleOAV108,
  ruleOAV109,
  ruleOAV110,
} from "../../core/validation/semantic";
import { LineIndex } from "../../core/lineIndex";
import { Issue } from "../../core/types";

const FIXTURES = path.join(__dirname, "..", "..", "..", "test-fixtures");

function load(fixture: string, lang: "json" | "yaml" = "json") {
  const text = fs.readFileSync(path.join(FIXTURES, fixture), "utf8");
  const result = parseSpec(text, lang);
  const index = buildIndex(result);
  return { text, result, index };
}

/** Line (0-based) of the first line containing `needle`, for readable assertions. */
function lineOf(text: string, needle: string): number {
  const line = text.split("\n").findIndex((l) => l.includes(needle));
  assert.ok(line >= 0, `expected to find a line containing ${JSON.stringify(needle)}`);
  return line;
}

/** Line (0-based) of the first `needle` occurring at or after `after`'s own line, for readable assertions. */
function lineAfter(text: string, after: string, needle: string): number {
  const afterOffset = text.indexOf(after);
  assert.ok(afterOffset >= 0, `expected to find ${JSON.stringify(after)}`);
  const needleOffset = text.indexOf(needle, afterOffset);
  assert.ok(needleOffset >= 0, `expected to find ${JSON.stringify(needle)} after ${JSON.stringify(after)}`);
  return new LineIndex(text).positionAt(needleOffset).line;
}

function lineOfIssue(text: string, issue: Issue): number {
  return new LineIndex(text).positionAt(issue.offset).line;
}

const RPC = load("rpc.json");

suite("core/validation/semantic — rpc.json has 0 OAV1xx findings", () => {
  test("validateSemantics returns []", () => {
    assert.deepStrictEqual(validateSemantics(RPC.result, RPC.index), []);
  });
});

suite("core/validation/semantic — OAV101 unresolved local $ref", () => {
  test("broken-refs.json: DoesNotExist is flagged, on its own line", () => {
    const { text, index } = load("broken-refs.json");
    const issues = ruleOAV101(index);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].code, "OAV101");
    assert.match(issues[0].message, /DoesNotExist/);
    assert.strictEqual(lineOfIssue(text, issues[0]), lineOf(text, "DoesNotExist"));
  });

  test("rpc.json: no unresolved local refs", () => {
    assert.deepStrictEqual(ruleOAV101(RPC.index), []);
  });
});

suite("core/validation/semantic — OAV102 external $ref (informational)", () => {
  test("broken-refs.json: other.yaml ref is flagged as info", () => {
    const { text, index } = load("broken-refs.json");
    const issues = ruleOAV102(index);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].code, "OAV102");
    assert.strictEqual(issues[0].severity, "info");
    assert.match(issues[0].message, /other\.yaml/);
    assert.strictEqual(lineOfIssue(text, issues[0]), lineOf(text, "other.yaml"));
  });

  test("rpc.json: no external refs", () => {
    assert.deepStrictEqual(ruleOAV102(RPC.index), []);
  });
});

suite("core/validation/semantic — OAV103 unused component", () => {
  test("broken-refs.json: UnusedSchema is flagged", () => {
    const { index } = load("broken-refs.json");
    const issues = ruleOAV103(index);
    const unused = issues.find((i) => i.message.includes("UnusedSchema"));
    assert.ok(unused, "expected an OAV103 issue mentioning UnusedSchema");
    assert.strictEqual(unused!.code, "OAV103");
    assert.strictEqual(unused!.severity, "warning");
  });

  test("rpc.json: every component (including both security schemes) is used", () => {
    assert.deepStrictEqual(ruleOAV103(RPC.index), []);
  });
});

suite("core/validation/semantic — OAV104 duplicate operationId", () => {
  test("dup-opid.json: both operations sharing 'listThings' are flagged", () => {
    const { text, index } = load("dup-opid.json");
    const issues = ruleOAV104(index);
    assert.strictEqual(issues.length, 2);
    for (const issue of issues) {
      assert.strictEqual(issue.code, "OAV104");
      assert.match(issue.message, /listThings/);
    }
    // Each issue is located at its own operation's "get" key, one line
    // below the path it belongs to (not the path key itself).
    assert.strictEqual(lineOfIssue(text, issues[0]), lineAfter(text, "/widgets", `"get"`));
    assert.strictEqual(lineOfIssue(text, issues[1]), lineAfter(text, "/gadgets", `"get"`));
  });

  test("rpc.json: 17 distinct operationIds, no duplicates", () => {
    assert.deepStrictEqual(ruleOAV104(RPC.index), []);
  });
});

suite("core/validation/semantic — OAV105 path-parameter mismatch", () => {
  const { text, index } = load("path-params.yaml", "yaml");
  const issues = ruleOAV105(index);

  test("/a/{id}: missing declaration is flagged on the path", () => {
    const found = issues.filter((i) => i.message.includes("'{id}'"));
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].code, "OAV105");
    assert.strictEqual(found[0].severity, "error");
    assert.strictEqual(lineOfIssue(text, found[0]), lineOf(text, "/a/{id}"));
  });

  test("/b/{foo}: name mismatch flagged in both directions ('foo' undeclared, 'bar' unused)", () => {
    const missingTemplate = issues.find((i) => i.message.includes("'{foo}'"));
    const staleParam = issues.find((i) => i.message.includes("Parameter 'bar'"));
    assert.ok(missingTemplate, "expected a missing-declaration issue for {foo}");
    assert.ok(staleParam, "expected a stale-declaration issue for 'bar'");
    assert.strictEqual(lineOfIssue(text, missingTemplate!), lineOf(text, "/b/{foo}"));
    assert.strictEqual(lineOfIssue(text, staleParam!), lineOf(text, "name: bar"));
  });

  test("/c/{x}: declared correctly but missing 'required: true' (warning)", () => {
    const found = issues.filter((i) => i.message.includes("required: true"));
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].severity, "warning");
    assert.strictEqual(lineOfIssue(text, found[0]), lineOf(text, "name: x"));
  });

  test("total OAV105 issues on path-params.yaml is exactly 4", () => {
    assert.strictEqual(issues.length, 4);
  });

  test("rpc.json: every path parameter matches its template and is required", () => {
    assert.deepStrictEqual(ruleOAV105(RPC.index), []);
  });
});

suite("core/validation/semantic — OAV106 operation with no responses", () => {
  test("an operation with an empty responses object is flagged", () => {
    const text = `{\n  "openapi": "3.0.0",\n  "info": {"title": "x", "version": "1.0.0"},\n  "paths": {\n    "/x": {\n      "get": {\n        "operationId": "getX",\n        "responses": {}\n      }\n    }\n  }\n}\n`;
    const result = parseSpec(text, "json");
    const index = buildIndex(result);
    const issues = ruleOAV106(index);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].code, "OAV106");
    assert.strictEqual(issues[0].severity, "error");
    assert.strictEqual(lineOfIssue(text, issues[0]), lineOf(text, `"get"`));
  });

  test("rpc.json: every operation has responses", () => {
    assert.deepStrictEqual(ruleOAV106(RPC.index), []);
  });
});

suite("core/validation/semantic — OAV107 no success response", () => {
  test("an operation with only a 404 response is flagged", () => {
    const text = `{\n  "openapi": "3.0.0",\n  "info": {"title": "x", "version": "1.0.0"},\n  "paths": {\n    "/x": {\n      "get": {\n        "operationId": "getX",\n        "responses": {\n          "404": {"description": "not found"}\n        }\n      }\n    }\n  }\n}\n`;
    const result = parseSpec(text, "json");
    const index = buildIndex(result);
    const issues = ruleOAV107(index);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].code, "OAV107");
    assert.strictEqual(issues[0].severity, "warning");
    assert.strictEqual(lineOfIssue(text, issues[0]), lineOf(text, `"get"`));
  });

  test("an operation with only a 'default' response is not flagged", () => {
    const text = `{\n  "openapi": "3.0.0",\n  "info": {"title": "x", "version": "1.0.0"},\n  "paths": {\n    "/x": {\n      "get": {\n        "operationId": "getX",\n        "responses": {\n          "default": {"description": "fallback"}\n        }\n      }\n    }\n  }\n}\n`;
    const result = parseSpec(text, "json");
    const index = buildIndex(result);
    assert.deepStrictEqual(ruleOAV107(index), []);
  });

  test("rpc.json: every operation has a 2xx/3xx response", () => {
    assert.deepStrictEqual(ruleOAV107(RPC.index), []);
  });
});

suite("core/validation/semantic — OAV108 missing description (configurable)", () => {
  test("missing info.description and an operation missing description+summary are both flagged as 'info' by default", () => {
    const text = `{\n  "openapi": "3.0.0",\n  "info": {"title": "x", "version": "1.0.0"},\n  "paths": {\n    "/x": {\n      "get": {\n        "operationId": "getX",\n        "responses": {"200": {"description": "ok"}}\n      }\n    }\n  }\n}\n`;
    const result = parseSpec(text, "json");
    const index = buildIndex(result);
    const issues = ruleOAV108(index, "info");
    assert.strictEqual(issues.length, 2);
    for (const i of issues) {
      assert.strictEqual(i.code, "OAV108");
      assert.strictEqual(i.severity, "info");
    }
  });

  test("severity 'off' disables the rule entirely", () => {
    const text = `{\n  "openapi": "3.0.0",\n  "info": {"title": "x", "version": "1.0.0"},\n  "paths": {}\n}\n`;
    const result = parseSpec(text, "json");
    const index = buildIndex(result);
    assert.deepStrictEqual(ruleOAV108(index, "off"), []);
  });

  test("rpc.json: info and every operation are described (default severity 'info')", () => {
    assert.deepStrictEqual(ruleOAV108(RPC.index, "info"), []);
  });
});

suite("core/validation/semantic — OAV109 undeclared security scheme", () => {
  test("a root security requirement naming an undeclared scheme is flagged", () => {
    const text = `{\n  "openapi": "3.0.0",\n  "info": {"title": "x", "version": "1.0.0"},\n  "paths": {},\n  "security": [{"Undeclared": []}],\n  "components": {"securitySchemes": {"ApiKey": {"type": "apiKey", "name": "k", "in": "header"}}}\n}\n`;
    const result = parseSpec(text, "json");
    const index = buildIndex(result);
    const issues = ruleOAV109(index);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].code, "OAV109");
    assert.match(issues[0].message, /Undeclared/);
  });

  test("rpc.json: ApiKey and SecretKey are both declared", () => {
    assert.deepStrictEqual(ruleOAV109(RPC.index), []);
  });
});

suite("core/validation/semantic — OAV110 duplicate path template shapes", () => {
  test("/pets/{id} and /pets/{petId} collide", () => {
    const text = `{\n  "openapi": "3.0.0",\n  "info": {"title": "x", "version": "1.0.0"},\n  "paths": {\n    "/pets/{id}": {\n      "get": {"operationId": "getPetById", "responses": {"200": {"description": "ok"}}}\n    },\n    "/pets/{petId}": {\n      "get": {"operationId": "getPetByPetId", "responses": {"200": {"description": "ok"}}}\n    }\n  }\n}\n`;
    const result = parseSpec(text, "json");
    const index = buildIndex(result);
    const issues = ruleOAV110(index);
    assert.strictEqual(issues.length, 2);
    for (const i of issues) {
      assert.strictEqual(i.code, "OAV110");
      assert.strictEqual(i.severity, "warning");
    }
  });

  test("rpc.json: no colliding path-template shapes", () => {
    assert.deepStrictEqual(ruleOAV110(RPC.index), []);
  });
});

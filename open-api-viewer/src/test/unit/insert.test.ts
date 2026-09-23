import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseSpec } from "../../core/parse";
import { buildIndex } from "../../core/specIndex";
import { computeInsertion, computeRemoval, InsertError, TextInsertion } from "../../core/insert";

const FIXTURES = path.join(__dirname, "..", "..", "..", "test-fixtures");

function applyInsertions(text: string, edits: TextInsertion[]): string {
  const sorted = [...edits].sort((a, b) => b.offset - a.offset);
  let result = text;
  for (const edit of sorted) {
    result = result.slice(0, edit.offset) + edit.newText + result.slice(edit.offset + edit.length);
  }
  return result;
}

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

/** jsonc-parser's getNodeValue() produces null-prototype objects; normalize for deepStrictEqual. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

suite("core/insert JSON", () => {
  const text = readFixture("rpc.json");

  test("adding a schema inserts the correct value and leaves everything else byte-identical", () => {
    const parsed = parseSpec(text, "json");
    const edits = computeInsertion({
      text,
      lang: "json",
      ast: parsed.root,
      parentPath: ["components", "schemas"],
      key: "NewSchema",
      value: { type: "object", properties: {}, required: [] },
      indentUnit: "  ",
      eol: "\n",
    });

    const updated = applyInsertions(text, edits);
    const updatedResult = parseSpec(updated, "json");
    assert.strictEqual(updatedResult.errors.length, 0, "must still parse cleanly");
    assert.deepStrictEqual(plain(updatedResult.value.components.schemas.NewSchema), {
      type: "object",
      properties: {},
      required: [],
    });

    // Everything outside the edited range(s) is unchanged: rebuild what the
    // document would look like with the edited region blanked out on both
    // sides and diff the surrounding text directly.
    const minOffset = Math.min(...edits.map((e) => e.offset));
    assert.strictEqual(text.slice(0, minOffset), updated.slice(0, minOffset));
    const originalRest = text.slice(minOffset);
    // The tail after the insertion point, past whatever was inserted, must
    // match the original tail from the same starting point (jsonc-parser's
    // `modify` only ever touches inside [minOffset, maxOffset]).
    const maxEdit = edits.reduce((a, b) => (b.offset + b.length > a.offset + a.length ? b : a));
    const updatedTailStart = maxEdit.offset + maxEdit.newText.length;
    const originalTailStart = maxEdit.offset + maxEdit.length;
    assert.strictEqual(updated.slice(updatedTailStart), text.slice(originalTailStart));
    void originalRest;
  });

  test("respects a tab indentUnit instead of hardcoding spaces", () => {
    const parsed = parseSpec(text, "json");
    const edits = computeInsertion({
      text,
      lang: "json",
      ast: parsed.root,
      parentPath: ["components", "schemas"],
      key: "TabSchema",
      value: { type: "object" },
      indentUnit: "\t",
      eol: "\n",
    });
    const updated = applyInsertions(text, edits);
    const inserted = edits.map((e) => e.newText).join("");
    assert.ok(inserted.includes("\t"), "expected the inserted text to use tabs");
    assert.ok(!/^ +/m.test(inserted.split("\n").find((l) => l.includes("TabSchema")) ?? ""));
    const updatedResult = parseSpec(updated, "json");
    assert.strictEqual(updatedResult.errors.length, 0);
    assert.deepStrictEqual(plain(updatedResult.value.components.schemas.TabSchema), { type: "object" });
  });
});

suite("core/insert YAML", () => {
  const text = readFixture("rpc.yaml");

  test("adding an operation under an existing path is correct and the rest of the document is byte-identical", () => {
    const parsed = parseSpec(text, "yaml");
    const targetPath = "/v1/nicMigration/prepare";
    const edits = computeInsertion({
      text,
      lang: "yaml",
      ast: parsed.root,
      parentPath: ["paths", targetPath],
      key: "delete",
      value: {
        operationId: "NetworkInterface_Move_Cancel",
        responses: { "200": { description: "OK" } },
      },
      indentUnit: "  ",
      eol: "\n",
    });

    assert.strictEqual(edits.length, 1);
    const edit = edits[0];
    const updated = applyInsertions(text, edits);

    const updatedResult = parseSpec(updated, "yaml");
    assert.strictEqual(updatedResult.errors.length, 0, "must still parse cleanly");
    assert.deepStrictEqual(updatedResult.value.paths[targetPath].delete, {
      operationId: "NetworkInterface_Move_Cancel",
      responses: { "200": { description: "OK" } },
    });
    // The sibling "post" operation on the same path must be completely untouched.
    assert.deepStrictEqual(updatedResult.value.paths[targetPath].post, parsed.value.paths[targetPath].post);

    // Byte-identical outside the single inserted span.
    assert.strictEqual(text.slice(0, edit.offset), updated.slice(0, edit.offset));
    const updatedTailStart = edit.offset + edit.newText.length;
    assert.strictEqual(updated.slice(updatedTailStart), text.slice(edit.offset + edit.length));
  });

  test("adding a key to an existing object (no new path segments) inserts as a sibling", () => {
    const parsed = parseSpec(text, "yaml");
    const schemaName = "TrialNicMigrationRequest";
    const propName = Object.keys(parsed.value.components.schemas[schemaName].properties).find(
      (p) => parsed.value.components.schemas[schemaName].properties[p].type === "string"
    )!;
    assert.ok(propName, "fixture must have a string property to attach maxLength to");

    const edits = computeInsertion({
      text,
      lang: "yaml",
      ast: parsed.root,
      parentPath: ["components", "schemas", schemaName, "properties", propName],
      key: "maxLength",
      value: 255,
      indentUnit: "  ",
      eol: "\n",
    });
    const updated = applyInsertions(text, edits);
    const updatedResult = parseSpec(updated, "yaml");
    assert.strictEqual(updatedResult.errors.length, 0);
    assert.strictEqual(
      updatedResult.value.components.schemas[schemaName].properties[propName].maxLength,
      255
    );
  });

  test("empty-components.yaml: adding a schema creates components.schemas from scratch", () => {
    const emptyText = readFixture("empty-components.yaml");
    const parsed = parseSpec(emptyText, "yaml");
    assert.strictEqual(parsed.value.components, undefined, "fixture must start with no components key");

    const edits = computeInsertion({
      text: emptyText,
      lang: "yaml",
      ast: parsed.root,
      parentPath: ["components", "schemas"],
      key: "Foo",
      value: { type: "object", properties: {}, required: [] },
      indentUnit: "  ",
      eol: "\n",
    });
    const updated = applyInsertions(emptyText, edits);
    const updatedResult = parseSpec(updated, "yaml");
    assert.strictEqual(updatedResult.errors.length, 0, "must still parse cleanly");
    assert.deepStrictEqual(updatedResult.value.components, {
      schemas: { Foo: { type: "object", properties: {}, required: [] } },
    });
    // The rest of the document (paths) is untouched.
    assert.deepStrictEqual(updatedResult.value.paths, parsed.value.paths);
  });

  test("flow-style.yaml: inserting into a flow-style mapping throws InsertError", () => {
    const flowText = readFixture("flow-style.yaml");
    const parsed = parseSpec(flowText, "yaml");
    assert.throws(
      () =>
        computeInsertion({
          text: flowText,
          lang: "yaml",
          ast: parsed.root,
          parentPath: ["components", "schemas"],
          key: "Bar",
          value: { type: "object" },
          indentUnit: "  ",
          eol: "\n",
        }),
      InsertError
    );
  });

  test("respects a 4-space indentUnit instead of hardcoding 2 spaces", () => {
    const parsed = parseSpec(text, "yaml");
    const edits = computeInsertion({
      text,
      lang: "yaml",
      ast: parsed.root,
      parentPath: ["components", "schemas"],
      key: "WideIndentSchema",
      value: { type: "object", properties: { a: { type: "string" } } },
      indentUnit: "    ",
      eol: "\n",
    });
    const updated = applyInsertions(text, edits);
    const updatedResult = parseSpec(updated, "yaml");
    assert.strictEqual(updatedResult.errors.length, 0);
    assert.deepStrictEqual(updatedResult.value.components.schemas.WideIndentSchema, {
      type: "object",
      properties: { a: { type: "string" } },
    });
    // The nested "properties" line must be indented 4 (not 2) spaces deeper
    // than "WideIndentSchema:" itself.
    const inserted = edits[0].newText;
    const schemaLine = inserted.split("\n").find((l) => l.includes("WideIndentSchema:"))!;
    const propsLine = inserted.split("\n").find((l) => l.trim().startsWith("properties:"))!;
    const schemaIndent = schemaLine.match(/^ */)![0].length;
    const propsIndent = propsLine.match(/^ */)![0].length;
    assert.strictEqual(propsIndent - schemaIndent, 4);
  });
});

suite("core/insert computeRemoval (YAML)", () => {
  const text = readFixture("rpc.yaml");

  test("removes a mapping entry with no leftover blank/broken lines", () => {
    const parsed = parseSpec(text, "yaml");
    const before = buildIndex(parsed);
    assert.ok(before.components.has("responses/StandardError-404"));

    const edits = computeRemoval({
      text,
      lang: "yaml",
      ast: parsed.root,
      path: ["components", "responses", "StandardError-404"],
    });
    assert.strictEqual(edits.length, 1);
    const updated = applyInsertions(text, edits);

    const updatedResult = parseSpec(updated, "yaml");
    assert.strictEqual(updatedResult.errors.length, 0, "must still parse cleanly");
    const updatedIndex = buildIndex(updatedResult);
    assert.strictEqual(updatedIndex.components.has("responses/StandardError-404"), false);

    // Siblings survive untouched, and the removal left no blank line behind.
    for (const sibling of ["StandardError-400", "StandardError-409", "StandardError-500"]) {
      assert.ok(updatedIndex.components.has(`responses/${sibling}`), `${sibling} should still exist`);
    }
    assert.ok(!updated.includes("\n\n\n"), "no triple-newline / stray blank line left behind");
    assert.ok(updatedResult.value.components.responses["StandardError-400"] !== undefined);
  });

  test("removing the last entry in a mapping still leaves valid, correctly-indented YAML", () => {
    const parsed = parseSpec(text, "yaml");
    const edits = computeRemoval({
      text,
      lang: "yaml",
      ast: parsed.root,
      path: ["components", "responses", "StandardError-500"],
    });
    const updated = applyInsertions(text, edits);
    const updatedResult = parseSpec(updated, "yaml");
    assert.strictEqual(updatedResult.errors.length, 0);
    assert.deepStrictEqual(Object.keys(updatedResult.value.components.responses), [
      "StandardError-400",
      "StandardError-404",
      "StandardError-409",
    ]);
  });
});

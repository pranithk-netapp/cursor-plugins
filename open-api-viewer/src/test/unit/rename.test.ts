import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseSpec } from "../../core/parse";
import { buildIndex } from "../../core/specIndex";
import { computeRenameEdits, RenameEdit } from "../../core/rename";

const FIXTURES = path.join(__dirname, "..", "..", "..", "test-fixtures");

/** Apply RenameEdits to `text`, offset-descending so earlier offsets stay valid. */
function applyEdits(text: string, edits: RenameEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.offset - a.offset);
  let result = text;
  for (const edit of sorted) {
    result = result.slice(0, edit.offset) + edit.newText + result.slice(edit.offset + edit.length);
  }
  return result;
}

suite("core/rename on rpc.json", () => {
  const text = fs.readFileSync(path.join(FIXTURES, "rpc.json"), "utf8");
  const result = parseSpec(text, "json");
  const index = buildIndex(result);

  test("StandardError-404 is $ref'd from 2+ places (sanity check on the fixture)", () => {
    const refs = index.refsByTarget.get("/components/responses/StandardError-404") ?? [];
    assert.ok(refs.length >= 2, `expected StandardError-404 to be ref'd from 2+ places, got ${refs.length}`);
  });

  test("renaming StandardError-404 edits the definition and every ref site, no more no less", () => {
    const componentPointer = "/components/responses/StandardError-404";
    const refs = index.refsByTarget.get(componentPointer) ?? [];
    assert.ok(refs.length >= 2);

    const edits = computeRenameEdits(index, text, componentPointer, "responses", "StandardError-404", "NotFoundError");

    // One edit for the definition key, one per ref site.
    assert.strictEqual(edits.length, refs.length + 1);

    const updated = applyEdits(text, edits);
    const updatedResult = parseSpec(updated, "json");
    assert.strictEqual(updatedResult.errors.length, 0, "renamed document must still parse cleanly");
    const updatedIndex = buildIndex(updatedResult);

    // The old name is fully gone and the new name is defined once and
    // referenced exactly as many times as before.
    assert.strictEqual(updatedIndex.components.has("responses/StandardError-404"), false);
    assert.ok(updatedIndex.components.has("responses/NotFoundError"));
    const newRefs = updatedIndex.refsByTarget.get("/components/responses/NotFoundError") ?? [];
    assert.strictEqual(newRefs.length, refs.length);

    // Sibling responses (400/409/500) must be completely untouched.
    for (const sibling of ["StandardError-400", "StandardError-409", "StandardError-500"]) {
      assert.ok(updatedIndex.components.has(`responses/${sibling}`), `${sibling} should still exist`);
    }
  });
});

suite("core/rename boundary check (prefix/suffix collision)", () => {
  // rpc.json has no naturally-occurring name that is a prefix/suffix of
  // another component's name (StandardError-{400,404,409,500} are all the
  // same length and differ mid-string), so this dedicated fixture pairs
  // "Foo" with "FooBar" to prove the rename boundary check: renaming "Foo"
  // must touch only the exact "#/components/schemas/Foo" ref, never
  // "#/components/schemas/FooBar" even though the latter's target string
  // starts with the former's.
  const text = fs.readFileSync(path.join(FIXTURES, "rename-boundary.json"), "utf8");
  const result = parseSpec(text, "json");
  const index = buildIndex(result);

  test("Foo and FooBar are both present with one ref each", () => {
    assert.ok(index.components.has("schemas/Foo"));
    assert.ok(index.components.has("schemas/FooBar"));
    assert.strictEqual((index.refsByTarget.get("/components/schemas/Foo") ?? []).length, 1);
    assert.strictEqual((index.refsByTarget.get("/components/schemas/FooBar") ?? []).length, 1);
  });

  test("renaming Foo does not touch FooBar's definition or its ref", () => {
    const edits = computeRenameEdits(index, text, "/components/schemas/Foo", "schemas", "Foo", "FooRenamed");

    // Exactly 2 edits: Foo's definition key + the one ref to it.
    assert.strictEqual(edits.length, 2);

    const updated = applyEdits(text, edits);
    const updatedResult = parseSpec(updated, "json");
    assert.strictEqual(updatedResult.errors.length, 0);
    const updatedIndex = buildIndex(updatedResult);

    assert.ok(updatedIndex.components.has("schemas/FooRenamed"));
    assert.strictEqual(updatedIndex.components.has("schemas/Foo"), false);

    // FooBar is completely unaffected: still present, still referenced once,
    // and its name was never partially rewritten into "FooRenamedBar".
    assert.ok(updatedIndex.components.has("schemas/FooBar"));
    assert.strictEqual((updatedIndex.refsByTarget.get("/components/schemas/FooBar") ?? []).length, 1);
    assert.ok(!updated.includes("FooRenamedBar"));
    assert.ok(updated.includes("FooBar"));
  });
});

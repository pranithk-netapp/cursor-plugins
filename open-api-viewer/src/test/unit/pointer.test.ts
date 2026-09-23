import * as assert from "assert";
import { encodeSegment, decodeSegment, joinPointer, refToPointer, pointerToSegments } from "../../core/pointer";

suite("core/pointer", () => {
  test("encode/decode round-trip for '~' and '/'", () => {
    const raw = "a/b~c";
    const encoded = encodeSegment(raw);
    assert.strictEqual(encoded, "a~1b~0c");
    assert.strictEqual(decodeSegment(encoded), raw);
  });

  test("encode/decode round-trip for a plain segment", () => {
    const raw = "PrepareNicMigrationRequest";
    assert.strictEqual(decodeSegment(encodeSegment(raw)), raw);
  });

  test("joinPointer appends and encodes segments", () => {
    assert.strictEqual(joinPointer("", "components", "schemas", "A/B"), "/components/schemas/A~1B");
    assert.strictEqual(joinPointer("/paths", "/v1/x", "get"), "/paths/~1v1~1x/get");
  });

  test("refToPointer('#/components/schemas/A') === '/components/schemas/A'", () => {
    assert.strictEqual(refToPointer("#/components/schemas/A"), "/components/schemas/A");
  });

  test("refToPointer('#') === ''", () => {
    assert.strictEqual(refToPointer("#"), "");
  });

  test("refToPointer('other.yaml#/X') === null (external refs are not pointers into this doc)", () => {
    // Design choice: only a fragment-only ref ("#..." with nothing before the
    // "#") counts as local. Anything with a document part before "#" is a
    // reference into a different document, so it cannot be resolved as a
    // pointer into *this* document's AST/value and returns null.
    assert.strictEqual(refToPointer("other.yaml#/X"), null);
  });

  test("refToPointer with no '#' at all (whole-document external ref) is null", () => {
    assert.strictEqual(refToPointer("other.yaml"), null);
  });

  test("pointerToSegments decodes each token", () => {
    assert.deepStrictEqual(pointerToSegments("/components/schemas/A~1B"), ["components", "schemas", "A/B"]);
    assert.deepStrictEqual(pointerToSegments(""), []);
  });
});

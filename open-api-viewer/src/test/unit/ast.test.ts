import * as assert from "assert";
import { findNodeAtOffset, getPath, childByKey, walk } from "../../core/ast";
import { parseJson } from "../../core/parseJson";

suite("core/ast", () => {
  // Small hand-built fixture: {"a": {"b": 1, "c": [10, 20]}}
  const text = `{"a": {"b": 1, "c": [10, 20]}}`;
  const result = parseJson(text);
  const root = result.root!;

  test("parses without errors", () => {
    assert.strictEqual(result.errors.length, 0);
  });

  test("findNodeAtOffset finds the 'b' value node at its offset", () => {
    // text: {"a": {"b": 1, "c": [10, 20]}}
    //        0123456789012345678901234567890
    // "1" (the value of b) is at offset 12.
    const offset = text.indexOf(": 1") + 2;
    const node = findNodeAtOffset(root, offset);
    assert.ok(node);
    assert.strictEqual(node!.kind, "number");
    assert.strictEqual(node!.value, 1);
    assert.strictEqual(node!.key, "b");
  });

  test("findNodeAtOffset finds the array element '20'", () => {
    const offset = text.indexOf("20");
    const node = findNodeAtOffset(root, offset);
    assert.ok(node);
    assert.strictEqual(node!.kind, "number");
    assert.strictEqual(node!.value, 20);
  });

  test("findNodeAtOffset returns undefined outside the root range", () => {
    assert.strictEqual(findNodeAtOffset(root, text.length + 10), undefined);
  });

  test("childByKey finds 'a' on the root object", () => {
    const aNode = childByKey(root, "a");
    assert.ok(aNode);
    assert.strictEqual(aNode!.kind, "object");
  });

  test("getPath round-trips against the node's own pointer", () => {
    walk(root, (node) => {
      const path = getPath(node);
      const rebuilt = path.length === 0 ? "" : "/" + path.map(String).join("/");
      assert.strictEqual(rebuilt, node.pointer, `pointer mismatch for path ${JSON.stringify(path)}`);
    });
  });
});

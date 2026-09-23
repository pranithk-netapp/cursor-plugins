import * as assert from "assert";
import { LineIndex } from "../../core/lineIndex";

suite("core/lineIndex", () => {
  test("positionAt/offsetAt are inverses on a simple multi-line string", () => {
    const text = "abc\ndefgh\ni\n";
    const index = new LineIndex(text);

    const offsets = [0, 1, 3, 4, 5, 9, 10, 11, 12];
    for (const offset of offsets) {
      const pos = index.positionAt(offset);
      const back = index.offsetAt(pos.line, pos.col);
      assert.strictEqual(back, offset, `offset ${offset} -> ${JSON.stringify(pos)} -> ${back}`);
    }
  });

  test("positionAt at line boundaries", () => {
    const text = "abc\ndefgh\ni\n";
    const index = new LineIndex(text);
    assert.deepStrictEqual(index.positionAt(0), { line: 0, col: 0 });
    assert.deepStrictEqual(index.positionAt(4), { line: 1, col: 0 }); // just after first \n
    assert.deepStrictEqual(index.positionAt(10), { line: 2, col: 0 }); // just after second \n
  });

  test("handles \\r\\n consistently (treats \\r as a normal character)", () => {
    const text = "abc\r\ndef\r\n";
    const index = new LineIndex(text);
    // line 0 = "abc\r", line 1 starts right after the \n at offset 5.
    assert.deepStrictEqual(index.positionAt(5), { line: 1, col: 0 });
    const offsets = [0, 2, 4, 5, 7, 9];
    for (const offset of offsets) {
      const pos = index.positionAt(offset);
      assert.strictEqual(index.offsetAt(pos.line, pos.col), offset);
    }
  });
});

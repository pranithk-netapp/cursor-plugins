import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseSpec } from "../../core/parse";
import { buildIndex } from "../../core/specIndex";

const FIXTURES = path.join(__dirname, "..", "..", "..", "test-fixtures");

suite("core/parse (JSON/YAML parity on rpc.json vs rpc.yaml)", () => {
  const jsonText = fs.readFileSync(path.join(FIXTURES, "rpc.json"), "utf8");
  const yamlText = fs.readFileSync(path.join(FIXTURES, "rpc.yaml"), "utf8");

  const jsonResult = parseSpec(jsonText, "json");
  const yamlResult = parseSpec(yamlText, "yaml");

  test("both parse without errors", () => {
    assert.strictEqual(jsonResult.errors.length, 0);
    assert.strictEqual(yamlResult.errors.length, 0);
  });

  test("both produce the same normalized value", () => {
    assert.strictEqual(JSON.stringify(jsonResult.value), JSON.stringify(yamlResult.value));
  });

  test("both produce the same set of pointer keys in byPointer", () => {
    const jsonIndex = buildIndex(jsonResult);
    const yamlIndex = buildIndex(yamlResult);
    const jsonKeys = Array.from(jsonIndex.byPointer.keys()).sort();
    const yamlKeys = Array.from(yamlIndex.byPointer.keys()).sort();
    assert.deepStrictEqual(jsonKeys, yamlKeys);
  });

  test("the POST operation under /v1/nicMigration/prepare has key === 'post' in both", () => {
    const jsonIndex = buildIndex(jsonResult);
    const yamlIndex = buildIndex(yamlResult);

    const jsonOp = jsonIndex.operations.find(
      (op) => op.path === "/v1/nicMigration/prepare" && op.method === "post"
    );
    const yamlOp = yamlIndex.operations.find(
      (op) => op.path === "/v1/nicMigration/prepare" && op.method === "post"
    );

    assert.ok(jsonOp, "json operation not found");
    assert.ok(yamlOp, "yaml operation not found");
    assert.strictEqual(jsonOp!.node.key, "post");
    assert.strictEqual(yamlOp!.node.key, "post");
    assert.strictEqual(jsonOp!.operationId, "NetworkInterface_Move_Prepare");
    assert.strictEqual(yamlOp!.operationId, "NetworkInterface_Move_Prepare");
  });
});

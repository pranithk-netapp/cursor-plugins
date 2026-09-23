import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseSpec } from "../../core/parse";
import { buildIndex } from "../../core/specIndex";
import { generateExample } from "../../core/examples";
import { SpecIndex } from "../../core/types";

const FIXTURES = path.join(__dirname, "..", "..", "..", "test-fixtures");

function rpcIndex(): SpecIndex {
  const text = fs.readFileSync(path.join(FIXTURES, "rpc.json"), "utf8");
  return buildIndex(parseSpec(text, "json"));
}

suite("core/examples generateExample", () => {
  const index = rpcIndex();

  test("PrepareNicMigrationRequest (request mode): plain object with all required properties, correctly typed", () => {
    const schema = index.value.components.schemas.PrepareNicMigrationRequest;
    const example = generateExample(index, schema, { mode: "request" }) as Record<string, unknown>;

    assert.strictEqual(typeof example, "object");
    assert.ok(example !== null);
    assert.ok(!Array.isArray(example));

    const required: string[] = schema.required;
    assert.deepStrictEqual(required, [
      "vendorSubnetId",
      "svmName",
      "migrationUuid",
      "destinationHSClusterUuid",
      "destinationHostId",
      "destinationStampId",
      "destinationHSClusterNetworkConnectivity",
      "sourceHSClusterUuid",
    ]);

    for (const name of required) {
      assert.ok(Object.prototype.hasOwnProperty.call(example, name), `missing required property '${name}'`);
      // Every required property in this schema is declared `type: "string"`.
      assert.strictEqual(typeof example[name], "string", `'${name}' should be a string`);
    }
  });

  test("allOf merge: VirtualNetwork's example includes properties from both its own schema and its allOf branch (resource)", () => {
    const schema = index.value.components.schemas.VirtualNetwork;
    assert.ok(Array.isArray(schema.allOf), "sanity check: VirtualNetwork uses allOf in the fixture");

    const requestExample = generateExample(index, schema, { mode: "request" }) as Record<string, unknown>;
    // Own property (not readOnly): present.
    assert.ok(Object.prototype.hasOwnProperty.call(requestExample, "properties"));
    // Properties merged in from the allOf branch (#/components/schemas/resource), not readOnly: present.
    assert.ok(Object.prototype.hasOwnProperty.call(requestExample, "id"));
    assert.ok(Object.prototype.hasOwnProperty.call(requestExample, "location"));
    assert.ok(Object.prototype.hasOwnProperty.call(requestExample, "tags"));
  });

  test("readOnly properties are skipped in 'request' mode but present in 'response' mode (VirtualNetwork.etag)", () => {
    const schema = index.value.components.schemas.VirtualNetwork;
    assert.strictEqual(schema.properties.etag.readOnly, true, "sanity check on the fixture");

    const requestExample = generateExample(index, schema, { mode: "request" }) as Record<string, unknown>;
    const responseExample = generateExample(index, schema, { mode: "response" }) as Record<string, unknown>;

    assert.ok(!Object.prototype.hasOwnProperty.call(requestExample, "etag"), "etag (readOnly) should be skipped in request mode");
    assert.ok(Object.prototype.hasOwnProperty.call(responseExample, "etag"), "etag (readOnly) should be present in response mode");
    // Also true for the allOf-merged-in readOnly properties from `resource` (name, type).
    assert.ok(!Object.prototype.hasOwnProperty.call(requestExample, "name"));
    assert.ok(Object.prototype.hasOwnProperty.call(responseExample, "name"));
  });

  test("writeOnly properties are skipped in 'response' mode but present in 'request' mode (standalone schema)", () => {
    const schema = {
      type: "object",
      properties: {
        password: { type: "string", writeOnly: true },
        username: { type: "string" },
      },
    };

    const requestExample = generateExample(index, schema, { mode: "request" }) as Record<string, unknown>;
    const responseExample = generateExample(index, schema, { mode: "response" }) as Record<string, unknown>;

    assert.ok(Object.prototype.hasOwnProperty.call(requestExample, "password"));
    assert.ok(!Object.prototype.hasOwnProperty.call(responseExample, "password"));
    assert.ok(Object.prototype.hasOwnProperty.call(requestExample, "username"));
    assert.ok(Object.prototype.hasOwnProperty.call(responseExample, "username"));
  });

  test("cycle termination: a self-referential schema completes without infinite recursion", () => {
    // A schema whose "self" property $refs back to the schema itself. Not
    // tied to `index.value`, so a small fake index is enough here — only
    // `.value` is used for $ref resolution.
    const cyclic: any = { type: "object", properties: {} };
    cyclic.properties.self = { $ref: "#/x" };
    const fakeIndex = { value: { x: cyclic } } as unknown as SpecIndex;

    const result = generateExample(fakeIndex, cyclic);
    assert.strictEqual(typeof result, "object");
    assert.ok(result !== null);
  });

  test("enum fallback: a string schema with enum returns the first enum value", () => {
    const result = generateExample(index, { type: "string", enum: ["a", "b"] });
    assert.strictEqual(result, "a");
  });

  test("format fallback: uuid format returns a uuid-shaped string", () => {
    const result = generateExample(index, { type: "string", format: "uuid" });
    assert.strictEqual(typeof result, "string");
    assert.match(result as string, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  test("format fallback: date-time format returns an ISO-8601-like string", () => {
    const result = generateExample(index, { type: "string", format: "date-time" });
    assert.strictEqual(typeof result, "string");
    assert.match(result as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test("example/default/const precedence: example wins over default and enum", () => {
    const result = generateExample(index, { type: "string", example: "picked", default: "fallback", enum: ["x"] });
    assert.strictEqual(result, "picked");
  });

  test("array generation produces one item from `items`", () => {
    const result = generateExample(index, { type: "array", items: { type: "integer", minimum: 5 } });
    assert.deepStrictEqual(result, [5]);
  });
});

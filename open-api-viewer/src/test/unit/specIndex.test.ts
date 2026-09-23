import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseSpec } from "../../core/parse";
import { buildIndex } from "../../core/specIndex";
import { resolveRef } from "../../core/resolve";

const FIXTURES = path.join(__dirname, "..", "..", "..", "test-fixtures");

suite("core/specIndex on rpc.json", () => {
  const text = fs.readFileSync(path.join(FIXTURES, "rpc.json"), "utf8");
  const result = parseSpec(text, "json");
  const index = buildIndex(result);

  test("has 17 operations", () => {
    assert.strictEqual(index.operations.length, 17);
  });

  test("version is detected as 3.0", () => {
    assert.strictEqual(index.version, "3.0");
  });

  test("every non-external ref resolves to a defined node", () => {
    for (const ref of index.refs) {
      if (ref.external) {
        continue;
      }
      const resolved = resolveRef(index, ref.target);
      assert.ok(resolved, `ref ${ref.target} at ${ref.pointer} did not resolve`);
    }
  });

  test("components.size matches the fixture's actual component count (32 schemas + 4 responses + 2 securitySchemes)", () => {
    // Counted directly from rpc.json: components.schemas has 32 keys,
    // components.responses has 4 keys, components.securitySchemes has 2
    // keys, and there are no parameters/examples/requestBodies/headers/
    // links/callbacks components in this fixture.
    assert.strictEqual(index.components.size, 32 + 4 + 2);

    const schemaCount = Array.from(index.components.values()).filter((c) => c.type === "schemas").length;
    const responseCount = Array.from(index.components.values()).filter((c) => c.type === "responses").length;
    const securitySchemeCount = Array.from(index.components.values()).filter(
      (c) => c.type === "securitySchemes"
    ).length;
    assert.strictEqual(schemaCount, 32);
    assert.strictEqual(responseCount, 4);
    assert.strictEqual(securitySchemeCount, 2);
  });
});

suite("core/specIndex on broken-refs.json", () => {
  const text = fs.readFileSync(path.join(FIXTURES, "broken-refs.json"), "utf8");
  const result = parseSpec(text, "json");
  const index = buildIndex(result);

  test("the DoesNotExist ref is present with external:false but does not resolve", () => {
    const ref = index.refs.find((r) => r.target === "#/components/schemas/DoesNotExist");
    assert.ok(ref, "expected #/components/schemas/DoesNotExist ref to be indexed");
    assert.strictEqual(ref!.external, false);
    assert.strictEqual(resolveRef(index, ref!.target), undefined);
  });

  test("the external ref to other.yaml is marked external:true", () => {
    const ref = index.refs.find((r) => r.target === "other.yaml#/components/schemas/X");
    assert.ok(ref, "expected external ref to be indexed");
    assert.strictEqual(ref!.external, true);
  });

  test("UnusedSchema exists as a component but has no incoming refs", () => {
    const component = index.components.get("schemas/UnusedSchema");
    assert.ok(component);
    const incoming = index.refsByTarget.get(component!.pointer) ?? [];
    assert.strictEqual(incoming.length, 0);
  });
});

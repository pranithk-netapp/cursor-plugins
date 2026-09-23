import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseSpec } from "../../core/parse";
import { buildIndex } from "../../core/specIndex";
import { summarizeSchemaNode, summarizeOperationNode, summarizeRefTarget } from "../../core/summary";

const FIXTURES = path.join(__dirname, "..", "..", "..", "test-fixtures");

suite("core/summary on rpc.json", () => {
  const text = fs.readFileSync(path.join(FIXTURES, "rpc.json"), "utf8");
  const result = parseSpec(text, "json");
  const index = buildIndex(result);

  // From the fixture: PrepareNicMigrationRequest.required is exactly
  // ["vendorSubnetId","svmName","migrationUuid","destinationHSClusterUuid",
  //  "destinationHostId","destinationStampId",
  //  "destinationHSClusterNetworkConnectivity","sourceHSClusterUuid"] (8 of
  // its 10 properties); "destinationHSClusterProvisionedStorageAvailabilityZone"
  // and "destinationHSClusterPublicNetworkConnectivity" are NOT required.
  test("summarizeSchemaNode marks PrepareNicMigrationRequest's required properties with '*'", () => {
    const md = summarizeSchemaNode(index, "/components/schemas/PrepareNicMigrationRequest");

    assert.match(md, /\*\*PrepareNicMigrationRequest\*\*/);

    const requiredProps = [
      "vendorSubnetId",
      "svmName",
      "migrationUuid",
      "destinationHSClusterUuid",
      "destinationHostId",
      "destinationStampId",
      "destinationHSClusterNetworkConnectivity",
      "sourceHSClusterUuid",
    ];
    for (const prop of requiredProps) {
      assert.ok(md.includes(`- ${prop}*:`), `expected "${prop}" to be marked required in:\n${md}`);
    }

    const optionalProps = [
      "destinationHSClusterProvisionedStorageAvailabilityZone",
      "destinationHSClusterPublicNetworkConnectivity",
    ];
    for (const prop of optionalProps) {
      assert.ok(md.includes(`- ${prop}:`), `expected "${prop}" to be listed without '*' in:\n${md}`);
      assert.ok(!md.includes(`- ${prop}*:`), `expected "${prop}" NOT to be marked required in:\n${md}`);
    }
  });

  test("summarizeSchemaNode follows a $ref wrapper node to the target schema", () => {
    // The 404 response's schema property is itself a { $ref: ... } node;
    // pointing at it (rather than directly at the schema) should still
    // resolve to and describe the Error schema.
    const md = summarizeSchemaNode(
      index,
      "/paths/~1v1~1nicMigration~1prepare/post/responses/202/content/application~1json/schema"
    );
    assert.match(md, /\*\*NicMigrationAsyncResponse\*\*/);
    assert.ok(md.includes("- jobUuid:"));
  });

  test("summarizeSchemaNode merges allOf branch properties one level deep (VirtualNetwork -> resource)", () => {
    const md = summarizeSchemaNode(index, "/components/schemas/VirtualNetwork");
    assert.match(md, /\*\*VirtualNetwork\*\*/);
    // Own properties.
    assert.ok(md.includes("- etag:"));
    // Merged in from the allOf branch's $ref target (resource).
    assert.ok(md.includes("- id:"));
    assert.ok(md.includes("- location:"));
  });

  test("summarizeOperationNode describes a response component (StandardError-404)", () => {
    const md = summarizeOperationNode(index, "/components/responses/StandardError-404");
    assert.match(md, /\*\*StandardError-404\*\*/);
    assert.ok(md.includes("Not found"));
    assert.ok(md.includes("application/json"));
  });

  test("summarizeOperationNode describes a path parameter component-shaped node", () => {
    const md = summarizeOperationNode(
      index,
      "/paths/~1v1~1nicMigration~1{migrationUuid}/get/parameters/0"
    );
    assert.ok(md.includes("name: migrationUuid"));
    assert.ok(md.includes("in: path"));
    assert.ok(md.includes("required: true"));
  });

  test("summarizeRefTarget dispatches schemas vs responses vs an unknown pointer", () => {
    assert.match(
      summarizeRefTarget(index, "/components/schemas/Error"),
      /\*\*Error\*\*/
    );
    assert.match(
      summarizeRefTarget(index, "/components/responses/StandardError-500"),
      /\*\*StandardError-500\*\*/
    );
    assert.strictEqual(summarizeRefTarget(index, "/servers/0"), "`/servers/0`");
  });
});

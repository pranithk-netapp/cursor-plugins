import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseSpec } from "../../core/parse";
import { buildIndex } from "../../core/specIndex";
import { ALL_RULES, runAudit } from "../../core/audit/engine";
import { CATEGORY_MAX } from "../../core/audit/scoring";
import { AuditCategory } from "../../core/audit/types";

const FIXTURES = path.join(__dirname, "..", "..", "..", "test-fixtures");

function indexOf(fixture: string, lang: "json" | "yaml"): ReturnType<typeof buildIndex> {
  const text = fs.readFileSync(path.join(FIXTURES, fixture), "utf8");
  return buildIndex(parseSpec(text, lang));
}

suite("audit/engine rule catalog", () => {
  test("ALL_RULES has exactly 25 rules", () => {
    assert.strictEqual(ALL_RULES.length, 25);
  });

  test("each category's rule weights sum exactly to its category max", () => {
    const sums: Record<AuditCategory, number> = { security: 0, dataValidation: 0, quality: 0 };
    for (const rule of ALL_RULES) {
      sums[rule.category] += rule.weight;
    }
    assert.strictEqual(sums.security, CATEGORY_MAX.security, "security weights");
    assert.strictEqual(sums.dataValidation, CATEGORY_MAX.dataValidation, "dataValidation weights");
    assert.strictEqual(sums.quality, CATEGORY_MAX.quality, "quality weights");
    assert.strictEqual(CATEGORY_MAX.security, 30);
    assert.strictEqual(CATEGORY_MAX.dataValidation, 50);
    assert.strictEqual(CATEGORY_MAX.quality, 20);
  });

  test("no duplicate rule ids", () => {
    const ids = ALL_RULES.map((r) => r.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  });
});

suite("audit/engine on rpc.json (snapshot)", () => {
  const index = indexOf("rpc.json", "json");
  const report = runAudit(index);

  function ruleResult(id: string) {
    const r = report.ruleResults.find((rr) => rr.rule.id === id);
    assert.ok(r, `expected a rule result for ${id}`);
    return r!;
  }

  // Pinned from an actual run against test-fixtures/rpc.json (17 operations,
  // global ApiKey+SecretKey security, no 401/403/400 responses anywhere,
  // one https server, 32 component schemas). If a future change to the
  // rules or to rpc.json shifts these, update the pinned numbers deliberately.
  test("SEC006 (missing 401 on secured operations): 17 eligible, 17 findings", () => {
    const r = ruleResult("SEC006");
    assert.strictEqual(r.eligible, 17);
    assert.strictEqual(r.findings.length, 17);
  });

  test("SEC007 (missing 403 on secured operations): 17 eligible, 17 findings", () => {
    const r = ruleResult("SEC007");
    assert.strictEqual(r.eligible, 17);
    assert.strictEqual(r.findings.length, 17);
  });

  test("DV001 (string missing maxLength): 109 eligible, 106 findings", () => {
    const r = ruleResult("DV001");
    assert.strictEqual(r.eligible, 109);
    assert.strictEqual(r.findings.length, 106);
  });

  test("DV003 (numeric missing format): 2 eligible, 2 findings", () => {
    const r = ruleResult("DV003");
    assert.strictEqual(r.eligible, 2);
    assert.strictEqual(r.findings.length, 2);
  });

  test("DV005 (array missing maxItems): 10 eligible, 10 findings", () => {
    const r = ruleResult("DV005");
    assert.strictEqual(r.eligible, 10);
    assert.strictEqual(r.findings.length, 10);
  });

  test("category scores and total", () => {
    assert.deepStrictEqual(report.categories.security, { score: 24, max: 30 });
    assert.deepStrictEqual(report.categories.dataValidation, { score: 16, max: 50 });
    assert.deepStrictEqual(report.categories.quality, { score: 10, max: 20 });
    assert.strictEqual(report.total, 50);
  });
});

suite("audit/engine on insecure.yaml", () => {
  const index = indexOf("insecure.yaml", "yaml");
  const report = runAudit(index);

  function fired(id: string): boolean {
    const r = report.ruleResults.find((rr) => rr.rule.id === id);
    return !!r && r.findings.length > 0;
  }

  test("SEC001 fires (no global security, operation has no own security)", () => {
    assert.ok(fired("SEC001"));
  });

  test("SEC004 fires (apiKey securityScheme with in: query)", () => {
    assert.ok(fired("SEC004"));
  });

  test("SEC005 fires (server uses http://, not localhost)", () => {
    assert.ok(fired("SEC005"));
  });

  test("SEC008 fires (http/basic securityScheme)", () => {
    assert.ok(fired("SEC008"));
  });
});

suite("audit/engine 'off' override redistributes weight", () => {
  // A security-clean fixture: global security covers the one operation,
  // which has both 401 and 403 responses; the only declared server is
  // https; the only wrinkle is an *unused* apiKey-in-query scheme, which
  // exists purely so SEC004 has something to flag when it runs, and
  // nothing to flag once it's turned off.
  const text = JSON.stringify({
    openapi: "3.0.0",
    info: { title: "Clean", version: "1.0.0" },
    servers: [{ url: "https://example.com" }],
    security: [{ ApiKeyHeader: [] }],
    paths: {
      "/widgets": {
        get: {
          operationId: "getWidgets",
          responses: {
            "200": { description: "OK" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        ApiKeyHeader: { type: "apiKey", in: "header", name: "api-key" },
        QueryKey: { type: "apiKey", in: "query", name: "qk" },
      },
    },
  });
  const index = buildIndex(parseSpec(text, "json"));

  test("SEC004 finds the unused query-apiKey scheme when it runs normally", () => {
    const report = runAudit(index);
    const sec004 = report.ruleResults.find((r) => r.rule.id === "SEC004")!;
    assert.strictEqual(sec004.eligible, 2);
    assert.strictEqual(sec004.findings.length, 1);
    assert.ok(report.categories.security.score < 30);
  });

  test("with SEC004 off, security scores a perfect 30 (weight redistributed, no deduction possible)", () => {
    const report = runAudit(index, { SEC004: "off" });
    const sec004 = report.ruleResults.find((r) => r.rule.id === "SEC004")!;
    assert.strictEqual(sec004.off, true);
    assert.strictEqual(sec004.deduction, 0);
    assert.deepStrictEqual(report.categories.security, { score: 30, max: 30 });
  });
});

suite("audit/engine monotonicity", () => {
  function docWith(maxLength: boolean): string {
    return JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Mono", version: "1.0.0" },
      paths: {
        "/widgets": {
          get: {
            operationId: "getWidgets",
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        name: maxLength ? { type: "string", maxLength: 50 } : { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  test("adding maxLength to all strings never decreases the dataValidation score", () => {
    const withoutMaxLength = runAudit(buildIndex(parseSpec(docWith(false), "json")));
    const withMaxLength = runAudit(buildIndex(parseSpec(docWith(true), "json")));
    assert.ok(
      withMaxLength.categories.dataValidation.score >= withoutMaxLength.categories.dataValidation.score,
      `expected ${withMaxLength.categories.dataValidation.score} >= ${withoutMaxLength.categories.dataValidation.score}`
    );
  });
});

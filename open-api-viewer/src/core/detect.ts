// Cheap, regex-based OpenAPI/Swagger detection. Pure, no vscode dependency.

const HEAD_SCAN_CHARS = 4096;
const FULL_SCAN_MAX_LENGTH = 1_000_000;

const JSON_OPENAPI_RE = /"openapi"\s*:\s*"(3\.[01])(\.\d+)?"/;
const JSON_SWAGGER_RE = /"swagger"\s*:\s*"2\.0"/;
const YAML_OPENAPI_RE = /^openapi\s*:\s*['"]?(3\.[01])/m;
const YAML_SWAGGER_RE = /^swagger\s*:\s*['"]?2\.0/m;

function scan(sample: string): "3.0" | "3.1" | "2.0" | null {
  const jsonMatch = JSON_OPENAPI_RE.exec(sample);
  if (jsonMatch) {
    return jsonMatch[1] as "3.0" | "3.1";
  }
  if (JSON_SWAGGER_RE.test(sample)) {
    return "2.0";
  }
  const yamlMatch = YAML_OPENAPI_RE.exec(sample);
  if (yamlMatch) {
    return yamlMatch[1] as "3.0" | "3.1";
  }
  if (YAML_SWAGGER_RE.test(sample)) {
    return "2.0";
  }
  return null;
}

/**
 * Detect whether `text` looks like an OpenAPI 3.0/3.1 or Swagger 2.0
 * document. Checks the first 4096 characters first (cheap, covers the
 * common case of top-of-file `openapi`/`swagger` keys); if that misses and
 * the document is under 1MB, retries against the full text as a documented
 * fallback for files that reorder keys.
 */
export function detectOpenApi(text: string): "3.0" | "3.1" | "2.0" | null {
  const head = text.slice(0, HEAD_SCAN_CHARS);
  const headResult = scan(head);
  if (headResult) {
    return headResult;
  }
  if (text.length < FULL_SCAN_MAX_LENGTH) {
    return scan(text);
  }
  return null;
}

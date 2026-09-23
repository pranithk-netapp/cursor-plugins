// RFC 6901 JSON Pointer utilities. Pure, no vscode dependency.

/** Escape a single reference-token per RFC 6901: '~' -> '~0', '/' -> '~1'. */
export function encodeSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Reverse of encodeSegment: '~1' -> '/', '~0' -> '~' (order matters). */
export function decodeSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** Append one or more raw (unencoded) segments to a pointer, encoding as needed. */
export function joinPointer(base: string, ...segments: (string | number)[]): string {
  let result = base;
  for (const seg of segments) {
    const encoded = typeof seg === "number" ? String(seg) : encodeSegment(seg);
    result += "/" + encoded;
  }
  return result;
}

/**
 * Convert a `$ref` value into a local JSON Pointer, or null if it is not a
 * local (same-document) reference.
 *
 * Design choice: only fragment-only refs count as "pointers into this
 * document" — "#" (root) and "#/a/b" (a pointer). Anything with a non-empty
 * document part before the "#" (e.g. "other.yaml#/X") is external and is
 * not translatable to a pointer into *this* document, so it returns null
 * even though it technically carries a fragment. Refs with no "#" at all
 * (whole-document external refs) also return null.
 */
export function refToPointer(ref: string): string | null {
  if (ref === "#") {
    return "";
  }
  if (ref.startsWith("#/")) {
    return ref.slice(1);
  }
  return null;
}

/** Split a JSON Pointer into its decoded reference tokens. "" -> []. */
export function pointerToSegments(pointer: string): string[] {
  if (pointer === "") {
    return [];
  }
  const raw = pointer.startsWith("/") ? pointer.slice(1) : pointer;
  return raw.split("/").map(decodeSegment);
}

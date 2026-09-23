// Pure offset <-> line/col conversion. No vscode dependency (vscode.Position
// uses the same {line, character} shape but we keep our own so this module
// stays usable from plain Node unit tests).

export class LineIndex {
  /** lineStarts[i] = offset of the first character of line i. */
  private readonly lineStarts: number[];

  constructor(private readonly text: string) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10 /* \n */) {
        starts.push(i + 1);
      }
    }
    this.lineStarts = starts;
  }

  /** Convert a (line, col) pair (both 0-based) to a flat offset. */
  offsetAt(line: number, col: number): number {
    const clampedLine = Math.min(Math.max(line, 0), this.lineStarts.length - 1);
    const start = this.lineStarts[clampedLine];
    const nextStart =
      clampedLine + 1 < this.lineStarts.length ? this.lineStarts[clampedLine + 1] : this.text.length;
    const maxCol = Math.max(0, nextStart - start);
    return start + Math.min(Math.max(col, 0), maxCol);
  }

  /** Convert a flat offset to a (line, col) pair (both 0-based). */
  positionAt(offset: number): { line: number; col: number } {
    const clamped = Math.min(Math.max(offset, 0), this.text.length);
    // Binary search for the last line start <= clamped.
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.lineStarts[mid] <= clamped) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return { line: lo, col: clamped - this.lineStarts[lo] };
  }
}

export interface DiffLine {
  kind: "same" | "removed" | "added";
  text: string;
  left?: number;
  right?: number;
}

/** Bounded LCS: large changed regions fall back to a lossless remove/add view. */
export function diffDocumentLines(left: string, right: string): { lines: DiffLine[]; coarse: boolean } {
  const a = left === "" ? [] : left.split("\n");
  const b = right === "" ? [] : right.split("\n");
  const lines: DiffLine[] = [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    lines.push({ kind: "same", text: a[start], left: start + 1, right: start + 1 });
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const n = endA - start;
  const m = endB - start;
  const coarse = (n + 1) * (m + 1) > 250_000;
  let i = start;
  let j = start;
  const remove = () => { lines.push({ kind: "removed", text: a[i], left: ++i }); };
  const add = () => { lines.push({ kind: "added", text: b[j], right: ++j }); };
  if (coarse) {
    while (i < endA) remove();
    while (j < endB) add();
  } else {
    const width = m + 1;
    const dp = new Uint32Array((n + 1) * width);
    for (let x = n - 1; x >= 0; x--) {
      for (let y = m - 1; y >= 0; y--) {
        dp[x * width + y] = a[start + x] === b[start + y]
          ? dp[(x + 1) * width + y + 1] + 1
          : Math.max(dp[(x + 1) * width + y], dp[x * width + y + 1]);
      }
    }
    while (i < endA || j < endB) {
      if (i < endA && j < endB && a[i] === b[j]) {
        lines.push({ kind: "same", text: a[i], left: ++i, right: ++j });
      } else if (i < endA && (j === endB || dp[(i - start + 1) * width + j - start] >= dp[(i - start) * width + j - start + 1])) remove();
      else add();
    }
  }
  while (endA < a.length) {
    lines.push({ kind: "same", text: a[endA], left: ++endA, right: ++endB });
  }
  return { lines, coarse };
}

export interface DiffLine {
  kind: "same" | "removed" | "added";
  text: string;
  left?: number;
  right?: number;
}

/**
 * Line diff with a bounded Myers search. Unlike a bounded LCS matrix, the
 * search remains cheap when a large document has only a few inserted lines.
 * Truly large rewrites still use the lossless coarse fallback.
 */
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
  let i = start;
  let j = start;
  const remove = () => { lines.push({ kind: "removed", text: a[i], left: ++i }); };
  const add = () => { lines.push({ kind: "added", text: b[j], right: ++j }); };
  const operations = boundedMyers(a.slice(start, endA), b.slice(start, endB), 2_000);
  const coarse = operations === null;
  if (coarse) {
    while (i < endA) remove();
    while (j < endB) add();
  } else {
    for (const operation of operations) {
      if (operation.kind === "same") lines.push({ kind: "same", text: operation.text, left: ++i, right: ++j });
      else if (operation.kind === "removed") remove();
      else add();
    }
  }
  while (endA < a.length) {
    lines.push({ kind: "same", text: a[endA], left: ++endA, right: ++endB });
  }
  return { lines, coarse };
}

type DiffOperation = { kind: "same" | "removed" | "added"; text: string };

/** Return an edit script, or null when the edit distance exceeds maxD. */
function boundedMyers(a: string[], b: string[], maxD: number): DiffOperation[] | null {
  const n = a.length;
  const m = b.length;
  const trace: Map<number, number>[] = [];
  let frontier = new Map<number, number>([[1, 0]]);
  for (let d = 0; d <= maxD; d++) {
    const next = new Map<number, number>();
    for (let k = -d; k <= d; k += 2) {
      const down = frontier.get(k + 1) ?? -1;
      const right = (frontier.get(k - 1) ?? -1) + 1;
      let x = k === -d || (k !== d && down > right) ? down : right;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      next.set(k, x);
      if (x >= n && y >= m) {
        trace.push(next);
        return backtrackMyers(trace, a, b);
      }
    }
    trace.push(next);
    frontier = next;
  }
  return null;
}

function backtrackMyers(trace: Map<number, number>[], a: string[], b: string[]): DiffOperation[] {
  const operations: DiffOperation[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d > 0; d--) {
    const previous = trace[d - 1];
    const k = x - y;
    const down = previous.get(k + 1) ?? -1;
    const right = (previous.get(k - 1) ?? -1) + 1;
    const previousK = k === -d || (k !== d && down > right) ? k + 1 : k - 1;
    const previousX = previous.get(previousK) ?? 0;
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      operations.push({ kind: "same", text: a[x - 1] });
      x--; y--;
    }
    if (x === previousX) {
      operations.push({ kind: "added", text: b[y - 1] });
      y--;
    } else {
      operations.push({ kind: "removed", text: a[x - 1] });
      x--;
    }
  }
  while (x > 0 && y > 0) {
    operations.push({ kind: "same", text: a[x - 1] });
    x--; y--;
  }
  while (x > 0) { operations.push({ kind: "removed", text: a[x - 1] }); x--; }
  while (y > 0) { operations.push({ kind: "added", text: b[y - 1] }); y--; }
  return operations.reverse();
}

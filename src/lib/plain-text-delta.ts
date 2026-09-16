import type { DeltaOp, DeltaOps } from "../types/models";

/** Delta block terminators must be separate operations, including empty lines. */
export function splitDeltaLines(ops: DeltaOp[]): DeltaOp[] {
  return ops.flatMap(op => {
    if (typeof op.insert !== "string" || !/[\r\n]/.test(op.insert) || op.insert === "\n") return [op];
    const parts = op.insert.replace(/\r\n?/g, "\n").split("\n");
    const result: DeltaOp[] = [];
    parts.forEach((part, index) => {
      if (part) result.push({ ...op, insert: part });
      if (index < parts.length - 1) result.push({ ...op, insert: "\n" });
    });
    return result;
  });
}

export function plainTextToDelta(source: string): DeltaOps {
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  return { ops: splitDeltaLines([{ insert: text.endsWith("\n") ? text : `${text}\n` }]) };
}

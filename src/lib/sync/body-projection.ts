import { canonicalJson } from "./canonical-codec";
import { parseSyncJson } from "./strict-json";
import { isEncrypted } from "../document-crypto";

export function candidateBodyProjection(body: unknown): unknown {
  const parsed = typeof body === "string" ? parseSyncJson(body) : body;
  if (isEncrypted(parsed)) return parsed;
  const ops = (
    parsed as {
      ops: { insert: string; attributes?: Record<string, unknown> }[];
    }
  ).ops;
  const merged: { insert: string; attributes?: Record<string, unknown> }[] = [];
  for (const op of ops) {
    if (typeof op.insert !== "string")
      throw Error("候选正文投影尚不支持嵌入对象");
    const attrs =
      op.attributes && Object.keys(op.attributes).length
        ? op.attributes
        : undefined;
    if (!op.insert) continue;
    const previous = merged[merged.length - 1];
    if (
      previous &&
      canonicalJson(previous.attributes ?? {}) === canonicalJson(attrs ?? {})
    )
      previous.insert += op.insert;
    else
      merged.push({
        insert: op.insert,
        ...(attrs ? { attributes: attrs } : {}),
      });
  }
  return { ops: merged };
}

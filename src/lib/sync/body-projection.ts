import { canonicalJson } from "./canonical-codec";
import { parseSyncJson } from "./strict-json";
import { isEncrypted } from "../document-crypto";

export function candidateBodyProjection(body: unknown, depth = 0): unknown {
  if (depth > 16) throw Error("候选正文嵌套过深");
  const parsed = typeof body === "string" ? parseSyncJson(body) : body;
  if (isEncrypted(parsed)) return parsed;
  const ops = (
    parsed as {
      ops: {
        insert: string | Record<string, unknown>;
        attributes?: Record<string, unknown>;
      }[];
    }
  ).ops;
  const merged: {
    insert: string | Record<string, unknown>;
    attributes?: Record<string, unknown>;
  }[] = [];
  for (const op of ops) {
    if (typeof op.insert !== "string") {
      const insert = op.insert;
      if (!insert || Object.keys(insert).length !== 1)
        throw Error("不支持的候选嵌入对象");
      const project = (ops: unknown) =>
        (candidateBodyProjection({ ops }, depth + 1) as { ops: unknown }).ops;
      let projected: Record<string, unknown>;
      if (insert.table && typeof insert.table === "object") {
        const table = insert.table as Record<string, unknown>;
        const inline = (body: unknown) => ({
          ops: project((body as { ops: unknown }).ops),
        });
        projected = {
          table: {
            ...table,
            rows: (table.rows as { cells: Record<string, unknown>[] }[]).map(
              (row) => ({
                ...row,
                cells: row.cells.map((cell) => ({
                  ...cell,
                  content: inline(cell.content),
                  ...(cell.paragraphs
                    ? { paragraphs: (cell.paragraphs as unknown[]).map(inline) }
                    : {}),
                })),
              }),
            ),
          },
        };
      } else if (insert.blockquote && typeof insert.blockquote === "object") {
        const quote = insert.blockquote as Record<string, unknown>;
        projected = {
          blockquote: { ...quote, content: project(quote.content) },
        };
      } else if (insert.list && typeof insert.list === "object") {
        const list = insert.list as Record<string, unknown>;
        projected = {
          list: {
            ...list,
            items: (list.items as Record<string, unknown>[]).map((item) => ({
              ...item,
              content: project(item.content),
            })),
          },
        };
      } else throw Error("不支持的候选嵌入对象");
      merged.push({
        insert: projected,
        ...(op.attributes && Object.keys(op.attributes).length
          ? { attributes: op.attributes }
          : {}),
      });
      continue;
    }
    const attrs =
      op.attributes && Object.keys(op.attributes).length
        ? op.attributes
        : undefined;
    if (!op.insert) continue;
    const previous = merged[merged.length - 1];
    if (
      previous &&
      typeof previous.insert === "string" &&
      canonicalJson(previous.attributes ?? {}) === canonicalJson(attrs ?? {})
    )
      previous.insert += op.insert;
    else
      merged.push({
        insert: op.insert,
        ...(attrs ? { attributes: attrs } : {}),
      });
  }
  return {
    ops: merged,
    ...((parsed as { metadata?: unknown }).metadata !== undefined
      ? { metadata: (parsed as { metadata: unknown }).metadata }
      : {}),
  };
}

import { isCertifiedTable } from "./table-body-policy";
import { deltaToProseMirror, proseMirrorToDelta } from "../delta-converter";
import { normalizeEditorColor } from "../editor-color";
import type { DeltaOps } from "../../types/models";
import { canonicalJson } from "./canonical-codec";
import { candidateBodyProjection } from "./body-projection";

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const structural = new Set([
  "list",
  "blockquote",
  "code-block",
  "indent",
  "indent-explicit",
  "block-indent",
  "block-indent-explicit",
  "listStart",
  "taskChecked",
  "list-spread",
  "list-continuation",
  "list-block-start",
  "language",
  "code-meta",
  "code-title",
  "code-wrap",
  "code-collapsed",
  "blockquote-collapsed",
]);
export function hasStructuredBody(body: Record<string, unknown>): boolean {
  return (
    Array.isArray(body.ops) &&
    body.ops.some(
      (op) =>
        record(op) &&
        (record(op.insert) ||
          (record(op.attributes) &&
            Object.keys(op.attributes).some((key) => structural.has(key)))),
    )
  );
}

/** Candidate-only text plus recursively certified list/quote objects. */
export function isCertifiedStructuredBody(
  body: Record<string, unknown>,
  depth = 0,
): boolean {
  if (
    depth > 16 ||
    Object.keys(body).some((key) => key !== "ops") ||
    !Array.isArray(body.ops) ||
    !body.ops.length
  )
    return false;
  const ops = body.ops;
  let markedText = false;
  for (let index = 0; index < ops.length; index++) {
    const op = ops[index];
    if (record(op) && record(op.insert)) {
      if (!validEmbed(op, depth) || markedText) return false;
      const next = ops[index + 1];
      if (
        !record(next) ||
        next.insert !== "\n" ||
        (next.attributes !== undefined &&
          (!record(next.attributes) || Object.keys(next.attributes).length))
      )
        return false;
      continue;
    }
    if (
      !record(op) ||
      typeof op.insert !== "string" ||
      op.insert.includes("\r") ||
      Object.keys(op).some((k) => !["insert", "attributes"].includes(k))
    )
      return false;
    if (op.attributes !== undefined && !record(op.attributes)) return false;
    const attrs = (op.attributes ?? {}) as Record<string, unknown>;
    const line = op.insert === "\n";
    if (line) {
      if (attrs["code-block"] === true && markedText) return false;
      markedText = false;
    } else if (Object.keys(attrs).length) markedText = true;
    for (const [key, value] of Object.entries(attrs)) {
      if (structural.has(key) || key === "header") {
        if (!line) return false;
        if (["indent", "block-indent"].includes(key)) {
          if (
            !Number.isInteger(value) ||
            (value as number) < 1 ||
            (value as number) > 8
          )
            return false;
        } else if (key === "listStart") {
          if (!Number.isSafeInteger(value) || (value as number) < 1)
            return false;
        } else if (key === "header") {
          if (
            !Number.isInteger(value) ||
            (value as number) < 1 ||
            (value as number) > 6
          )
            return false;
        } else if (key === "list") {
          if (value !== "bullet" && value !== "ordered") return false;
        } else if (["language", "code-meta", "code-title"].includes(key)) {
          if (typeof value !== "string" || !value) return false;
          if (
            key === "language" &&
            /^(mermaid|flow|toc|math|latex)$/i.test(value.trim())
          )
            return false;
        } else if (key === "taskChecked") {
          if (typeof value !== "boolean") return false;
        } else if (key === "code-wrap") {
          if (value !== false) return false;
        } else if (value !== true) return false;
      } else {
        if (line) return false;
        if (["bold", "italic", "strike", "code", "highlight"].includes(key)) {
          if (value !== true) return false;
        } else if (["color", "background"].includes(key)) {
          if (
            typeof value !== "string" ||
            normalizeEditorColor(value) !== value
          )
            return false;
        } else if (key === "size") {
          if (!["small", "normal", "large", "huge"].includes(value as string))
            return false;
        } else return false;
      }
    }
    if (
      (attrs.background !== undefined && attrs.highlight !== true) ||
      (attrs.code && Object.keys(attrs).length > 1)
    )
      return false;
    if (!line && op.insert.includes("\n")) {
      const next = ops[index + 1];
      if (
        Object.keys(attrs).length ||
        !record(next) ||
        next.insert !== "\n" ||
        !record(next.attributes) ||
        next.attributes["code-block"] !== true
      )
        return false;
    }
  }
  const last = ops[ops.length - 1];
  if (!record(last) || last.insert !== "\n") return false;
  try {
    const restored = proseMirrorToDelta(
      deltaToProseMirror(body as unknown as DeltaOps),
    );
    // Reject misplaced attributes, inconsistent numbering/nesting, lossy combinations,
    // and changed embed boundaries. Do not silently rewrite the user's content.

    return (
      canonicalJson(candidateBodyProjection(body)) ===
      canonicalJson(candidateBodyProjection(restored))
    );
  } catch {
    return false;
  }
}

function validEmbed(op: Record<string, unknown>, depth: number): boolean {
  if (
    Object.keys(op).some((key) => !["insert", "attributes"].includes(key)) ||
    !record(op.insert) ||
    Object.keys(op.insert).length !== 1
  )
    return false;
  const attrs = op.attributes ?? {};
  if (
    !record(attrs) ||
    Object.entries(attrs).some(([key, value]) => {
      if (key === "indent")
        return (
          !Number.isInteger(value) ||
          (value as number) < 1 ||
          (value as number) > 8
        );
      return (
        !["indent-explicit", "blockquote", "blockquote-collapsed"].includes(
          key,
        ) || value !== true
      );
    })
  )
    return false;
  const insert = op.insert;
  const child = (ops: unknown) => isCertifiedStructuredBody({ ops }, depth + 1);
  if (record(insert.table)) {
    return (
      !Object.keys(attrs).some((key) => key.startsWith("blockquote")) &&
      isCertifiedTable(insert.table, (ops) => {
        if (
          !Array.isArray(ops) ||
          !ops.every(
            (item) =>
              record(item) &&
              typeof item.insert === "string" &&
              (!record(item.attributes) ||
                !Object.keys(item.attributes).some(
                  (key) => structural.has(key) || key === "header",
                )),
          )
        )
          return false;
        return child([...ops, { insert: "\n" }]);
      })
    );
  }
  if (record(insert.blockquote)) {
    const quote = insert.blockquote;
    return (
      quote.version === 1 &&
      Object.keys(quote).every((key) => ["version", "content"].includes(key)) &&
      attrs.blockquote === true &&
      child(quote.content)
    );
  }
  if (record(insert.list)) {
    const list = insert.list;
    return (
      !Object.keys(attrs).some((key) => key.startsWith("blockquote")) &&
      Object.keys(list).every((key) =>
        ["version", "ordered", "start", "spread", "items"].includes(key),
      ) &&
      list.version === 1 &&
      typeof list.ordered === "boolean" &&
      typeof list.spread === "boolean" &&
      Number.isSafeInteger(list.start) &&
      (list.start as number) >= 1 &&
      Array.isArray(list.items) &&
      list.items.length > 0 &&
      list.items.every(
        (item) =>
          record(item) &&
          Object.keys(item).every((key) =>
            ["checked", "content"].includes(key),
          ) &&
          (item.checked === null || typeof item.checked === "boolean") &&
          child(item.content),
      )
    );
  }
  return false;
}

/** Read only fields in the validated tree; nested inline marks also require capabilities. */
export function structuredBodyFeatures(
  body: Record<string, unknown>,
): string[] {
  const features = new Set<string>();
  const visit = (ops: unknown, depth: number) => {
    if (depth > 16 || !Array.isArray(ops)) return;
    for (const op of ops) {
      if (!record(op)) continue;
      if (
        record(op.attributes) &&
        ["color", "size", "highlight", "background"].some(
          (key) => record(op.attributes) && op.attributes[key] !== undefined,
        )
      )
        features.add("inline-appearance-v1");
      if (!record(op.insert)) continue;
      features.add(
        record(op.insert.table) ? "table-block-v1" : "structured-block-v1",
      );
      if (record(op.insert.table) && Array.isArray(op.insert.table.rows)) {
        for (const row of op.insert.table.rows)
          if (record(row) && Array.isArray(row.cells)) {
            for (const cell of row.cells)
              if (record(cell)) {
                if (record(cell.content)) visit(cell.content.ops, depth + 1);
                if (Array.isArray(cell.paragraphs))
                  for (const paragraph of cell.paragraphs)
                    if (record(paragraph)) visit(paragraph.ops, depth + 1);
              }
          }
      }
      if (record(op.insert.blockquote))
        visit(op.insert.blockquote.content, depth + 1);
      if (record(op.insert.list) && Array.isArray(op.insert.list.items))
        for (const item of op.insert.list.items)
          if (record(item)) visit(item.content, depth + 1);
    }
  };
  visit(body.ops, 0);
  return [...features];
}

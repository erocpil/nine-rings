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
        record(op.attributes) &&
        Object.keys(op.attributes).some((key) => structural.has(key)),
    )
  );
}

/** Candidate-only, all-string Delta subset. No embeds or special renderers. */
export function isCertifiedStructuredBody(
  body: Record<string, unknown>,
): boolean {
  if (
    Object.keys(body).some((key) => key !== "ops") ||
    !Array.isArray(body.ops) ||
    !body.ops.length
  )
    return false;
  const ops = body.ops;
  let markedText = false;
  for (let index = 0; index < ops.length; index++) {
    const op = ops[index];
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
    // and forms converted into embeds. Do not silently rewrite the user's content.
    if (restored.ops.some((op) => typeof op.insert !== "string")) return false;
    return (
      canonicalJson(candidateBodyProjection(body)) ===
      canonicalJson(candidateBodyProjection(restored))
    );
  } catch {
    return false;
  }
}

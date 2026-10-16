import { isCertifiedLinkAttributes } from "./link-body-policy";
import { hasPortableRenderedResources } from "./rendered-source-policy";
import { isCertifiedInlineAtomAttributes } from "./inline-atom-policy";
import {
  isCertifiedHTMLDetails,
  isCertifiedHTMLInline,
  isCertifiedHTMLStyle,
  isCertifiedHTMLSource,
} from "./html-body-policy";
import {
  FOOTNOTE_ATTRIBUTES,
  isCertifiedFootnoteReference,
  isCertifiedFootnotes,
} from "./footnote-body-policy";
import {
  isCertifiedBlockImage,
  isCertifiedInlineImage,
} from "./image-body-policy";
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
  "hard-break",
]);
export function hasStructuredBody(body: Record<string, unknown>): boolean {
  return (
    Array.isArray(body.ops) &&
    body.ops.some((op) => {
      if (!record(op)) return false;
      if (record(op.insert)) return true;
      const attrs = op.attributes;
      return (
        record(attrs) &&
        ((attrs.code === true && Object.keys(attrs).length > 1) ||
          Object.keys(attrs).some(
            (key) =>
              structural.has(key) ||
              FOOTNOTE_ATTRIBUTES.has(key) ||
              ["htmlStyle", "link", "linkTitle", "linkExplicit"].includes(key),
          ))
      );
    })
  );
}

/** Shape recursion is separate from the single document-wide semantic check. */
function certifiedBodyShape(body: Record<string, unknown>, depth = 0): boolean {
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
      if ("mathInline" in op.insert) {
        if (
          Object.keys(op).some(
            (key) => !["insert", "attributes"].includes(key),
          ) ||
          Object.keys(op.insert).length !== 1 ||
          !isCertifiedHTMLSource(op.insert.mathInline) ||
          (op.attributes !== undefined && !record(op.attributes)) ||
          !isCertifiedInlineAtomAttributes(
            (op.attributes ?? {}) as Record<string, unknown>,
          )
        )
          return false;
        markedText = true;
        continue;
      }
      if ("rawHtmlInline" in op.insert || "htmlAnchor" in op.insert) {
        if (
          Object.keys(op).some(
            (key) => !["insert", "attributes"].includes(key),
          ) ||
          (op.attributes !== undefined && !record(op.attributes)) ||
          !isCertifiedHTMLInline(
            op.insert,
            (op.attributes ?? {}) as Record<string, unknown>,
          )
        )
          return false;
        markedText = true;
        continue;
      }
      if (
        Object.keys(op.insert).length === 1 &&
        record(op.insert.inlineImage)
      ) {
        if (
          Object.keys(op).some(
            (key) => !["insert", "attributes"].includes(key),
          ) ||
          (op.attributes !== undefined && !record(op.attributes)) ||
          !isCertifiedInlineImage(
            op.insert.inlineImage,
            (op.attributes ?? {}) as Record<string, unknown>,
          )
        )
          return false;
        markedText = true;
        continue;
      }
      if (
        Array.isArray(op.insert.footnotes) &&
        (depth !== 0 || index !== ops.length - 2)
      )
        return false;
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
      !isCertifiedHTMLSource(op.insert) ||
      op.insert.includes("\r") ||
      Object.keys(op).some((k) => !["insert", "attributes"].includes(k))
    )
      return false;
    if (op.attributes !== undefined && !record(op.attributes)) return false;
    const attrs = (op.attributes ?? {}) as Record<string, unknown>;
    if (
      !isCertifiedFootnoteReference(op.insert, attrs) ||
      !isCertifiedLinkAttributes(attrs)
    )
      return false;
    if (op.insert === "\n" && attrs["hard-break"] === true) {
      if (Object.keys(attrs).length !== 1) return false;
      markedText = true;
      continue;
    }
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
          if (!isCertifiedHTMLSource(value)) return false;
        } else if (key === "taskChecked") {
          if (typeof value !== "boolean") return false;
        } else if (key === "code-wrap") {
          if (value !== false) return false;
        } else if (value !== true) return false;
      } else {
        if (line) return false;
        if (
          FOOTNOTE_ATTRIBUTES.has(key) ||
          ["link", "linkTitle", "linkExplicit"].includes(key)
        )
          continue;
        if (key === "htmlStyle") {
          if (!isCertifiedHTMLStyle(value)) return false;
          continue;
        }
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
    if (attrs.background !== undefined && attrs.highlight !== true)
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
  return record(last) && last.insert === "\n";
}

/** Never normalize away a mismatch: derive numbering once in full document context. */
export function isCertifiedStructuredBody(
  body: Record<string, unknown>,
): boolean {
  if (!certifiedBodyShape(body)) return false;
  try {
    const document = deltaToProseMirror(body as unknown as DeltaOps);
    if (!hasPortableRenderedResources(document)) return false;
    const restored = proseMirrorToDelta(document);
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
  if (record(attrs) && typeof op.insert.image === "string")
    return isCertifiedBlockImage(op.insert.image, attrs);
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
  const child = (ops: unknown) => certifiedBodyShape({ ops }, depth + 1);
  if (record(insert.htmlDetails))
    return (
      !Object.keys(attrs).some((key) => key.startsWith("blockquote")) &&
      isCertifiedHTMLDetails(insert.htmlDetails, child)
    );
  if (typeof insert.mathBlock === "string")
    return (
      !Object.keys(attrs).some((key) => key.startsWith("blockquote")) &&
      isCertifiedHTMLSource(insert.mathBlock)
    );
  if (typeof insert.rawHtml === "string")
    return (
      Object.keys(attrs).length === 0 && isCertifiedHTMLSource(insert.rawHtml)
    );
  if (insert.hr === true)
    return !Object.keys(attrs).some((key) => key.startsWith("blockquote"));
  if (Array.isArray(insert.footnotes))
    return (
      !Object.keys(attrs).some((key) => key.startsWith("blockquote")) &&
      isCertifiedFootnotes(insert.footnotes, child)
    );
  if (record(insert.table)) {
    return (
      !Object.keys(attrs).some((key) => key.startsWith("blockquote")) &&
      isCertifiedTable(insert.table, (ops) => {
        if (
          !Array.isArray(ops) ||
          !ops.every(
            (item) =>
              record(item) &&
              (typeof item.insert === "string" ||
                (record(item.insert) &&
                  Object.keys(item.insert).length === 1 &&
                  (record(item.insert.inlineImage) ||
                    "rawHtmlInline" in item.insert ||
                    "htmlAnchor" in item.insert ||
                    "mathInline" in item.insert))) &&
              (!record(item.attributes) ||
                !Object.keys(item.attributes).some(
                  (key) =>
                    (structural.has(key) && key !== "hard-break") ||
                    key === "header",
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
      Object.keys(quote).every((key) =>
        ["version", "content", "alert"].includes(key),
      ) &&
      (quote.alert === undefined ||
        (typeof quote.alert === "string" &&
          ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"].includes(
            quote.alert,
          ))) &&
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
      if (
        record(op.attributes) &&
        op.attributes.code === true &&
        Object.keys(op.attributes).length > 1
      )
        features.add("composed-inline-v1");
      if (record(op.attributes) && op.attributes.link !== undefined)
        features.add("document-links-v1");
      if (record(op.attributes) && op.attributes.footnoteRef !== undefined)
        features.add("footnotes-v1");
      if (record(op.attributes) && op.attributes.htmlStyle !== undefined)
        features.add("restricted-html-v1");
      if (record(op.attributes) && op.attributes["hard-break"] === true)
        features.add("hard-break-v1");
      if (record(op.attributes) && op.attributes["code-block"] === true) {
        const language =
          typeof op.attributes.language === "string"
            ? op.attributes.language.trim().toLowerCase()
            : "";
        if (language === "mermaid") features.add("mermaid-block-v1");
        if (language === "flow") features.add("flow-block-v1");
        if (language === "toc") features.add("automatic-toc-v1");
      }
      if (!record(op.insert)) continue;
      features.add(
        typeof op.insert.mathInline === "string" ||
          typeof op.insert.mathBlock === "string"
          ? "math-v1"
          : record(op.insert.table)
            ? "table-block-v1"
            : record(op.insert.htmlDetails) ||
                typeof op.insert.htmlAnchor === "string"
              ? "restricted-html-v1"
              : typeof op.insert.rawHtml === "string" ||
                  typeof op.insert.rawHtmlInline === "string"
                ? "inert-html-v1"
                : record(op.insert.inlineImage)
                  ? "inline-image-v1"
                  : Array.isArray(op.insert.footnotes)
                    ? "footnotes-v1"
                    : op.insert.hr === true
                      ? "horizontal-rule-v1"
                      : typeof op.insert.image === "string"
                        ? "block-image-v1"
                        : "structured-block-v1",
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
      if (record(op.insert.htmlDetails))
        visit(op.insert.htmlDetails.content, depth + 1);
      if (Array.isArray(op.insert.footnotes))
        for (const definition of op.insert.footnotes)
          if (record(definition)) visit(definition.content, depth + 1);
      if (record(op.insert.blockquote)) {
        if (op.insert.blockquote.alert !== undefined)
          features.add("github-alert-v1");
        visit(op.insert.blockquote.content, depth + 1);
      }
      if (record(op.insert.list) && Array.isArray(op.insert.list.items))
        for (const item of op.insert.list.items)
          if (record(item)) visit(item.content, depth + 1);
    }
  };
  visit(body.ops, 0);
  return [...features];
}

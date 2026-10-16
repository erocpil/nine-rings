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
      const { "hard-break": _break, ...marks } = attrs;
      if (!isCertifiedInlineAtomAttributes(marks)) return false;
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
        } else if (key === "color") {
          // Foreground ink is stored verbatim by the real textStyle converter.
          if (typeof value !== "string" || !normalizeEditorColor(value))
            return false;
        } else if (key === "background") {
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
    // Embedded newlines in text, including marked text, are certified only when
    // the full-document projection below preserves every character and mark.
    // Leading newlines which discard formatting still fail that comparison.
  }
  const last = ops[ops.length - 1];
  return record(last) && last.insert === "\n";
}

/** Older lists/quote embeds omit inferred, redundant attributes. Compare without
 * changing stored source. Only newly emitted markers at the same operation may be
 * ignored; explicit boundaries, numbering, text, nesting and other attributes survive.
 */
function matchesLegacyInferredAttributes(
  body: Record<string, unknown>,
  restored: DeltaOps,
) {
  // Compare semantic text runs, not arbitrary operation fragmentation. Keep all
  // attributes and boundaries; only the explicitly inferred fields below differ.
  const original = (candidateBodyProjection(body) as DeltaOps).ops;
  const emitted = (candidateBodyProjection(restored) as DeltaOps).ops;
  if (original.length !== emitted.length) return false;
  let inferred = false;
  const definitions = new Set<string>();
  for (const op of emitted) {
    if (record(op.insert) && Array.isArray(op.insert.footnotes))
      for (const definition of op.insert.footnotes)
        if (record(definition) && typeof definition.id === "string")
          definitions.add(definition.id);
  }
  const comparable = emitted.map((op, index) => {
    const before = original[index];
    if (
      record(before.insert) &&
      record(op.insert) &&
      Array.isArray(before.insert.footnotes) &&
      Array.isArray(op.insert.footnotes) &&
      before.insert.footnotes.length === op.insert.footnotes.length
    ) {
      const oldDefinitions = before.insert.footnotes;
      const footnotes = op.insert.footnotes.map((definition, at) => {
        const old = oldDefinitions[at];
        if (!record(definition) || !record(old) || old.id !== definition.id)
          return definition;
        const comparableDefinition = { ...definition };
        for (const field of ["number", "references"]) {
          if (old[field] === undefined && field in comparableDefinition) {
            delete comparableDefinition[field];
            inferred = true;
          }
        }
        return comparableDefinition;
      });
      return { ...op, insert: { ...op.insert, footnotes } };
    }
    if (
      typeof before.insert === "string" &&
      before.insert === op.insert &&
      typeof before.attributes?.footnoteRef === "string" &&
      before.attributes.footnoteRef === op.attributes?.footnoteRef &&
      definitions.has(before.attributes.footnoteRef)
    ) {
      const attributes = { ...op.attributes };
      for (const field of ["footnoteNumber", "footnoteOccurrence"] as const) {
        if (
          before.attributes?.[field] === undefined &&
          attributes[field] !== undefined
        ) {
          delete attributes[field];
          inferred = true;
        }
      }
      return { ...op, attributes };
    }
    if (
      record(before.insert) &&
      record(before.insert.blockquote) &&
      record(op.insert) &&
      record(op.insert.blockquote) &&
      before.attributes?.blockquote === undefined &&
      op.attributes?.blockquote === true
    ) {
      inferred = true;
      const attributes = { ...op.attributes };
      delete attributes.blockquote;
      return { ...op, attributes };
    }
    if (
      before.insert === "\n" &&
      op.insert === "\n" &&
      ["bullet", "ordered"].includes(String(before.attributes?.list)) &&
      before.attributes?.["list-block-start"] === undefined &&
      op.attributes?.["list-block-start"] === true
    ) {
      inferred = true;
      const attributes = { ...op.attributes };
      delete attributes["list-block-start"];
      return { ...op, attributes };
    }
    return op;
  });
  if (!inferred) return false;
  return (
    canonicalJson(candidateBodyProjection(body)) ===
      canonicalJson(candidateBodyProjection({ ops: comparable })) &&
    // The newly explicit representation must itself be stable, never mask a second loss.
    canonicalJson(candidateBodyProjection(restored)) ===
      canonicalJson(
        candidateBodyProjection(
          proseMirrorToDelta(deltaToProseMirror(restored)),
        ),
      )
  );
}

/** Derive numbering once in full document context; reject any unproven mismatch. */
export function isCertifiedStructuredBody(
  body: Record<string, unknown>,
): boolean {
  return inspectStructuredBody(body) === "certified";
}

/** Aggregate-only diagnosis: never returns source text, paths, node IDs or attributes. */
export function inspectStructuredBody(
  body: Record<string, unknown>,
):
  | "certified"
  | "invalid-shape"
  | "changed-tree"
  | "nonportable-resource"
  | "unstable-tree"
  | "roundtrip-mismatch"
  | "invalid-conversion" {
  try {
    // Infer old structural markers only in the comparison copy. Prove the full
    // document tree is unchanged both now and after another save/load cycle.
    const comparison = withLegacyStructuralMarkers(body);
    if (!certifiedBodyShape(comparison)) return "invalid-shape";
    const document = deltaToProseMirror(body as unknown as DeltaOps);
    if (
      comparison !== body &&
      canonicalJson(document) !==
        canonicalJson(deltaToProseMirror(comparison as unknown as DeltaOps))
    )
      return "changed-tree";
    if (!hasPortableRenderedResources(document)) return "nonportable-resource";
    const restored = proseMirrorToDelta(document);
    if (
      comparison !== body &&
      canonicalJson(document) !== canonicalJson(deltaToProseMirror(restored))
    )
      return "unstable-tree";
    // Reject misplaced attributes, inconsistent numbering/nesting, lossy combinations,
    // and changed embed boundaries. Do not silently rewrite the user's content.

    return canonicalJson(candidateBodyProjection(comparison)) ===
      canonicalJson(candidateBodyProjection(restored)) ||
      matchesLegacyInferredAttributes(comparison, restored) ||
      matchesSimpleQuoteEncoding(comparison, restored, document)
      ? "certified"
      : "roundtrip-mismatch";
  } catch {
    return "invalid-conversion";
  }
}

/** A paragraph-only quote has two legacy encodings. Flatten only for comparison;
 * do not flatten alerts, nested blocks or structural child attributes. */
function flatQuoteComparison(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const ops = body.ops as DeltaOps["ops"];
  let skipTerminator = -1;
  return {
    ...body,
    ops: ops.flatMap((op, index) => {
      if (index === skipTerminator) return [];
      if (!record(op.insert) || !record(op.insert.blockquote)) return [op];
      const quote = op.insert.blockquote;
      if (
        quote.version !== 1 ||
        Object.keys(quote).some(
          (key) => !["version", "content"].includes(key),
        ) ||
        !Array.isArray(quote.content) ||
        !quote.content.length ||
        ops[index + 1]?.insert !== "\n" ||
        Object.keys(ops[index + 1]?.attributes ?? {}).length > 0 ||
        !quote.content.every(
          (child) =>
            record(child) &&
            typeof child.insert === "string" &&
            (child.insert !== "\n" ||
              !Object.keys(record(child.attributes) ? child.attributes : {})
                .length ||
              (record(child.attributes) &&
                child.attributes["hard-break"] === true)),
        )
      )
        return [op];
      skipTerminator = index + 1;
      return (quote.content as DeltaOps["ops"]).map((child) =>
        child.insert === "\n" && child.attributes?.["hard-break"] !== true
          ? { insert: "\n", attributes: { ...op.attributes, blockquote: true } }
          : child,
      );
    }),
  };
}

function matchesSimpleQuoteEncoding(
  body: Record<string, unknown>,
  restored: DeltaOps,
  document: unknown,
): boolean {
  const before = flatQuoteComparison(body),
    after = flatQuoteComparison(restored as unknown as Record<string, unknown>);
  if (
    canonicalJson(candidateBodyProjection(before)) !==
      canonicalJson(candidateBodyProjection(after)) &&
    !matchesLegacyInferredAttributes(before, after as unknown as DeltaOps)
  )
    return false;
  // In particular, never merge two distinct adjacent quote blocks or drop attrs.
  const tree = canonicalJson(quoteTreeDefaults(document));
  return [before, after, restored].every(
    (source) =>
      tree === canonicalJson(quoteTreeDefaults(deltaToProseMirror(source))),
  );
}

function quoteTreeDefaults(node: unknown): unknown {
  if (!record(node)) return node;
  return {
    ...node,
    ...(node.type === "blockquote"
      ? {
          attrs: {
            indent: 0,
            indentExplicit: false,
            collapsed: false,
            alert: null,
            ...(record(node.attrs) ? node.attrs : {}),
          },
        }
      : {}),
    ...(Array.isArray(node.content)
      ? { content: node.content.map(quoteTreeDefaults) }
      : {}),
  };
}

function withLegacyStructuralMarkers(
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(body.ops)) return body;
  let inferred = false;
  let implicitBreak = false;
  const ops: unknown[] = [];
  for (let index = 0; index < body.ops.length; index++) {
    const op = body.ops[index],
      next = body.ops[index + 1];
    if (
      record(op) &&
      op.insert === "\n" &&
      !(record(op.attributes) && op.attributes["hard-break"] === true)
    ) {
      if (
        implicitBreak &&
        record(op.attributes) &&
        ["bullet", "ordered"].includes(String(op.attributes.list)) &&
        op.attributes["list-block-start"] === undefined
      ) {
        // The old leading-newline branch flushes pending list lines. Preserve
        // that group boundary when its newline is made explicit in this copy.
        ops.push({
          ...op,
          attributes: { ...op.attributes, "list-block-start": true },
        });
        inferred = true;
      } else ops.push(op);
      implicitBreak = false;
      continue;
    }
    if (
      record(op) &&
      typeof op.insert === "string" &&
      op.insert.length > 1 &&
      op.insert.startsWith("\n") &&
      (op.attributes === undefined ||
        (record(op.attributes) &&
          isCertifiedInlineAtomAttributes(op.attributes))) &&
      !(
        record(next) &&
        record(next.attributes) &&
        next.attributes["code-block"] === true
      )
    ) {
      // This is exactly the existing decoder's leading-newline interpretation.
      // Keep all inline marks. Do not split remaining newlines or code blocks.
      ops.push(
        {
          insert: "\n",
          attributes: {
            ...(record(op.attributes) ? op.attributes : {}),
            "hard-break": true,
          },
        },
        {
          insert: op.insert.slice(1),
          ...(op.attributes !== undefined ? { attributes: op.attributes } : {}),
        },
      );
      inferred = true;
      implicitBreak = true;
    } else ops.push(op);
    if (
      record(op) &&
      record(op.insert) &&
      op.insert.hr === true &&
      Object.keys(op.insert).length === 1 &&
      record(next) &&
      ((typeof next.insert === "string" &&
        next.insert.length > 0 &&
        !next.insert.startsWith("\n")) ||
        (record(next.insert) &&
          Object.keys(next.insert).length === 1 &&
          [
            "hr",
            "footnotes",
            "blockquote",
            "list",
            "table",
            "image",
            "mathBlock",
            "rawHtml",
            "htmlDetails",
          ].some((key) => key in (next.insert as Record<string, unknown>))))
    ) {
      ops.push({ insert: "\n" });
      inferred = true;
    }
  }
  return inferred ? { ...body, ops } : body;
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
      (attrs.blockquote === undefined || attrs.blockquote === true) &&
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

import {
  hasPortableRenderedResources,
  renderedResourceFeatures,
} from "./rendered-source-policy";
import { mdToDelta } from "../md-parser";
import { isCertifiedHTMLSource } from "./html-body-policy";
import {
  isCertifiedDocumentMetadata,
  isCertifiedBookmarks,
} from "./document-metadata-policy";
import type { JSONContent } from "@tiptap/core";
import { deltaToProseMirror } from "../delta-converter";
import { plainTextToDelta } from "../plain-text-delta";

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function sourcePreview(metadata: Record<string, unknown>): JSONContent | null {
  return typeof metadata.sourceText === "string" && ["flow", "mermaid"].includes(String(metadata.sourceLanguage))
    ? { type: "codeBlock", attrs: { language: metadata.sourceLanguage }, content: [{ type: "text", text: metadata.sourceText }] }
    : null;
}
export function metadataResourceFeatures(metadata: unknown): string[] {
  if (record(metadata)) {
    const preview = sourcePreview(metadata);
    if (preview) return renderedResourceFeatures(preview);
  }
  if (
    !record(metadata) ||
    typeof metadata.markdownSource !== "string" ||
    metadata.sourceFormat === "text"
  )
    return [];
  return renderedResourceFeatures(
    deltaToProseMirror(mdToDelta(metadata.markdownSource)),
  );
}
const containers = new Set([
  "paragraph",
  "heading",
  "codeBlock",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "footnotes",
  "footnoteDefinition",
  "htmlDetails",
]);
/** Only count node types covered by the candidate body policy, not arbitrary JSON. */
function nodeSize(node: JSONContent): number {
  if (node.type === "text" && typeof node.text === "string")
    return node.text.length;
  if (
    node.type === "hardBreak" ||
    node.type === "resizableImage" ||
    node.type === "image" ||
    node.type === "markdownImage" ||
    node.type === "horizontalRule" ||
    node.type === "rawHtml" ||
    node.type === "rawHtmlInline" ||
    node.type === "htmlAnchor" ||
    node.type === "mathInline" ||
    node.type === "mathBlock"
  )
    return 1;
  if (!node.type || !containers.has(node.type))
    throw Error("Uncertified node size");
  return (
    2 + (node.content ?? []).reduce((size, child) => size + nodeSize(child), 0)
  );
}
/** Complete known metadata only; unknown extension fields remain a separate gate. */
export function isCertifiedBodyMetadata(
  metadata: unknown,
  body: Record<string, unknown>,
): boolean {
  if (!record(metadata) || !isCertifiedDocumentMetadata(metadata)) return false;
  const documentBody = metadata.sourceFormat === "text" ? { ...body, metadata: { sourceFormat: "text" } } : body;
  if (typeof metadata.sourceText === "string") {
    if (metadata.sourceFormat !== "text" || metadata.sourceLanguage === "markdown") return false;
    const expected = deltaToProseMirror({ ...plainTextToDelta(metadata.sourceText), metadata: { sourceFormat: "text" } });
    if (JSON.stringify(expected.content) !== JSON.stringify(deltaToProseMirror(documentBody).content)) return false;
    const preview = sourcePreview(metadata);
    if (preview && !hasPortableRenderedResources(preview)) return false;
  }
  if (
    typeof metadata.markdownSource === "string" &&
    metadata.sourceFormat !== "text"
  ) {
    try {
      if (
        !hasPortableRenderedResources(
          deltaToProseMirror(mdToDelta(metadata.markdownSource)),
        )
      )
        return false;
    } catch {
      return false;
    }
  }
  if (metadata.bookmarks !== undefined) {
    try {
      if (
        !isCertifiedBookmarks(
          metadata.bookmarks,
          deltaToProseMirror(documentBody),
          nodeSize,
        )
      )
        return false;
    } catch {
      return false;
    }
  }
  if (metadata.referenceAnchors === undefined) return true;
  const anchors = metadata.referenceAnchors;
  if (!Array.isArray(anchors) || anchors.length > 10000) return false;
  if (!anchors.length) return true;
  let size: number;
  try {
    size = deltaToProseMirror(documentBody).content.reduce(
      (sum, node) => sum + nodeSize(node),
      0,
    );
  } catch {
    return false;
  }
  const ids = new Set<string>();
  return anchors.every((anchor) => {
    if (
      !record(anchor) ||
      Object.keys(anchor).some(
        (key) =>
          !["id", "from", "to", "kind", "preview", "deleted"].includes(key),
      ) ||
      typeof anchor.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(anchor.id) ||
      ids.has(anchor.id) ||
      !Number.isSafeInteger(anchor.from) ||
      !Number.isSafeInteger(anchor.to) ||
      (anchor.from as number) < 0 ||
      (anchor.to as number) < (anchor.from as number) ||
      (anchor.to as number) > size ||
      typeof anchor.kind !== "string" ||
      !["block", "position", "range"].includes(anchor.kind) ||
      !isCertifiedHTMLSource(anchor.preview) ||
      anchor.preview.length > 80 ||
      (anchor.deleted !== undefined && typeof anchor.deleted !== "boolean")
    )
      return false;
    if (anchor.kind === "position" && anchor.from !== anchor.to) return false;
    if (
      anchor.kind !== "position" &&
      anchor.from === anchor.to &&
      anchor.deleted !== true
    )
      return false;
    ids.add(anchor.id);
    return true;
  });
}

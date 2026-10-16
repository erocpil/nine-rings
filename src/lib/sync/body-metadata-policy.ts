import type { JSONContent } from "@tiptap/core";
import { deltaToProseMirror } from "../delta-converter";

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
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
]);
/** Only count node types covered by the candidate body policy, not arbitrary JSON. */
function nodeSize(node: JSONContent): number {
  if (node.type === "text" && typeof node.text === "string")
    return node.text.length;
  if (
    node.type === "hardBreak" ||
    node.type === "resizableImage" ||
    node.type === "image" ||
    node.type === "horizontalRule"
  )
    return 1;
  if (!node.type || !containers.has(node.type))
    throw Error("Uncertified node size");
  return (
    2 + (node.content ?? []).reduce((size, child) => size + nodeSize(child), 0)
  );
}
/** Stable references only; publication/source/bookmark metadata is a separate gate. */
export function isCertifiedBodyMetadata(
  metadata: unknown,
  body: Record<string, unknown>,
): boolean {
  if (
    !record(metadata) ||
    Object.keys(metadata).some((key) => key !== "referenceAnchors")
  )
    return false;
  if (metadata.referenceAnchors === undefined) return true;
  const anchors = metadata.referenceAnchors;
  if (!Array.isArray(anchors) || anchors.length > 10000) return false;
  if (!anchors.length) return true;
  let size: number;
  try {
    size = deltaToProseMirror(body).content.reduce(
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
      typeof anchor.preview !== "string" ||
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

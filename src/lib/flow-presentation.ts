import type { Node as PMNode } from "@tiptap/pm/model";
import type { DocumentMetadata } from "../types/models";

export function flowHeadingLevel(metadata?: DocumentMetadata): number {
  if (metadata?.presentationMode !== "flow") return 0;
  const level = metadata.flowHeadingLevel;
  return typeof level === "number" &&
    Number.isInteger(level) &&
    level >= 1 &&
    level <= 6
    ? level
    : 2;
}

/** Top-level headings delimit stages; parent headings and footnotes end the flow. */
export function flowBlockAttributes(
  doc: PMNode,
  level: number,
): Map<number, Record<string, string>> {
  const result = new Map<number, Record<string, string>>();
  if (!level) return result;
  let step = 0;
  let active = false;
  doc.forEach((node, pos) => {
    if (node.type.name === "footnotes") active = false;
    if (node.type.name === "heading") {
      if (node.attrs.level < level) active = false;
      if (node.attrs.level === level) {
        active = true;
        result.set(pos, {
          class: "flow-stage",
          "data-flow-step": String(++step),
        });
        return;
      }
    }
    if (active) result.set(pos, { class: "flow-body" });
  });
  return result;
}

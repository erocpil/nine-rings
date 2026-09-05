import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { deltaToProseMirror, isDelta, isProseMirror } from "./delta-converter";
import { collapsedHeadingContentRanges } from "./heading-fold";

export const READONLY_RENDERING_KEY = "nr:experimentalReadonlyRendering";
export const READONLY_RENDERING_EVENT = "nine-rings:readonly-rendering-change";
export function readonlyRenderingEnabled(): boolean {
  try {
    return localStorage.getItem(READONLY_RENDERING_KEY) === "true";
  } catch {
    return false;
  }
}
export function setReadonlyRenderingEnabled(enabled: boolean): void {
  localStorage.setItem(READONLY_RENDERING_KEY, String(enabled));
  window.dispatchEvent(new Event(READONLY_RENDERING_EVENT));
}

const supportedNodes = new Set([
  "doc",
  "paragraph",
  "heading",
  "text",
  "hardBreak",
  "horizontalRule",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
]);
const supportedMarks = new Set([
  "bold",
  "italic",
  "strike",
  "code",
  "link",
  "textStyle",
]);

/** Conservative gate: unknown node/mark types must never silently disappear. */
export function buildReadonlyDocument(
  content: unknown,
  schema: Schema,
): PMNode | null {
  try {
    const json = isProseMirror(content)
      ? content
      : isDelta(content)
        ? deltaToProseMirror(content)
        : null;
    const supported = (node: {
      type: string;
      content?: (typeof node)[];
      marks?: { type: string; attrs?: { href?: unknown } }[];
    }): boolean =>
      supportedNodes.has(node.type) &&
      (node.marks ?? []).every(
        (mark) =>
          supportedMarks.has(mark.type) &&
          (mark.type !== "link" ||
            /^(https?:|mailto:|tel:)/i.test(String(mark.attrs?.href ?? ""))),
      ) &&
      (node.content ?? []).every(supported);
    if (!json || !supported(json)) return null;
    const doc = schema.nodeFromJSON(json);
    doc.check();
    // A giant single structural block is not helped by top-level windowing.
    let oversized = false;
    doc.forEach((node) => {
      if (node.nodeSize > 50000) oversized = true;
    });
    return oversized ? null : doc;
  } catch {
    return null;
  }
}

export interface ReadingBlock {
  node: PMNode;
  pos: number;
  number: number;
}
export interface ReadingAnchor {
  position: number;
  offset: number;
}
export function readingBlocks(
  doc: PMNode,
  collapsed: ReadonlySet<string>,
): ReadingBlock[] {
  const ranges = collapsedHeadingContentRanges(doc, collapsed);
  const result: ReadingBlock[] = [];
  let rangeIndex = 0;
  doc.forEach((node, pos, index) => {
    while (rangeIndex < ranges.length && ranges[rangeIndex].to <= pos)
      rangeIndex++;
    if (
      rangeIndex < ranges.length &&
      pos >= ranges[rangeIndex].from &&
      pos < ranges[rangeIndex].to
    )
      return;
    result.push({ node, pos, number: index + 1 });
  });
  return result;
}

/** Rebuilt after measurements/folds, never on each scroll. Searches are O(log n). */
export class ReadingLayout {
  readonly offsets: number[] = [0];
  constructor(
    readonly blocks: ReadingBlock[],
    heights: ReadonlyMap<number, number>,
  ) {
    for (const block of blocks)
      this.offsets.push(
        this.total +
          (heights.get(block.pos) ??
            (block.node.type.name === "heading" ? 80 : 180)),
      );
  }
  get total(): number {
    return this.offsets[this.offsets.length - 1];
  }
  atOffset(offset: number): number {
    let low = 0,
      high = this.blocks.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.offsets[mid + 1] <= offset) low = mid + 1;
      else high = mid;
    }
    return Math.max(0, Math.min(low, this.blocks.length - 1));
  }
  atPosition(position: number): number {
    let low = 0,
      high = this.blocks.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.blocks[mid].pos <= position) low = mid + 1;
      else high = mid;
    }
    return Math.max(0, low - 1);
  }
  window(top: number, height: number): [number, number] {
    const buffer = Math.max(600, height * 1.5);
    return [
      this.atOffset(Math.max(0, top - buffer)),
      Math.min(this.blocks.length, this.atOffset(top + height + buffer) + 1),
    ];
  }
}

// One-shot, in-memory handoff to the full editor. Never written into note data.
const handoffs = new Map<string, ReadingAnchor>();
export function handoffReadingAnchor(id: string, anchor: ReadingAnchor): void {
  if (handoffs.size >= 100) handoffs.delete(handoffs.keys().next().value!);
  handoffs.set(id, anchor);
}
export function takeReadingAnchor(id: string): ReadingAnchor | undefined {
  const anchor = handoffs.get(id);
  handoffs.delete(id);
  return anchor;
}

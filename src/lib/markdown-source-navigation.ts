import { plainTextToDelta } from "./plain-text-delta";
import { documentSourceLanguage } from "./document-language";
import { textWeight } from "./delta-content-weight";
import type { DeltaOps, DocumentBookmark, DocumentReferenceAnchor } from "../types/models";
import type { JSONContent } from "@tiptap/core";
import { deltaToProseMirror } from "./delta-converter";
import { diffDocumentLines } from "./document-diff";
import { mdToDelta, type MarkdownSourceSpan } from "./md-parser";
import {
  renderedNodeText,
  renderedPositionMap,
  renderedTextblockMap,
  sourcePositionMap,
  sourceOffsetToWeight,
  weightToSourceOffset,
} from "./markdown-view-position";

export interface SourceBookmark extends DocumentBookmark {
  offset: number;
  blockNumber: number;
}
interface Anchor {
  bookmark: DocumentBookmark;
  offset: number;
  part: number;
}
export interface SourceEditRange {
  from: number;
  to: number;
}

/** Map a textarea edit by its unchanged prefix/suffix, keeping anchors with the old text. */
export function sourceEditMapping(
  before: string,
  after: string,
  range?: SourceEditRange,
) {
  // Selection bounds disambiguate deleting one of several identical lines.
  // A whole-document replacement instead uses the unchanged text as evidence.
  const bounded =
    range && !(range.from === 0 && range.to === before.length)
      ? range
      : undefined;
  let from = 0;
  while (
    from < (bounded?.from ?? before.length) &&
    from < after.length &&
    before[from] === after[from]
  )
    from++;
  let oldEnd = before.length,
    newEnd = after.length;
  while (
    oldEnd > Math.max(from, bounded?.to ?? from) &&
    newEnd > from &&
    before[oldEnd - 1] === after[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  return (offset: number) =>
    offset < from
      ? offset
      : offset >= oldEnd
        ? offset + newEnd - oldEnd
        : from + Math.min(offset - from, newEnd - from);
}

/** Whole-buffer paste/repair can contain several separate edits. Keep unchanged
 * lines between them, with a bounded diff and unique-line fallback for big files. */
function sourceAnchorMapping(
  before: string,
  after: string,
  range?: SourceEditRange,
) {
  const fallback = sourceEditMapping(before, after, range);
  if (range && !(range.from === 0 && range.to === before.length))
    return fallback;
  const oldLines = before.split(/\r\n|\r|\n/),
    newLines = after.split(/\r\n|\r|\n/);
  const starts = (source: string) => [
    0,
    ...Array.from(
      source.matchAll(/\r\n|\r|\n/g),
      (match) => match.index! + match[0].length,
    ),
  ];
  const oldStarts = starts(before),
    newStarts = starts(after);
  const matches = new Map<number, number>();
  for (const line of diffDocumentLines(oldLines.join("\n"), newLines.join("\n"))
    .lines) {
    if (line.kind === "same") matches.set(line.left! - 1, line.right! - 1);
  }
  const unique = new Map<string, number>();
  newLines.forEach((line, index) =>
    unique.set(line, unique.has(line) ? -1 : index),
  );
  return (offset: number) => {
    let low = 0,
      high = oldStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (oldStarts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    const line =
      matches.get(low) ??
      (oldLines[low]?.trim() ? unique.get(oldLines[low]) : undefined);
    return line !== undefined && line >= 0
      ? newStarts[line] +
          Math.min(offset - oldStarts[low], newLines[line].length)
      : fallback(offset);
  };
}

function parse(source: string, plain = false) {
  const spans: MarkdownSourceSpan[] = [];
  const delta = plain ? { ...plainTextToDelta(source), metadata: { sourceFormat: "text" as const } } : mdToDelta(source, spans);
  const doc = deltaToProseMirror(delta);
  let map = sourcePositionMap(source, { delta, spans });
  if (plain) {
    let offset = 0, weight = 0;
    map = source.split("\n").map(line => {
      const from = offset, weightFrom = weight;
      const textOffsets = new Uint32Array(textWeight(line));
      let index = 0;
      for (let i = 0; i < line.length; i++) if (!/\s/.test(line[i])) textOffsets[index++] = from + i;
      offset += line.length + 1;
      weight += textWeight(line);
      return { from, to: from + line.length, weightFrom, weightTo: weight, textOffsets: textOffsets.length ? textOffsets : undefined };
    });
  }
  const blocks = renderedTextblockMap(doc);
  const outline = renderedPositionMap(doc).flatMap((entry) => {
    const node = doc.content?.[entry.index];
    return node?.type === "heading"
      ? [
          {
            pos: entry.position,
            level: Number(node.attrs?.level) || 1,
            text: renderedNodeText(node).trim() || "未命名标题",
            offset: weightToSourceOffset(source, entry.from, map),
          },
        ]
      : [];
  });
  return { delta, doc, map, blocks, outline };
}

/** Map precise targets through source edits using rendered text, so Markdown
 * delimiters do not become part of the coordinate system. */
export function mapSourceReferences(before: JSONContent, after: JSONContent, anchors: DocumentReferenceAnchor[]): DocumentReferenceAnchor[] {
  if (!anchors.length) return [];
  const flatten = (doc: JSONContent) => {
    const inlineText = (node: JSONContent): string => node.type === "text" ? node.text ?? "" : node.type === "hardBreak" ? "\n" : node.content ? node.content.map(inlineText).join("") : "\ufffc";
    const textblocks = (node: JSONContent): JSONContent[] => ["paragraph", "heading", "codeBlock"].includes(node.type ?? "") ? [node] : (node.content ?? []).flatMap(textblocks);
    const roots = (doc.content ?? []).map(textblocks);
    let offset = 0;
    const blocks = renderedTextblockMap(doc).map(block => {
      const node = block.textblock === null ? doc.content?.[block.index] : roots[block.index]?.[block.textblock];
      const text = node ? inlineText(node) : block.text;
      const entry = { ...block, text, offset };
      offset += text.length + 1;
      return entry;
    });
    return { blocks, text: blocks.map(block => block.text).join("\n") };
  };
  const old = flatten(before), next = flatten(after);
  const nextRoots = renderedPositionMap({ type: "doc", content: [...after.content ?? [], { type: "horizontalRule" }] });
  const mapping = sourceAnchorMapping(old.text, next.text);
  const toOffset = (position: number) => {
    const block = old.blocks.find((_block, i) => position < (old.blocks[i + 1]?.position ?? Infinity)) ?? old.blocks[old.blocks.length - 1];
    return block ? block.offset + Math.max(0, Math.min(block.text.length, position - block.position - 1)) : 0;
  };
  const toPosition = (offset: number, blockStart: boolean) => {
    const block = next.blocks.find((_block, i) => offset < (next.blocks[i + 1]?.offset ?? Infinity)) ?? next.blocks[next.blocks.length - 1];
    return block ? block.position + (blockStart ? 0 : 1 + Math.min(block.text.length, Math.max(0, offset - block.offset))) : 0;
  };
  return anchors.map(anchor => {
    if (anchor.deleted) return anchor;
    const oldBlocks = anchor.kind === "block" ? old.blocks.filter(block => block.position >= anchor.from && block.position < anchor.to) : [];
    const oldStart = oldBlocks[0]?.offset ?? toOffset(anchor.from);
    const last = oldBlocks[oldBlocks.length - 1];
    const start = mapping(oldStart), end = mapping(last ? last.offset + last.text.length : toOffset(anchor.to));
    const from = toPosition(start, anchor.kind === "block");
    const block = anchor.kind === "block" ? next.blocks.find(block => block.position === from) : undefined;
    const root = block ? nextRoots[block.index] : undefined;
    return { ...anchor, from: root?.position ?? from, to: anchor.kind === "position" ? from : root ? nextRoots[root.index + 1].position : Math.max(from, toPosition(end, false)), ...((anchor.kind !== "position" && end <= start && (last?.text.length ?? 1) > 0) || (anchor.kind === "position" && oldStart < old.text.length && mapping(oldStart + 1) <= start) ? { deleted: true } : {}) };
  });
}

/** One immutable source revision; autosave and navigation share the lazy parse. */
export class SourceNavigationDocument {
  private parsed?: ReturnType<typeof parse>;
  private cached?: DeltaOps;
  constructor(
    readonly source: string,
    private anchors: Anchor[],
    private metadata: DeltaOps["metadata"],
    private unchanged?: DeltaOps,
    private referenceBase?: DeltaOps,
  ) {}
  private get model() {
    return (this.parsed ??= parse(this.source, documentSourceLanguage(this.metadata) !== "markdown"));
  }
  get document() { return this.model.doc; }
  get language() { return documentSourceLanguage(this.metadata); }
  get previewDocument(): JSONContent {
    const language = documentSourceLanguage(this.metadata);
    return language === "flow" || language === "mermaid"
      ? { type: "doc", content: [{ type: "codeBlock", attrs: { language, diagram: true }, content: this.source ? [{ type: "text", text: this.source }] : [] }] }
      : this.document;
  }
  get referenceAnchors() {
    if (this.unchanged) return this.unchanged.metadata?.referenceAnchors ?? [];
    const base = this.referenceBase ?? this.unchanged;
    const anchors = base?.metadata?.referenceAnchors ?? this.metadata?.referenceAnchors ?? [];
    if (!anchors.length) return [];
    return base ? mapSourceReferences(deltaToProseMirror(base), this.model.doc, anchors) : anchors;
  }
  referenceOffset(id: string) {
    const anchor = this.referenceAnchors.find(item => item.id === id && !item.deleted);
    if (!anchor) return undefined;
    if (documentSourceLanguage(this.metadata) !== "markdown") return this.offsetAt(anchor.from);
    const block = this.model.blocks.find((_block, i) => anchor.from < (this.model.blocks[i + 1]?.position ?? Infinity));
    if (!block) return 0;
    const span = this.model.map.find(item => item.weightTo > block.from);
    const raw = span ? this.source.slice(span.from, span.to) : "";
    const textStart = raw.indexOf(block.text);
    return textStart >= 0 ? span!.from + textStart + Math.max(0, anchor.from - block.position - 1) : this.offsetAt(anchor.from);
  }
  get outline() {
    if (documentSourceLanguage(this.metadata) !== "markdown") return [];
    return this.model.outline;
  }
  offsetAt(position: number) {
    const blocks = this.model.blocks;
    const block =
      blocks.find(
        (entry, i) =>
          entry.position <= position &&
          (blocks[i + 1]?.position ?? Infinity) > position,
      ) ?? blocks[0];
    if (block && documentSourceLanguage(this.metadata) !== "markdown") {
      const span = this.model.map[block.index];
      return Math.min(this.source.length, (span?.from ?? 0) + Math.max(0, Math.min(block.text.length, position - block.position - 1)));
    }
    return block ? weightToSourceOffset(this.source, block.from, this.model.map) : 0;
  }
  blockAt(offset: number) {
    if (documentSourceLanguage(this.metadata) !== "markdown") {
      const index = this.model.map.findIndex((span, i, all) => span.from <= offset && (all[i + 1]?.from ?? Infinity) > offset);
      return this.model.blocks[Math.min(Math.max(0, index), this.model.blocks.length - 1)];
    }
    const weight = sourceOffsetToWeight(this.source, offset, this.model.map);
    return (
      this.model.blocks.find((block) => block.to > weight) ??
      this.model.blocks[this.model.blocks.length - 1]
    );
  }
  get bookmarks(): SourceBookmark[] {
    return this.anchors.flatMap(({ bookmark, offset, part }) => {
      const plain = documentSourceLanguage(this.metadata) !== "markdown";
      const span = plain ? undefined : this.model.map.find((entry) => entry.to >= offset);
      const candidates = span
        ? this.model.blocks.filter(
            (block) => block.from < span.weightTo && block.to > span.weightFrom,
          )
        : [];
      // Table cells share a source line. Keep their structural order instead of
      // interpolating character widths, which changes when another cell is edited.
      const block =
        candidates[Math.min(part, candidates.length - 1)] ??
        this.blockAt(offset);
      return block
        ? [
            {
              ...bookmark,
              offset,
              blockNumber: block.index + 1,
              position: this.unchanged ? bookmark.position : block.position + 1 + (plain ? Math.max(0, offset - (this.model.map[block.index]?.from ?? 0)) : 0),
              preview: this.unchanged
                ? bookmark.preview
                : block.text.trim().slice(0, 80) || "空白段落",
            },
          ]
        : [];
    }).sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt));
  }
  private withBookmarkAnchors(anchors: Anchor[]) {
    let unchanged = this.unchanged;
    if (unchanged) {
      const metadata = { ...unchanged.metadata };
      const bookmarks = anchors.map(anchor => anchor.bookmark);
      if (bookmarks.length) metadata.bookmarks = bookmarks;
      else delete metadata.bookmarks;
      unchanged = { ...unchanged, metadata };
    }
    return new SourceNavigationDocument(this.source, anchors, this.metadata, unchanged, this.referenceBase);
  }
  toggleBookmarkAt(offset: number) {
    const block = this.blockAt(Math.max(0, Math.min(this.source.length, offset)));
    if (!block) return this;
    const position = block.position + 1;
    const existing = this.bookmarks.find(bookmark => bookmark.position === position);
    if (existing) return this.withBookmarkAnchors(this.anchors.filter(anchor => anchor.bookmark.id !== existing.id));

    const bookmark: DocumentBookmark = {
      id: globalThis.crypto?.randomUUID?.() ?? `bookmark-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      position,
      preview: block.text.trim().slice(0, 80) || "空白段落",
      createdAt: new Date().toISOString(),
    };
    const sourceOffset = this.offsetAt(position);
    const span = this.model.map.find(entry => entry.to >= sourceOffset);
    const candidates = span
      ? this.model.blocks.filter(candidate => candidate.from < span.weightTo && candidate.to > span.weightFrom)
      : [];
    const part = Math.max(0, candidates.findIndex(candidate => candidate.position === block.position));
    return this.withBookmarkAnchors([...this.anchors, { bookmark, offset: sourceOffset, part }]);
  }
  removeBookmark(id: string) {
    if (!this.anchors.some(anchor => anchor.bookmark.id === id)) return this;
    return this.withBookmarkAnchors(this.anchors.filter(anchor => anchor.bookmark.id !== id));
  }
  renameBookmark(id: string, label: string) {
    if (!this.anchors.some(anchor => anchor.bookmark.id === id)) return this;
    const normalized = label.trim();
    return this.withBookmarkAnchors(this.anchors.map(anchor => anchor.bookmark.id === id
      ? { ...anchor, bookmark: { ...anchor.bookmark, ...(normalized ? { label: normalized } : { label: undefined }) } }
      : anchor));
  }
  read(): DeltaOps {
    if (this.unchanged) return this.unchanged;
    return (this.cached ??= {
      ...(documentSourceLanguage(this.metadata) === "markdown" ? this.model.delta : plainTextToDelta(this.source)),
      metadata: {
        ...this.metadata,
        sourceFormat: documentSourceLanguage(this.metadata) === "markdown" ? "markdown" : "text",
        ...(documentSourceLanguage(this.metadata) === "markdown" ? { markdownSource: this.source } : { sourceText: this.source }),
        referenceAnchors: this.referenceAnchors,
        bookmarks: this.bookmarks.map(
          ({ offset: _offset, blockNumber: _block, ...bookmark }) => bookmark,
        ),
      },
    });
  }
  next(text: string, range?: SourceEditRange) {
    const map = this.anchors.length
      ? sourceAnchorMapping(this.source, text, range)
      : sourceEditMapping(this.source, text, range);
    return new SourceNavigationDocument(
      text,
      this.anchors.map((anchor) => ({ ...anchor, offset: map(anchor.offset) })),
      this.metadata,
      undefined,
      this.referenceBase ?? this.unchanged,
    );
  }
  copy() {
    return new SourceNavigationDocument(
      this.source,
      this.anchors,
      this.metadata,
      this.unchanged,
      this.referenceBase,
    );
  }
  static from(source: string, content: DeltaOps) {
    const result = new SourceNavigationDocument(
      source,
      [],
      content.metadata,
      content,
    );
    if (!content.metadata?.bookmarks?.length) return result;
    if (documentSourceLanguage(content.metadata) !== "markdown") {
      result.anchors = content.metadata.bookmarks.map(bookmark => ({ bookmark, offset: result.offsetAt(bookmark.position), part: 0 }));
      return result;
    }
    const map = result.model.map;
    const blocks = renderedTextblockMap(deltaToProseMirror(content));
    result.anchors = content.metadata.bookmarks.map((bookmark) => {
      const block =
        blocks.find(
          (entry, i) =>
            entry.position <= bookmark.position &&
            (blocks[i + 1]?.position ?? Infinity) > bookmark.position,
        ) ?? blocks[0];
      const span = block && map.find((entry) => entry.weightTo > block.from);
      const candidates = span
        ? result.model.blocks.filter(
            (entry) => entry.from < span.weightTo && entry.to > span.weightFrom,
          )
        : [];
      return {
        bookmark,
        offset: span?.from ?? 0,
        part: Math.max(
          0,
          candidates.findIndex((entry) => entry.from === block?.from),
        ),
      };
    });
    return result;
  }
}

/** Keep a bounded, text-only anchor history so native textarea undo restores bookmarks too. */
export class SourceNavigationSession {
  current: SourceNavigationDocument;
  private history = new Map<string, SourceNavigationDocument>();
  private size = 0;
  constructor(source: string, content: DeltaOps) {
    this.current = SourceNavigationDocument.from(source, content);
    this.remember(this.current);
  }
  private remember(document: SourceNavigationDocument) {
    const previous = this.history.get(document.source);
    if (previous) this.size -= document.source.length;
    this.history.set(document.source, document.copy());
    this.size += document.source.length;
    while (
      this.history.size > 12 ||
      (this.size > 1_000_000 && this.history.size > 1)
    ) {
      const first = this.history.keys().next().value!;
      this.history.delete(first);
      this.size -= first.length;
    }
  }
  update(text: string, range?: SourceEditRange) {
    const old = this.history.get(text);
    this.current = old?.copy() ?? this.current.next(text, range);
    if (!old) this.remember(this.current);
    return this.current;
  }
  toggleBookmarkAt(offset: number) {
    this.current = this.current.toggleBookmarkAt(offset);
    this.remember(this.current);
    return this.current;
  }
  removeBookmark(id: string) {
    this.current = this.current.removeBookmark(id);
    this.remember(this.current);
    return this.current;
  }
  renameBookmark(id: string, label: string) {
    this.current = this.current.renameBookmark(id, label);
    this.remember(this.current);
    return this.current;
  }
}

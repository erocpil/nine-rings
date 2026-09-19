import type { DeltaOps, DocumentBookmark } from "../types/models";
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

function parse(source: string) {
  const spans: MarkdownSourceSpan[] = [];
  const delta = mdToDelta(source, spans);
  const doc = deltaToProseMirror(delta);
  const map = sourcePositionMap(source, { delta, spans });
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

/** One immutable source revision; autosave and navigation share the lazy parse. */
export class SourceNavigationDocument {
  private parsed?: ReturnType<typeof parse>;
  private cached?: DeltaOps;
  constructor(
    readonly source: string,
    private anchors: Anchor[],
    private metadata: DeltaOps["metadata"],
    private unchanged?: DeltaOps,
  ) {}
  private get model() {
    return (this.parsed ??= parse(this.source));
  }
  get outline() {
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
    return block
      ? weightToSourceOffset(this.source, block.from, this.model.map)
      : 0;
  }
  blockAt(offset: number) {
    const weight = sourceOffsetToWeight(this.source, offset, this.model.map);
    return (
      this.model.blocks.find((block) => block.to > weight) ??
      this.model.blocks[this.model.blocks.length - 1]
    );
  }
  get bookmarks(): SourceBookmark[] {
    return this.anchors.flatMap(({ bookmark, offset, part }) => {
      const span = this.model.map.find((entry) => entry.to >= offset);
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
              position: this.unchanged ? bookmark.position : block.position + 1,
              preview: this.unchanged
                ? bookmark.preview
                : block.text.trim().slice(0, 80) || "空白段落",
            },
          ]
        : [];
    }).sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt));
  }
  read(): DeltaOps {
    if (this.unchanged) return this.unchanged;
    return (this.cached ??= {
      ...this.model.delta,
      metadata: {
        ...this.metadata,
        sourceFormat: "markdown",
        markdownSource: this.source,
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
    );
  }
  copy() {
    return new SourceNavigationDocument(
      this.source,
      this.anchors,
      this.metadata,
      this.unchanged,
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
}

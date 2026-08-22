import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface HeadingSection {
  key: string;
  level: number;
  text: string;
  pos: number;
  headingEnd: number;
  end: number;
  ancestorKeys: string[];
}

export interface HeadingFoldRange {
  from: number;
  to: number;
}

export interface HeadingFoldBlockRange {
  from: number;
  to: number;
  index: number;
}

interface HeadingDocumentIndex {
  sections: HeadingSection[];
  sectionByKey: Map<string, HeadingSection>;
  blocks: HeadingFoldBlockRange[];
}

const documentIndexCache = new WeakMap<ProseMirrorNode, HeadingDocumentIndex>();

function keyPart(text: string): string {
  return encodeURIComponent(text.trim().normalize("NFKC").toLocaleLowerCase() || "untitled");
}

function buildDocumentIndex(doc: ProseMirrorNode): HeadingDocumentIndex {
  const cached = documentIndexCache.get(doc);
  if (cached) return cached;
  const headings: Array<Omit<HeadingSection, "end">> = [];
  const blocks: HeadingFoldBlockRange[] = [];
  const stack: Array<{ level: number; key: string }> = [];
  const occurrences = new Map<string, number>();
  doc.forEach((node, pos, index) => {
    blocks.push({ from: pos, to: pos + node.nodeSize, index });
    if (node.type.name !== "heading") return;
    const level = Number(node.attrs.level);
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const text = node.textContent.trim() || "未命名标题";
    const parent = stack.map((entry) => entry.key).join("/");
    const base = `${parent}/${level}:${keyPart(text)}`;
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    const key = `${base}:${occurrence}`;
    headings.push({
      key,
      level,
      text,
      pos,
      headingEnd: pos + node.nodeSize,
      ancestorKeys: stack.map((entry) => entry.key),
    });
    stack.push({ level, key });
  });
  const sections = headings.map((heading, index) => {
    let end = doc.content.size;
    for (let next = index + 1; next < headings.length; next += 1) {
      if (headings[next].level <= heading.level) {
        end = headings[next].pos;
        break;
      }
    }
    return { ...heading, end };
  });
  const index = {
    sections,
    sectionByKey: new Map(sections.map((section) => [section.key, section])),
    blocks,
  };
  documentIndexCache.set(doc, index);
  return index;
}

/** 提取顶层标题章节，并生成可供后续持久化使用的层级稳定键。 */
export function extractHeadingSections(doc: ProseMirrorNode): HeadingSection[] {
  return buildDocumentIndex(doc).sections;
}

/** 找到文档位置所属的最内层标题章节；标题自身也归属于该章节。 */
export function headingSectionAtPosition(
  sections: readonly HeadingSection[],
  position: number,
): HeadingSection | null {
  // 标题按位置递增；目标位置之前的最后一个标题若仍覆盖目标，就是最内层
  // 章节。二分查找避免长目录在每次触摸命中时从头扫描。
  let low = 0;
  let high = sections.length - 1;
  let candidate = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (sections[middle].pos <= position) {
      candidate = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (candidate < 0) return null;
  const section = sections[candidate];
  return position < section.end ? section : null;
}

/**
 * “全部折叠”保留有用的章节总览：多个 H1 时折叠所有层级；只有一个 H1
 * 且存在 H2 时保留根章节展开，从 H2 开始折叠。
 */
export function collapsedHeadingKeysForAll(sections: readonly HeadingSection[]): string[] {
  const foldable = sections.filter((section) => section.end > section.headingEnd);
  const h1Count = sections.filter((section) => section.level === 1).length;
  const collapseFromH2 = h1Count === 1 && sections.some((section) => section.level === 2);
  return foldable
    .filter((section) => !collapseFromH2 || section.level >= 2)
    .map((section) => section.key);
}

/** 目录仅隐藏折叠标题的后代；折叠标题本身始终保留，作为再次展开的入口。 */
export function visibleHeadingSections(
  sections: HeadingSection[],
  collapsedKeys: ReadonlySet<string>,
): HeadingSection[] {
  if (collapsedKeys.size === 0) return sections;
  return sections.filter((section) => (
    !section.ancestorKeys.some((ancestorKey) => collapsedKeys.has(ancestorKey))
  ));
}

/** 返回实际被折叠隐藏的文档区间；父章节已覆盖的子章节不会重复加入。 */
export function collapsedHeadingContentRanges(
  doc: ProseMirrorNode,
  collapsedKeys: ReadonlySet<string>,
): HeadingFoldRange[] {
  if (collapsedKeys.size === 0) return [];
  const index = buildDocumentIndex(doc);
  const collapsedSections = [...collapsedKeys]
    .map((key) => index.sectionByKey.get(key))
    .filter((section): section is HeadingSection => Boolean(section))
    .sort((left, right) => left.pos - right.pos);
  const ranges: HeadingFoldRange[] = [];
  for (const section of collapsedSections) {
    if (section.end <= section.headingEnd) continue;
    const containing = ranges[ranges.length - 1];
    if (containing && section.pos >= containing.from && section.end <= containing.to) continue;
    ranges.push({ from: section.headingEnd, to: section.end });
  }
  return ranges;
}

/**
 * 返回折叠区间覆盖的顶层块位置。索引与标题信息一并按不可变 doc 缓存，
 * 单节折叠只遍历该节的块，不再每次从文档首块扫描到末块。
 */
export function topLevelBlocksInHeadingFoldRanges(
  doc: ProseMirrorNode,
  ranges: readonly HeadingFoldRange[],
): HeadingFoldBlockRange[] {
  if (ranges.length === 0) return [];
  const blocks = buildDocumentIndex(doc).blocks;
  const result: HeadingFoldBlockRange[] = [];
  for (const range of ranges) {
    let low = 0;
    let high = blocks.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (blocks[middle].from < range.from) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < blocks.length && blocks[index].from < range.to; index += 1) {
      result.push(blocks[index]);
    }
  }
  return result;
}

export interface HeadingFoldSnapshot {
  version: 1;
  collapsedKeys: string[];
}

export interface HeadingFoldStore {
  load(noteId: string): HeadingFoldSnapshot | null;
  save(noteId: string, snapshot: HeadingFoldSnapshot): void;
  clear(noteId: string): void;
}

/** 首版会话存储；接口可直接替换为 localStorage、SQLite 或同步适配器。 */
export function createSessionHeadingFoldStore(): HeadingFoldStore {
  const values = new Map<string, HeadingFoldSnapshot>();
  return {
    load: (noteId) => values.get(noteId) ?? null,
    save: (noteId, snapshot) => values.set(noteId, { version: 1, collapsedKeys: [...snapshot.collapsedKeys] }),
    clear: (noteId) => { values.delete(noteId); },
  };
}

export const sessionHeadingFoldStore = createSessionHeadingFoldStore();

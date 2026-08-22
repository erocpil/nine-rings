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

const sectionCache = new WeakMap<ProseMirrorNode, HeadingSection[]>();

function keyPart(text: string): string {
  return encodeURIComponent(text.trim().normalize("NFKC").toLocaleLowerCase() || "untitled");
}

/** 提取顶层标题章节，并生成可供后续持久化使用的层级稳定键。 */
export function extractHeadingSections(doc: ProseMirrorNode): HeadingSection[] {
  const cached = sectionCache.get(doc);
  if (cached) return cached;
  const headings: Array<Omit<HeadingSection, "end">> = [];
  const stack: Array<{ level: number; key: string }> = [];
  const occurrences = new Map<string, number>();
  doc.forEach((node, pos) => {
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
  sectionCache.set(doc, sections);
  return sections;
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
  const ranges: HeadingFoldRange[] = [];
  for (const section of extractHeadingSections(doc)) {
    if (!collapsedKeys.has(section.key) || section.end <= section.headingEnd) continue;
    const containing = ranges[ranges.length - 1];
    if (containing && section.pos >= containing.from && section.end <= containing.to) continue;
    ranges.push({ from: section.headingEnd, to: section.end });
  }
  return ranges;
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

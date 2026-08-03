import { Fragment, Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";

/**
 * 在 ProseMirror 解析前清理 Windows WebView2 等环境可能写入的 HTML 边界空白。
 *
 * 除独立空段落外，剪贴板还可能把选区边界表示为正文段落内部的多个 <br>。
 * 这些边界换行在解析后会变成 hardBreak，无法再判断它们来自 HTML 包装还是正文，
 * 因此先在 HTML 层删除；正文中间的 <br> 保留。
 */
export function normalizePastedHTML(html: string): string {
  return normalizeHTML(html, false);
}

/**
 * 与 transformPasted 保持一致，处理通过编辑器自定义“粘贴”按钮插入的 HTML。
 * insertContent(html) 不会经过 ProseMirror 的 transformPasted 钩子。
 */
export function normalizeSingleParagraphHTML(html: string): string {
  return normalizeHTML(html, true);
}

function normalizeHTML(html: string, flattenSingleParagraph: boolean): string {
  if (typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const nodes = Array.from(doc.body.childNodes);
  let start = 0;
  let end = nodes.length;
  while (start < end && isBoundaryBreakDOMNode(nodes[start])) start++;
  while (end > start && isBoundaryBreakDOMNode(nodes[end - 1])) end--;

  const remaining = nodes.slice(start, end);
  const firstElement = remaining.find((node): node is Element =>
    node.nodeType === globalThis.Node.ELEMENT_NODE
  );
  let lastElement: Element | undefined;
  for (let index = remaining.length - 1; index >= 0; index--) {
    const node = remaining[index];
    if (node.nodeType === globalThis.Node.ELEMENT_NODE) {
      lastElement = node as Element;
      break;
    }
  }
  if (firstElement) trimBoundaryBreakElements(firstElement, "start");
  if (lastElement) trimBoundaryBreakElements(lastElement, "end");

  while (remaining.length > 0 && isBoundaryBreakDOMNode(remaining[0])) {
    remaining.shift();
  }
  while (
    remaining.length > 0 &&
    isBoundaryBreakDOMNode(remaining[remaining.length - 1])
  ) {
    remaining.pop();
  }
  doc.body.replaceChildren(...remaining);

  const elements = Array.from(doc.body.children);

  if (
    !flattenSingleParagraph ||
    elements.length !== 1
  ) {
    return doc.body.innerHTML;
  }

  const paragraph = findOnlyParagraph(elements[0]);
  if (!paragraph) return doc.body.innerHTML;
  if (!paragraph.textContent || paragraph.querySelector("br")) return doc.body.innerHTML;
  return paragraph.innerHTML;
}

const BOUNDARY_BLOCK_TAGS = new Set(["article", "div", "p", "section"]);
const INLINE_WRAPPER_TAGS = new Set([
  "a", "b", "code", "del", "em", "i", "mark", "o:p", "s", "small", "span", "strong", "sub", "sup", "u",
]);

function isBoundaryBreakDOMNode(node: globalThis.Node): boolean {
  if (node.nodeType === globalThis.Node.TEXT_NODE) {
    return !(node.textContent ?? "").trim();
  }
  if (node.nodeType !== globalThis.Node.ELEMENT_NODE) return true;

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (tag === "br") return true;
  return (INLINE_WRAPPER_TAGS.has(tag) || BOUNDARY_BLOCK_TAGS.has(tag)) &&
    Array.from(element.childNodes).every(isBoundaryBreakDOMNode);
}

function trimBoundaryBreakElements(element: Element, edge: "start" | "end"): void {
  if (!BOUNDARY_BLOCK_TAGS.has(element.tagName.toLowerCase())) return;

  const children = Array.from(element.childNodes);
  if (edge === "start") {
    let index = 0;
    while (index < children.length && isBoundaryBreakDOMNode(children[index])) index++;
    for (let i = 0; i < index; i++) children[i].remove();
    const first = element.firstElementChild;
    if (first && BOUNDARY_BLOCK_TAGS.has(first.tagName.toLowerCase())) {
      trimBoundaryBreakElements(first, edge);
    }
    return;
  }

  let index = children.length - 1;
  while (index >= 0 && isBoundaryBreakDOMNode(children[index])) index--;
  for (let i = children.length - 1; i > index; i--) children[i].remove();
  const last = element.lastElementChild;
  if (last && BOUNDARY_BLOCK_TAGS.has(last.tagName.toLowerCase())) {
    trimBoundaryBreakElements(last, edge);
  }
}

function findOnlyParagraph(element: Element): Element | null {
  let current = element;
  while (current.tagName.toLowerCase() !== "p") {
    if (!BOUNDARY_BLOCK_TAGS.has(current.tagName.toLowerCase())) return null;
    if (current.children.length !== 1) return null;
    const child = current.children[0];
    if (!Array.from(current.childNodes).every((node) =>
      node === child || isBoundaryBreakDOMNode(node)
    )) return null;
    current = child;
  }
  return current;
}

/**
 * 浏览器在复制一个普通段落的全部文字时，可能把剪贴板内容序列化为
 * 一个闭合的 <p> block。直接粘贴会在光标前后切开当前段落，看起来像
 * 文本两侧被加入了额外空行。
 *
 * 单个普通段落在“粘贴文本”的语义下应当作为 inline content 插入。
 * 这里只去掉最外层 paragraph，内部 text marks（粗体、链接、颜色等）
 * 会原样保留。多段内容和其他 block 类型继续使用 ProseMirror 默认行为。
 */
export function normalizeSingleParagraphPaste(slice: Slice): Slice {
  let children = Array.from(slice.content.content);
  let start = 0;
  let end = children.length;
  while (start < end && isEmptyParagraphNode(children[start])) start++;
  while (end > start && isEmptyParagraphNode(children[end - 1])) end--;
  let removedBoundaryBlocks = start !== 0 || end !== children.length;
  if (start !== 0 || end !== children.length) {
    if (start === end) return new Slice(Fragment.empty, 0, 0);
    children = children.slice(start, end);
  }

  let trimmedBoundaryBreaks = false;
  const first = trimBoundaryHardBreaks(children[0], "start");
  if (first !== children[0]) {
    children = children.slice();
    children[0] = first;
    trimmedBoundaryBreaks = true;
  }
  const lastIndex = children.length - 1;
  const last = trimBoundaryHardBreaks(children[lastIndex], "end");
  if (last !== children[lastIndex]) {
    if (!trimmedBoundaryBreaks) children = children.slice();
    children[lastIndex] = last;
    trimmedBoundaryBreaks = true;
  }

  while (children.length > 0 && isEmptyParagraphNode(children[0])) {
    children = children.slice(1);
    removedBoundaryBlocks = true;
  }
  while (children.length > 0 && isEmptyParagraphNode(children[children.length - 1])) {
    children = children.slice(0, -1);
    removedBoundaryBlocks = true;
  }
  if (children.length === 0) return new Slice(Fragment.empty, 0, 0);

  if (children.length !== 1) {
    if (!removedBoundaryBlocks && !trimmedBoundaryBreaks) return slice;
    return new Slice(
      Fragment.fromArray(children),
      removedBoundaryBlocks ? 0 : slice.openStart,
      removedBoundaryBlocks ? 0 : slice.openEnd,
    );
  }

  const paragraph = children[0];
  if (
    !paragraph ||
    paragraph.type.name !== "paragraph" ||
    paragraph.content.size === 0
  ) {
    return slice;
  }

  let hasHardBreak = false;
  paragraph.descendants((node) => {
    if (node.type.name === "hardBreak") {
      hasHardBreak = true;
      return false;
    }
    return undefined;
  });
  if (hasHardBreak) {
    if (!removedBoundaryBlocks && !trimmedBoundaryBreaks) return slice;
    return new Slice(
      Fragment.from(paragraph),
      removedBoundaryBlocks ? 0 : slice.openStart,
      removedBoundaryBlocks ? 0 : slice.openEnd,
    );
  }

  return new Slice(paragraph.content, 0, 0);
}

function trimBoundaryHardBreaks(
  node: ProseMirrorNode,
  edge: "start" | "end",
): ProseMirrorNode {
  if (node.type.name !== "paragraph") return node;

  const children = node.content.content;
  let start = 0;
  let end = children.length;
  if (edge === "start") {
    while (start < end && isBoundaryBreakNode(children[start])) start++;
  } else {
    while (end > start && isBoundaryBreakNode(children[end - 1])) end--;
  }
  if (start === 0 && end === children.length) return node;
  return node.copy(Fragment.fromArray(children.slice(start, end)));
}

function isBoundaryBreakNode(node: ProseMirrorNode): boolean {
  return node.isText ? !(node.text ?? "").trim() : node.type.name === "hardBreak";
}

function isEmptyParagraphNode(node: ProseMirrorNode): boolean {
  if (node.type.name !== "paragraph") return false;
  return node.content.content.every(isBoundaryBreakNode);
}

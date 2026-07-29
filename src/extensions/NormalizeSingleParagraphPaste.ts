import { Fragment, Slice } from "@tiptap/pm/model";

/**
 * 与 transformPasted 保持一致，处理通过编辑器自定义“粘贴”按钮插入的 HTML。
 * insertContent(html) 不会经过 ProseMirror 的 transformPasted 钩子。
 */
export function normalizeSingleParagraphHTML(html: string): string {
  if (typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const elements = Array.from(doc.body.children);
  let start = 0;
  let end = elements.length;
  while (start < end && isEmptyParagraphElement(elements[start])) start++;
  while (end > start && isEmptyParagraphElement(elements[end - 1])) end--;
  if (start !== 0 || end !== elements.length) {
    const body = doc.body;
    body.replaceChildren(...elements.slice(start, end));
  }

  const remaining = elements.slice(start, end);
  if (remaining.length !== 1 || remaining[0].tagName.toLowerCase() !== "p") {
    return doc.body.innerHTML;
  }

  const paragraph = remaining[0];
  if (!paragraph.textContent || paragraph.querySelector("br")) return doc.body.innerHTML;
  return paragraph.innerHTML;
}

function isEmptyParagraphElement(element: Element): boolean {
  if (element.tagName.toLowerCase() !== "p") return false;
  return Array.from(element.childNodes).every((node) => {
    if (node.nodeType === Node.TEXT_NODE) return !(node.textContent ?? "").trim();
    return node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName.toLowerCase() === "br";
  });
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
  if (slice.openStart !== 0 || slice.openEnd !== 0) return slice;

  const children = slice.content.content;
  let start = 0;
  let end = children.length;
  while (start < end && isEmptyParagraphNode(children[start])) start++;
  while (end > start && isEmptyParagraphNode(children[end - 1])) end--;
  if (start !== 0 || end !== children.length) {
    if (start === end) return new Slice(Fragment.empty, 0, 0);
    slice = new Slice(Fragment.fromArray(children.slice(start, end)), 0, 0);
  }

  if (slice.content.childCount !== 1) return slice;

  const paragraph = slice.content.firstChild;
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
  if (hasHardBreak) return slice;

  return new Slice(paragraph.content, 0, 0);
}

function isEmptyParagraphNode(node: any): boolean {
  if (node.type.name !== "paragraph") return false;
  return node.content.content.every((child: any) =>
    child.isText ? !child.text.trim() : child.type.name === "hardBreak",
  );
}

/**
 * 找到块内第一段可见正文的首行中心。段落和普通列表复用编辑器行高，
 * 标题复用折叠标志的首行容器，避免在长文档中创建上千个 Range。
 * 只有结构复杂的块才读取首个实际文本矩形。
 */
export function firstLineTextCenter(
  dom: HTMLElement,
  fallbackRect: Pick<DOMRectReadOnly, "top" | "height">,
  typeName: string,
  editorLineHeight: number,
): number {
  if (typeName === "paragraph" || typeName === "bulletList" || typeName === "orderedList") {
    return fallbackRect.top + editorLineHeight / 2;
  }
  if (typeName === "heading") {
    // Share the fold host's actual first-line box (1lh), including custom
    // heading typography, instead of estimating it from heading-size ratios.
    const host = dom.querySelector<HTMLElement>(".editor-fold-host");
    if (host) {
      const rect = host.getBoundingClientRect();
      return rect.top + rect.height / 2;
    }
    const lineHeight = Number.parseFloat(getComputedStyle(dom).lineHeight) || editorLineHeight;
    return fallbackRect.top + lineHeight / 2;
  }
  if (typeName === "codeBlock") {
    // The block number identifies the whole block, beside its title/type row.
    // Keep this anchor stable across source, diagram and collapsed modes.
    const toolbar = dom.querySelector<HTMLElement>(".code-block-toolbar, .vr-code-toolbar, .document-toc-block > header");
    if (toolbar) {
      const title = toolbar.querySelector<HTMLElement>(".code-block-title, .structured-block-caption, strong");
      const rect = (title ?? toolbar).getBoundingClientRect();
      return rect.top + rect.height / 2;
    }
  }
  const textRoot = typeName === "codeBlock"
    ? (dom.matches("code") ? dom : dom.querySelector<HTMLElement>("code")) ?? dom
    : dom;
  if (typeName === "codeBlock") {
    // Without a toolbar, fall back to the first source line.
    const rect = textRoot.getBoundingClientRect();
    const style = getComputedStyle(textRoot);
    const lineHeight = Number.parseFloat(style.lineHeight) || editorLineHeight;
    const inset = (Number.parseFloat(style.borderTopWidth) || 0)
      + (Number.parseFloat(style.paddingTop) || 0);
    return rect.top + inset + lineHeight / 2;
  }
  const walker = document.createTreeWalker(textRoot, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent ?? "";
      const firstVisible = text.search(/\S/);
      if (firstVisible < 0) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || parent.closest("button, select, option, input, textarea, .code-block-gutter, .column-resize-handle")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNode = walker.nextNode();
  if (textNode instanceof Text) {
    const text = textNode.textContent ?? "";
    const start = Math.max(0, text.search(/\S/));
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, Math.min(text.length, start + 1));
    const firstRect = range.getClientRects()[0];
    if (firstRect && firstRect.height > 0) return firstRect.top + firstRect.height / 2;
  }
  return fallbackRect.top + fallbackRect.height / 2;
}


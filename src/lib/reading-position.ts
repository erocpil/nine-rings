import type { Editor } from "@tiptap/core";

function viewport(root: HTMLElement) {
  const rect = root.getBoundingClientRect();
  const sticky = root.querySelector<HTMLElement>(
    ":scope > .note-editor-sticky",
  );
  const top =
    sticky && getComputedStyle(sticky).position === "sticky"
      ? Math.max(
          rect.top,
          Math.min(rect.bottom, sticky.getBoundingClientRect().bottom),
        )
      : rect.top;
  return { top, bottom: rect.bottom };
}

/** Geometry-based, so a settings dialog covering the editor does not break hit testing. */
function capture(root: HTMLElement): (() => void) | null {
  const visible = viewport(root);
  if (visible.bottom <= visible.top || root.clientHeight === 0) return null;
  // At document start there is no reading position to compensate for.
  if (root.scrollTop < 1)
    return () => {
      root.scrollTop = 0;
    };
  const content = root.querySelector<HTMLElement>(".vr-body, .ProseMirror");
  if (!content) return null;
  const walker = document.createTreeWalker(
    content,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node instanceof HTMLElement) {
          if (
            node.matches(
              "button, select, textarea, .vr-gutter, .code-line-number, .code-block-toolbar, .blockquote-toolbar",
            )
          )
            return NodeFilter.FILTER_REJECT;
          const rect = node.getBoundingClientRect();
          return rect.height === 0 ||
            rect.bottom <= visible.top ||
            rect.top >= visible.bottom
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_SKIP;
        }
        if (!node.textContent?.trim()) return NodeFilter.FILTER_SKIP;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        return rect.height > 0 &&
          rect.bottom > visible.top &&
          rect.top < visible.bottom
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      },
    },
  );
  const text = walker.nextNode();
  if (!(text instanceof Text)) return null;
  const range = document.createRange();
  const rectAt = (offset: number) => {
    range.setStart(text, offset);
    range.setEnd(text, Math.min(text.length, offset + 1));
    return range.getBoundingClientRect();
  };
  // Locate the first visible character, including a partially visible top line.
  let low = 0,
    high = text.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (rectAt(mid).bottom <= visible.top) low = mid + 1;
    else high = mid;
  }
  const offsetTop = rectAt(low).top - visible.top;
  const dom = text.parentElement?.closest<HTMLElement>(".ProseMirror");
  const editor = (dom as (HTMLElement & { editor?: Editor }) | null)?.editor;
  // Positions survive the mark DOM being split/replaced by font-size formatting.
  const position =
    editor && !editor.isDestroyed ? editor.view.posAtDOM(text, low) : null;
  return () => {
    if (!root.isConnected || !content.isConnected) return;
    let top: number;
    if (editor && position !== null && !editor.isDestroyed) {
      if (position > editor.state.doc.content.size) return;
      top = editor.view.coordsAtPos(position).top;
    } else {
      if (!text.isConnected || range.startContainer !== text) return;
      top = range.getBoundingClientRect().top;
    }
    root.scrollTop += top - viewport(root).top - offsetTop;
  };
}

const pending = new WeakMap<HTMLElement, () => void>();
const settled = new WeakMap<
  HTMLElement,
  {
    content: Element | null;
    document: unknown;
    scrollTop: number;
    width: number;
    restore: () => void;
  }
>();

function documentAt(root: HTMLElement): unknown {
  return root.querySelector<HTMLElement & { editor?: Editor }>(".ProseMirror")
    ?.editor?.state.doc ?? root.querySelector(".vr-body")?.textContent;
}

/** Keep the top visible text through reflow; never move focus or alter selection. */
export function preserveReadingPositions(
  change: () => void,
  within: ParentNode = document,
): void {
  const restorers: Array<() => void> = [];
  for (const root of within.querySelectorAll<HTMLElement>(
    ".note-editor-scroll, .block-workspace-body",
  )) {
    pending.get(root)?.();
    const content = root.querySelector(".vr-body, .ProseMirror");
    const previous = settled.get(root);
    // Consecutive A+/A− clicks retain the same character, not each newly wrapped
    // line's start. Otherwise a long paragraph can drift by a line on every click.
    const restore =
      previous &&
      previous.content === content &&
      previous.document === documentAt(root) &&
      Math.abs(previous.scrollTop - root.scrollTop) < 1 &&
      previous.width === root.clientWidth
        ? previous.restore
        : capture(root);
    if (!restore) continue;
    let first = 0,
      second = 0;
    const cancel = () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      root.removeEventListener("wheel", cancel);
      root.removeEventListener("touchstart", cancel);
      root.removeEventListener("pointerdown", cancel);
      root.removeEventListener("keydown", cancel);
      if (pending.get(root) === cancel) pending.delete(root);
    };
    pending.set(root, cancel);
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
      root.addEventListener(event, cancel, { passive: true });
    restorers.push(() => {
      first = requestAnimationFrame(() => {
        restore();
        second = requestAnimationFrame(() => {
          restore();
          settled.set(root, {
            content,
            document: documentAt(root),
            scrollTop: root.scrollTop,
            width: root.clientWidth,
            restore,
          });
          cancel();
        });
      });
    });
  }
  try {
    change();
  } finally {
    restorers.forEach((restore) => restore());
  }
}

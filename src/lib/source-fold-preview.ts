import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection } from "@codemirror/view";
import { language } from "@codemirror/language";
import { sourceCodeHighlighting } from "./source-code-highlighting";

/** A separate readonly view virtualizes large folded regions without truncation. */
export function sourceFoldPreviewPlaceholder(
  view: EditorView,
  onclick: (event: Event) => void,
  prepared: { text: string } | null,
) {
  const placeholder = document.createElement("span");
  placeholder.className = "cm-foldPlaceholder";
  placeholder.textContent = "…";
  placeholder.setAttribute("aria-label", "折叠代码；悬停预览，点击展开");
  placeholder.addEventListener("click", onclick);
  if (!prepared) return placeholder;
  let bubble: HTMLDivElement | null = null;
  let preview: EditorView | null = null;
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelHide = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const hide = () => {
    cancelHide();
    observer?.disconnect();
    observer = null;
    view.scrollDOM.removeEventListener("scroll", hide);
    window.removeEventListener("resize", hide);
    preview?.destroy();
    preview = null;
    if (bubble?.matches(":popover-open")) bubble.hidePopover();
    bubble?.remove();
    bubble = null;
  };
  const scheduleHide = () => {
    cancelHide();
    timer = setTimeout(hide, 160);
  };
  const show = () => {
    cancelHide();
    if (bubble || !placeholder.isConnected) return;
    const viewport = view.scrollDOM.getBoundingClientRect();
    bubble = document.createElement("div");
    bubble.className = "cm-fold-preview-bubble";
    bubble.setAttribute("popover", "manual");
    bubble.setAttribute("role", "region");
    bubble.setAttribute("aria-label", "折叠代码预览");
    const maxWidth = Math.min(window.innerWidth - 16, viewport.width * 0.75);
    const maxHeight = Math.min(window.innerHeight - 16, viewport.height * 0.5);
    bubble.style.width = `${maxWidth}px`;
    bubble.style.height = `${maxHeight}px`;
    const host = document.createElement("div");
    host.className = "markdown-cm-host markdown-cm-source";
    host.style.height = "100%";
    host.style.minHeight = "0";
    bubble.appendChild(host);
    document.body.appendChild(bubble);
    bubble.showPopover();
    const syntax = view.state.facet(language);
    preview = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: prepared.text,
        extensions: [
          ...(syntax ? [syntax] : []),
          sourceCodeHighlighting,
          drawSelection(),
          EditorState.readOnly.of(true),
          EditorState.tabSize.of(view.state.tabSize),
          EditorView.editable.of(false),
          EditorView.theme({
            "&": { height: "100%" },
            ".cm-scroller": { overflow: "auto" },
            ".cm-content": { padding: "4px 6px" },
          }),
        ],
      }),
    });
    // Size to the code, retaining the viewport fractions as upper bounds.
    // CodeMirror virtualizes lines, so measure the source rather than only DOM rows.
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context) context.font = getComputedStyle(preview.contentDOM).font;
    const lines = prepared.text.split("\n");
    const contentWidth = lines.reduce((width, line) => Math.max(width,
      context?.measureText(line.replace(/\t/g, " ".repeat(view.state.tabSize))).width ?? 0), 0);
    bubble.style.width = `${Math.min(maxWidth, Math.max(80, contentWidth + 42))}px`;
    bubble.style.height = `${Math.min(maxHeight, lines.length * preview.defaultLineHeight + 32)}px`;
    // Keep wheel events inside this independent preview; editor-level handlers
    // must not reinterpret trackpad scrolling as navigation of the main view.
    bubble.addEventListener("wheel", (event) => event.stopPropagation());
    const anchor = placeholder.getBoundingClientRect();
    const bounds = bubble.getBoundingClientRect();
    const below = window.innerHeight - anchor.bottom - 8;
    const above = anchor.top - 8;
    bubble.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8))}px`;
    bubble.style.top = `${Math.max(8, below >= bounds.height || below >= above ? Math.min(window.innerHeight - bounds.height - 8, anchor.bottom + 6) : anchor.top - bounds.height - 6)}px`;
    bubble.addEventListener("mouseenter", cancelHide);
    bubble.addEventListener("mouseleave", scheduleHide);
    bubble.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        hide();
      }
    });
    view.scrollDOM.addEventListener("scroll", hide);
    window.addEventListener("resize", hide);
    observer = new MutationObserver(() => {
      if (!placeholder.isConnected) hide();
    });
    observer.observe(view.dom, { subtree: true, childList: true });
  };
  placeholder.addEventListener("mouseenter", show);
  placeholder.addEventListener("mouseleave", scheduleHide);
  placeholder.addEventListener("click", hide);
  placeholder.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      hide();
      onclick(event);
    }
  });
  return placeholder;
}

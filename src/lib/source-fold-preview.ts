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
  placeholder.setAttribute("aria-label", prepared ? "折叠代码；悬停预览，点击展开" : "折叠内容；点击展开");
  // Clicking the placeholder unfolds it; it must not first move the cursor and
  // invalidate the position remembered before folding.
  placeholder.addEventListener("mousedown", event => event.preventDefault());
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
    // Prefer staying inside the editor pane, but let wide source lines use the
    // whole screen and float above sidebars when the pane itself is too narrow.
    const maxWidth = Math.max(1, window.innerWidth - 16);
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
            ".cm-content": { padding: "8px 10px" },
          }),
        ],
      }),
    });
    const lines = prepared.text.split("\n");
    // Size to the code, retaining the viewport fractions as upper bounds.
    // A small minimum keeps short blocks readable; CodeMirror may report a
    // zero line height on its first layout, so measure again after a frame.
    const fit = () => {
      if (!bubble || !preview || !bubble.isConnected) return;
      const style = getComputedStyle(preview.contentDOM);
      const fontSize = Number.parseFloat(style.fontSize) || 14;
      const lineHeight = Math.max(
        preview.defaultLineHeight || 0,
        Number.parseFloat(style.lineHeight) || 0,
        fontSize * 1.45,
      );
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (context) context.font = style.font || `${fontSize}px monospace`;
      const renderedLines = [...preview.contentDOM.querySelectorAll<HTMLElement>(".cm-line")];
      const renderedWidth = renderedLines.reduce((width, line) => {
        const range = document.createRange();
        range.selectNodeContents(line);
        return Math.max(width, range.getBoundingClientRect().width);
      }, 0);
      const estimatedWidth = lines.reduce((width, line) => Math.max(width,
        context?.measureText(line.replace(/\t/g, " ".repeat(view.state.tabSize))).width ?? 0), 0);
      const lineStyle = renderedLines[0] ? getComputedStyle(renderedLines[0]) : null;
      const bubbleStyle = getComputedStyle(bubble);
      const px = (value: string | null | undefined) => Number.parseFloat(value ?? "") || 0;
      const verticalPadding = 18;
      const needsVerticalScrollbar = lines.length * lineHeight + verticalPadding > maxHeight;
      const verticalScrollbarWidth = needsVerticalScrollbar
        ? Math.max(0, preview.scrollDOM.offsetWidth - preview.scrollDOM.clientWidth)
        : 0;
      // Use rendered text geometry (which includes syntax spans and tab stops)
      // and add the actual CodeMirror/content/border insets around that text.
      // The final 8px absorbs subpixel font rounding, which otherwise leaves a
      // narrow false horizontal scrollbar on short-to-medium source lines.
      const horizontalPadding =
        px(style.paddingLeft) + px(style.paddingRight) +
        px(lineStyle?.paddingLeft) + px(lineStyle?.paddingRight) +
        px(bubbleStyle.borderLeftWidth) + px(bubbleStyle.borderRightWidth) +
        verticalScrollbarWidth + 8;
      // CodeMirror only lays out the visible portion of long folded regions;
      // keep the all-source estimate so offscreen long lines still size the bubble.
      const contentWidth = Math.max(renderedWidth, estimatedWidth);
      bubble.style.width = `${Math.min(maxWidth, Math.max(Math.min(maxWidth, 260), contentWidth + horizontalPadding))}px`;
      bubble.style.height = `${Math.min(maxHeight, Math.max(Math.min(maxHeight, lineHeight + verticalPadding), lines.length * lineHeight + verticalPadding))}px`;
      const anchor = placeholder.getBoundingClientRect();
      const bounds = bubble.getBoundingClientRect();
      const below = window.innerHeight - anchor.bottom - 8;
      const above = anchor.top - 8;
      const screenLeft = 8;
      const screenRight = Math.max(screenLeft, window.innerWidth - bounds.width - 8);
      const editorLeft = Math.max(screenLeft, viewport.left + 8);
      const editorRight = Math.min(window.innerWidth - 8, viewport.right - 8);
      const fitsEditor = bounds.width <= editorRight - editorLeft;
      const preferredLeft = fitsEditor
        ? Math.max(editorLeft, Math.min(anchor.left, editorRight - bounds.width))
        : anchor.left + anchor.width / 2 - bounds.width / 2;
      bubble.style.left = `${Math.max(screenLeft, Math.min(preferredLeft, screenRight))}px`;
      bubble.style.top = `${Math.max(8, below >= bounds.height || below >= above ? Math.min(window.innerHeight - bounds.height - 8, anchor.bottom + 6) : anchor.top - bounds.height - 6)}px`;
    };
    fit();
    requestAnimationFrame(fit);
    void document.fonts?.ready.then(fit);
    // Keep wheel events inside this independent preview; editor-level handlers
    // must not reinterpret trackpad scrolling as navigation of the main view.
    bubble.addEventListener("wheel", (event) => event.stopPropagation());
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

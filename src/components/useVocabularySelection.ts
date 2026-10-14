import { useEffect, type RefObject } from "react";

/** WebKit paints native cross-block selections into the layout's empty space.
 * Keep the native range for copying, but paint only its selected text fragments. */
export function useVocabularySelection(
  ref: RefObject<HTMLElement>,
  active: boolean,
) {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root || typeof Highlight === "undefined" || !CSS.highlights)
      return;
    const name = "vocabulary-selection";
    root.classList.add("vocabulary-text-selection");
    let frame = 0;
    const paint = () => {
      frame = 0;
      const selection = window.getSelection();
      const highlight = new Highlight();
      if (selection && !selection.isCollapsed) {
        for (let i = 0; i < selection.rangeCount; i++) {
          const selected = selection.getRangeAt(i);
          if (!selected.intersectsNode(root)) continue;
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            if (
              !node.parentElement?.closest(".vocabulary-text") ||
              !selected.intersectsNode(node)
            )
              continue;
            const start =
              selected.startContainer === node ? selected.startOffset : 0;
            const end =
              selected.endContainer === node
                ? selected.endOffset
                : node.textContent!.length;
            if (end <= start) continue;
            const fragment = document.createRange();
            fragment.setStart(node, start);
            fragment.setEnd(node, end);
            if (fragment.getClientRects().length) highlight.add(fragment);
          }
        }
      }
      CSS.highlights.set(name, highlight);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    document.addEventListener("selectionchange", schedule);
    root.addEventListener("toggle", schedule, true);
    paint();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", schedule);
      root.removeEventListener("toggle", schedule, true);
      root.classList.remove("vocabulary-text-selection");
      CSS.highlights.delete(name);
    };
  }, [ref, active]);
}

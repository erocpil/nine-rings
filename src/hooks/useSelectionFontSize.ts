import { useLayoutEffect, useState } from "react";
import type { Editor } from "@tiptap/core";

/** The size at the caret (or moving end of a selection), including inherited
 * paragraph/heading styles. Stored marks take precedence for subsequent input. */
function selectionFontSize(editor: Editor, fallback: number): string {
  if (editor.isDestroyed) return String(fallback);
  const { selection, storedMarks } = editor.state;
  const { $head } = selection;
  const adjacent = selection.empty ? null
    : selection.head > selection.anchor ? $head.nodeBefore : $head.nodeAfter;
  const marks = selection.empty ? storedMarks ?? $head.marks()
    : adjacent?.marks ?? $head.marks();
  const explicit = Number.parseFloat(marks.find(mark => mark.type.name === "textStyle")?.attrs.fontSize);
  if (Number.isFinite(explicit) && explicit > 0) return String(explicit);

  // Read the text block, not an adjacent font-size span: clearing the stored
  // size at a caret inside a span should display the inherited size immediately.
  const block = $head.depth > 0 ? editor.view.nodeDOM($head.before()) : editor.view.dom;
  const inherited = block instanceof HTMLElement ? Number.parseFloat(getComputedStyle(block).fontSize) : fallback;
  return String(Math.round((Number.isFinite(inherited) ? inherited : fallback) * 100) / 100);
}

export function useSelectionFontSize(editor: Editor, fallback: number) {
  const [size, setSize] = useState(String(fallback));
  useLayoutEffect(() => {
    const refresh = () => setSize(selectionFontSize(editor, fallback));
    refresh();
    // Setting a size at an empty caret only changes storedMarks, so neither
    // selectionUpdate nor update is sufficient to keep the toolbar current.
    editor.on("transaction", refresh);
    return () => { editor.off("transaction", refresh); };
  }, [editor, fallback]);
  return size;
}

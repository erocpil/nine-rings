import type { Editor } from "@tiptap/core";
import type { MutableRefObject } from "react";
import { CellSelection } from "@tiptap/pm/tables";
import { setToolbarSelectionHighlight } from "../extensions/EditorHighlights";
export interface ToolbarTextSelection {
  from: number;
  to: number;
}
/** Commands use the active editor and session-owned refs; no secondary subscription. */
export function createToolbarSelectionCommands(
  editor: Editor,
  toolbarSelectionRef: MutableRefObject<ToolbarTextSelection | null>,
  toolbarCellSelectionRef: MutableRefObject<CellSelection | null>,
) {
  const rememberToolbarSelection = () => {
    if (editor.state.selection instanceof CellSelection) {
      toolbarCellSelectionRef.current = editor.state.selection;
      toolbarSelectionRef.current = null;
      return;
    }
    const { from, to } = editor.state.selection;
    if (from !== to) {
      toolbarSelectionRef.current = { from, to };
      setToolbarSelectionHighlight(editor, { from, to });
      return;
    }
    const domSelection = window.getSelection();
    if (
      !domSelection ||
      domSelection.isCollapsed ||
      !domSelection.anchorNode ||
      !domSelection.focusNode
    )
      return;
    try {
      const anchor = editor.view.posAtDOM(
        domSelection.anchorNode,
        domSelection.anchorOffset,
      );
      const focus = editor.view.posAtDOM(
        domSelection.focusNode,
        domSelection.focusOffset,
      );
      toolbarSelectionRef.current = {
        from: Math.min(anchor, focus),
        to: Math.max(anchor, focus),
      };
      setToolbarSelectionHighlight(editor, toolbarSelectionRef.current);
    } catch {
      // The browser can briefly expose a selection outside ProseMirror while moving focus.
    }
  };

  const runToolbarFormat = (format: "bold" | "italic" | "strike") => {
    let chain = editor.chain();
    const selection = toolbarSelectionRef.current;
    if (selection) chain = chain.setTextSelection(selection);
    chain = chain.focus();
    if (format === "bold") chain.toggleBold().run();
    else if (format === "italic") chain.toggleItalic().run();
    else chain.toggleStrike().run();
  };

  return { rememberToolbarSelection, runToolbarFormat };
}

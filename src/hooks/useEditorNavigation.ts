import { isOrdinaryNavigationJump } from "../lib/document-navigation";
import { useDocumentActive } from "../components/RetainedDocument";
import { useEffect, type RefObject } from "react";
import type { Editor } from "@tiptap/core";
import { AllSelection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { expandHeadingFoldsAt } from "../extensions/HeadingFold";
import { useNavigationStore } from "../stores/useNavigationStore";
import { EDITOR_NAVIGATION_EVENT } from "./useEditorScrollPersistence";

// Browsers can publish selectionchange after pointerup, including after
// ProseMirror's short-lived pointer-origin marker has expired.
const POINTER_SELECTION_TIMEOUT = 300;

export function setNavigationSelection(editor: Editor, range: number | { from: number; to: number }) {
  editor.chain().setTextSelection(range).command(({ tr }) => {
    tr.setMeta("navigation-jump", true);
    return true;
  }).run();
}

/** Observe selection transactions, not keystrokes or document contents. */
export function useEditorNavigation(editor: Editor | null, noteId: string, scrollRef: RefObject<HTMLElement>, enabled = true) {
  const active = useDocumentActive();
  const target = useNavigationStore(state => state.target?.noteId === noteId ? state.target : null);
  useEffect(() => {
    if (!editor || !active || !enabled) return;
    const history = useNavigationStore.getState();
    history.activate(noteId);
    const location = () => ({ noteId, from: editor.state.selection.from, to: editor.state.selection.to });
    history.record(location());
    let previous = editor.state.selection;
    let keyboardMovement = false;
    let pointerId: number | null = null;
    let pointerBlock: Node | null = null;
    let pointerReleaseTimer = 0;
    let pointerRecorded = false;
    const clearPointer = () => {
      window.clearTimeout(pointerReleaseTimer);
      pointerReleaseTimer = 0;
      pointerId = null;
      pointerBlock = null;
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      clearPointer();
      pointerId = event.pointerId;
      let node = event.target instanceof Node ? event.target : null;
      while (node?.parentNode && node.parentNode !== editor.view.dom) node = node.parentNode;
      if (node?.parentNode === editor.view.dom) pointerBlock = node;
      pointerRecorded = false;
    };
    const up = (event: PointerEvent) => {
      if (pointerId === event.pointerId)
        pointerReleaseTimer = window.setTimeout(clearPointer, POINTER_SELECTION_TIMEOUT);
    };
    const cancel = (event: PointerEvent) => {
      if (pointerId === event.pointerId) clearPointer();
    };
    const key = (event: KeyboardEvent) => {
      clearPointer();
      keyboardMovement = /^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(event.key);
    };
    const keyup = () => { keyboardMovement = false; };
    const transaction = ({ transaction: tr }: { transaction: Transaction }) => {
      const state = useNavigationStore.getState();
      if (tr.docChanged) {
        clearPointer();
        state.map(noteId, pos => tr.mapping.map(pos));
      }
      const selection = editor.state.selection;
      const moved = !selection.eq(previous);
      if (moved || tr.docChanged) {
        const blockDistance = Math.abs(selection.$from.index(0) - previous.$from.index(0));
        // Nearby editing clicks belong to one working area. Explicit jumps are
        // always retained, including matches within the same paragraph.
        const far = isOrdinaryNavigationJump(blockDistance, Math.abs(selection.from - previous.from));
        const awaitingPointer = pointerId !== null && (
          !pointerReleaseTimer || pointerBlock?.contains(editor.view.domAtPos(selection.head).node)
        );
        const pointer = Boolean(tr.getMeta("pointer")) || awaitingPointer;
        const jump = moved && !tr.docChanged && !tr.getMeta("navigation-history") && !keyboardMovement
          && !(selection instanceof AllSelection)
          && (tr.getMeta("navigation-jump") || (pointer && !pointerRecorded && far));
        state.record(location(), jump);
        if (pointer && moved) {
          pointerRecorded = true;
          if (pointerReleaseTimer) clearPointer();
        }
      }
      previous = selection;
    };
    editor.on("transaction", transaction);
    editor.view.dom.addEventListener("pointerdown", down);
    editor.view.dom.addEventListener("keydown", key, true);
    editor.view.dom.addEventListener("focusout", clearPointer);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("keyup", keyup, true);
    return () => {
      editor.off("transaction", transaction);
      editor.view.dom.removeEventListener("pointerdown", down);
      editor.view.dom.removeEventListener("keydown", key, true);
      editor.view.dom.removeEventListener("focusout", clearPointer);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("keyup", keyup, true);
      clearPointer();
    };
  }, [editor, noteId, active, enabled]);

  useEffect(() => {
    if (!editor || !target || !active || !enabled) return;
    const root = scrollRef.current;
    root?.dispatchEvent(new Event(EDITOR_NAVIGATION_EVENT));
    const maximum = editor.state.doc.content.size;
    const from = Math.max(0, Math.min(target.from, maximum));
    const to = Math.max(from, Math.min(target.to, maximum));
    expandHeadingFoldsAt(editor, from);
    // Use each NodeView's reading/editing fold action, including readonly
    // overrides, so the restored caret cannot remain inside a hidden block.
    const resolved = editor.state.doc.resolve(from);
    for (let depth = 1; depth <= resolved.depth; depth++) {
      const type = resolved.node(depth).type.name;
      if (type !== "codeBlock" && type !== "blockquote") continue;
      const host = editor.view.nodeDOM(resolved.before(depth));
      if (host instanceof HTMLElement) host.querySelector<HTMLButtonElement>(`button[aria-label="${type === "codeBlock" ? "展开代码块" : "展开引用块"}"]`)?.click();
    }
    editor.view.dom.focus({ preventScroll: true });
    const selection = TextSelection.between(editor.state.doc.resolve(from), editor.state.doc.resolve(to));
    editor.view.dispatch(editor.state.tr.setSelection(selection).setMeta("navigation-history", true));
    const frame = requestAnimationFrame(() => {
      if (editor.isDestroyed || useNavigationStore.getState().target?.requestId !== target.requestId) return;
      if (root) {
        const rect = root.getBoundingClientRect();
        const sticky = root.querySelector<HTMLElement>(".note-editor-sticky");
        const top = Math.max(rect.top, sticky?.getBoundingClientRect().bottom ?? rect.top);
        const coords = editor.view.coordsAtPos(editor.state.selection.from);
        root.scrollTop += (coords.top + coords.bottom) / 2 - (top + rect.bottom) / 2;
      }
      useNavigationStore.getState().consumed(target.requestId);
      useNavigationStore.getState().record({ noteId, from: editor.state.selection.from, to: editor.state.selection.to });
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, noteId, target, scrollRef, active, enabled]);
}

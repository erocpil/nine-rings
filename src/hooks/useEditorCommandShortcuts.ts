import { useEffect, useRef } from "react";
import { editorShortcutAction } from "../lib/editor-shortcuts";
import { nativeMenuSnapshot, runNativeMenuAction } from "../lib/native-menu-registry";

/** One command mapping for browser/Tauri and both editors. The native menu
 * consumes its own accelerators; remaining DOM events execute exactly once. */
export function useEditorCommandShortcuts(onError: (error: unknown) => void) {
  const error = useRef(onError);
  error.current = onError;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.getModifierState("AltGraph")) return;
      const id = editorShortcutAction(event);
      if (!id) return;
      const action = nativeMenuSnapshot().find(item => item.id === id);
      if (!action?.enabled || action.shortcut === false) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.matches("input,textarea,[contenteditable=true]") && !target.closest(".ProseMirror,.cm-editor") && /^(format|edit)\./.test(id)) return;
      if ([...document.querySelectorAll<HTMLElement>('dialog[open],[role="dialog"][aria-modal="true"]')].some(element => element.getClientRects().length > 0)) return;
      event.preventDefault(); event.stopPropagation();
      void Promise.resolve().then(() => runNativeMenuAction(id)).catch(reason => error.current(reason));
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, []);
}

import type { Editor } from "@tiptap/core";

export const OPEN_BLOCK_WORKSPACE = "nine-rings:open-block-workspace";
const pending = new Map<string, number>();
export function queueBlockWorkspace(noteId: string, position: number) { pending.set(noteId, position); }
export function takeBlockWorkspace(noteId: string) { const position = pending.get(noteId); pending.delete(noteId); return position; }

export function openBlockWorkspace(editor: Editor, position: number | undefined, trigger: HTMLElement) {
  if (typeof position !== "number" || editor.isDestroyed) return;
  const restoreFocus = trigger.matches(":focus-visible");
  trigger.blur();
  editor.view.dom.dispatchEvent(new CustomEvent(OPEN_BLOCK_WORKSPACE, {
    bubbles: true, detail: { position, trigger, restoreFocus },
  }));
}

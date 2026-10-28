import type { Editor } from "@tiptap/core";
import { restoreRenderedReadingAnchor, type RenderedReadingAnchor } from "./editor-reading-position";

export const EDITOR_NAVIGATION_EVENT = "nr:editor-navigation";

/** Shared layout settling for ordinary document views. Storage is supplied by
 * the caller; real user input or an explicit jump always ends restoration. */
export function restoreDocumentViewport({ root, editor, scrollTop, anchor, onFinish }: {
  root: HTMLElement;
  editor: Editor | null;
  scrollTop: number;
  anchor?: RenderedReadingAnchor;
  onFinish: () => void;
}): () => void {
  const started = performance.now();
  let frame = 0, settled = 0, stopped = false;
  let observer: ResizeObserver | null = null;
  let mutations: MutationObserver | null = null;
  const stop = () => {
    stopped = true; cancelAnimationFrame(frame); observer?.disconnect(); mutations?.disconnect();
    root.removeEventListener("wheel", finish); root.removeEventListener("touchstart", finish);
    root.removeEventListener("pointerdown", finish); root.removeEventListener("keydown", key);
    root.removeEventListener(EDITOR_NAVIGATION_EVENT, finish);
  };
  const finish = () => { if (stopped) return; stop(); onFinish(); };
  const key = (event: KeyboardEvent) => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) finish(); };
  const restore = () => {
    if (stopped || !root.isConnected) return;
    const maximum = Math.max(0, root.scrollHeight - root.clientHeight);
    root.scrollTop = Math.min(scrollTop, maximum);
    const anchored = !!editor && !!anchor && !editor.isDestroyed && restoreRenderedReadingAnchor(editor, root, anchor);
    settled = (anchored || maximum >= scrollTop) && (anchored || Math.abs(root.scrollTop - scrollTop) <= 1) ? settled + 1 : 0;
    if (settled >= 4 && performance.now() - started >= 600 || performance.now() - started >= 10000) { finish(); return; }
    frame = requestAnimationFrame(restore);
  };
  const schedule = () => { if (!stopped) { cancelAnimationFrame(frame); frame = requestAnimationFrame(restore); } };
  root.addEventListener("wheel", finish, { passive: true }); root.addEventListener("touchstart", finish, { passive: true });
  root.addEventListener("pointerdown", finish, { passive: true }); root.addEventListener("keydown", key);
  root.addEventListener(EDITOR_NAVIGATION_EVENT, finish);
  observer = new ResizeObserver(schedule); observer.observe(root);
  mutations = new MutationObserver(schedule); mutations.observe(root, { childList: true, subtree: true });
  frame = requestAnimationFrame(restore);
  return stop;
}

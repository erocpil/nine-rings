import { useEffect, useLayoutEffect, useRef } from "react";
import { api } from "../lib/api";
import { navigationKey } from "../lib/document-navigation";
import type { Note } from "../types/models";
import { DOCUMENT_NAVIGATION_EVENT, useNavigationStore } from "../stores/useNavigationStore";
import { useNotesStore } from "../stores/useNotesStore";

export function useDocumentNavigation({ noteId, enabled, flush, select }: {
  noteId: string | null; enabled: boolean; flush: () => Promise<void>; select: (note: Note) => void;
}) {
  const latest = useRef({ enabled, flush, select });
  latest.current = { enabled, flush, select };
  useLayoutEffect(() => {
    if (noteId) useNavigationStore.getState().activate(noteId);
  }, [noteId]);
  useEffect(() => { useNavigationStore.setState({ enabled }); }, [enabled]);
  useEffect(() => {
    let alive = true;
    const blocked = () => !latest.current.enabled || Boolean(document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], .block-workspace, .settings-overlay'));
    const navigate = async (direction: -1 | 1) => {
      if (blocked() || useNavigationStore.getState().busy) return;
      let state = useNavigationStore.getState();
      if (!state.entries[state.index + direction]) return;
      const origin = useNotesStore.getState().selectedNote?.id;
      let revision = state.revision;
      let index = state.index + direction;
      useNavigationStore.setState({ busy: true });
      try {
        await latest.current.flush();
        while (alive && !blocked()) {
          state = useNavigationStore.getState();
          if (revision !== state.revision || useNotesStore.getState().selectedNote?.id !== origin) return;
          const location = state.entries[index];
          if (!location) return;
          const note = await api.notes.get(location.noteId);
          if (!alive || blocked() || revision !== useNavigationStore.getState().revision || useNotesStore.getState().selectedNote?.id !== origin) return;
          if (!note) {
            // The missing document can occupy several adjacent entries,
            // including the current one. Continue from the removed target's
            // gap rather than skipping the next surviving destination.
            index = state.entries.slice(0, index).filter(item => item.noteId !== location.noteId).length
              + (direction < 0 ? -1 : 0);
            state.remove(location.noteId);
            revision = useNavigationStore.getState().revision;
            continue;
          }
          useNavigationStore.getState().restore(index);
          if (note.id !== origin) latest.current.select(note);
          return;
        }
      } catch (error) {
        useNotesStore.setState({ error: `无法跳转，当前位置已保留：${error instanceof Error ? error.message : String(error)}` });
      } finally { if (alive) useNavigationStore.setState({ busy: false }); }
    };
    const request = (event: Event) => {
      const direction = (event as CustomEvent).detail;
      if (direction === -1 || direction === 1) void navigate(direction);
    };
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented || blocked()) return;
      const direction = navigationKey(event);
      if (direction === null) return;
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) void navigate(direction);
    };
    // Cancel both default-action phases; only mouseup navigates, so a browser
    // emitting pointer + mouse + auxclick events cannot jump several times.
    const mouse = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault(); event.stopPropagation();
      if (event.type === "mouseup" && !blocked()) void navigate(event.button === 3 ? -1 : 1);
    };
    window.addEventListener(DOCUMENT_NAVIGATION_EVENT, request);
    window.addEventListener("keydown", key, true);
    for (const name of ["mousedown", "mouseup", "auxclick"] as const) window.addEventListener(name, mouse, true);
    return () => {
      alive = false;
      useNavigationStore.setState({ busy: false });
      window.removeEventListener(DOCUMENT_NAVIGATION_EVENT, request);
      window.removeEventListener("keydown", key, true);
      for (const name of ["mousedown", "mouseup", "auxclick"] as const) window.removeEventListener(name, mouse, true);
    };
  }, []);
}

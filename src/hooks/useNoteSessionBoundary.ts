import { useLayoutEffect, useRef } from "react";
import { api } from "../lib/api";

/** Retarget saves synchronously; checkpoint the old document only after its save succeeds. */
export function useNoteSessionBoundary(
  noteId: string | null,
  setAutoSaveNoteId: (id: string | null) => Promise<void>,
) {
  const previous = useRef<string | null>(null);
  useLayoutEffect(() => {
    const oldId = previous.current;
    if (oldId === noteId) return;
    previous.current = noteId;
    void setAutoSaveNoteId(noteId)
      .then(async () => {
        if (oldId) await api.versions.checkpoint(oldId);
      })
      .catch((error) => {
        console.error("[App] 切换笔记前保存失败，已跳过 checkpoint:", error);
      });
  }, [noteId, setAutoSaveNoteId]);
}

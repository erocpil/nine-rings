import { useEffect, useRef } from "react";
import { useNotesStore } from "../stores/useNotesStore";

/**
 * 按日期加载数据的 Hook
 * 切换日期时自动触发 load
 */
export function useNotes(preferredNoteId?: string, selectFallback = true, documentsOnly = false) {
  const store = useNotesStore();
  const {
    currentDate,
    initialize,
    setDate,
    loading,
    startupReady,
    startupDateLoadPending,
    notes,
    selectedNote,
    selectNote,
  } = store;
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      void initialize(preferredNoteId, selectFallback, documentsOnly);
    }
  }, [initialize, preferredNoteId, selectFallback, documentsOnly]);

  return {
    currentDate,
    loading,
    startupReady,
    startupDateLoadPending,
    notes,
    selectedNote,
    setDate,
    selectNote,
    createNote: store.createNote,
    updateNote: store.updateNote,
    deleteNote: store.deleteNote,
  };
}

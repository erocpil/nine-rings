import { useEffect, useRef } from "react";
import { useNotesStore } from "../stores/useNotesStore";

/**
 * 按日期加载数据的 Hook
 * 切换日期时自动触发 load
 */
export function useNotes() {
  const store = useNotesStore();
  const { currentDate, setDate, loading, notes, selectedNote, selectNote } = store;
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      setDate(currentDate);
    }
  }, [currentDate, setDate]);

  return {
    currentDate,
    loading,
    notes,
    selectedNote,
    setDate,
    selectNote,
    createNote: store.createNote,
    updateNote: store.updateNote,
    deleteNote: store.deleteNote,
  };
}

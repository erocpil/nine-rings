import { useEffect, useRef } from "react";
import { useNotesStore } from "../stores/useNotesStore";

/** Restore the last document before loading optional workspace lists. */
export function useNotes(preferredNoteId?: string, selectFallback = true) {
  const store = useNotesStore();
  const initialized = useRef(false);
  const initialize = store.initialize;
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      void initialize(preferredNoteId, selectFallback);
    }
  }, [initialize, preferredNoteId, selectFallback]);
  return store;
}

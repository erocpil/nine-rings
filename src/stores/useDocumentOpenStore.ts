import { create } from "zustand";
import type { DocumentOpenOptions } from "../lib/document-open";

interface DocumentOpenStore {
  sequence: number;
  target: { noteId: string; requestId: number } | null;
  open: (noteId: string | null, options?: DocumentOpenOptions) => void;
  consumed: (requestId: number) => void;
}

/** Transient view intent also reaches already-mounted document instances. */
export const useDocumentOpenStore = create<DocumentOpenStore>((set) => ({
  sequence: 0,
  target: null,
  open: (noteId, options) =>
    set((state) => ({
      sequence: state.sequence + 1,
      target:
        noteId && options?.view === "source"
          ? { noteId, requestId: state.sequence + 1 }
          : null,
    })),
  consumed: (requestId) =>
    set((state) =>
      state.target?.requestId === requestId ? { target: null } : {},
    ),
}));

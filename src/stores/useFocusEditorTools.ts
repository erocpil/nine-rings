import { create } from "zustand";
/** Shared toolbar visibility; null keeps each view's original default. */
export const useFocusEditorTools = create<{ expanded: boolean | null; setExpanded: (value: boolean | null) => void }>((set) => ({
  expanded: null,
  setExpanded: value => set({ expanded: value }),
}));

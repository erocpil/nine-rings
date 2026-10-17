import { create } from "zustand";
/** Window-session chrome state; independent of document/editor instance lifetimes. */
export const useFocusEditorTools = create<{ expanded: boolean; setExpanded: (value: boolean | ((previous: boolean) => boolean)) => void }>((set) => ({
  expanded: false,
  setExpanded: value => set(state => ({ expanded: typeof value === "function" ? value(state.expanded) : value })),
}));

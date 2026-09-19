import { create } from "zustand";

export interface NavigationLocation { noteId: string; from: number; to: number }
export interface NavigationTarget extends NavigationLocation { requestId: number }
export const DOCUMENT_NAVIGATION_EVENT = "nr:document-history";
const LIMIT = 100;
const equal = (a: NavigationLocation, b: NavigationLocation) => a.noteId === b.noteId && a.from === b.from && a.to === b.to;

interface NavigationStore {
  entries: NavigationLocation[];
  index: number;
  revision: number;
  target: NavigationTarget | null;
  busy: boolean;
  enabled: boolean;
  activate: (noteId: string) => void;
  record: (location: NavigationLocation, jump?: boolean) => void;
  map: (noteId: string, mapPosition: (position: number) => number) => void;
  restore: (index: number) => void;
  consumed: (requestId: number) => void;
  remove: (noteId: string) => void;
}

/** Session-only cursor history. Never stores document text or decrypted content. */
export const useNavigationStore = create<NavigationStore>((set, get) => ({
  entries: [], index: -1, revision: 0, target: null, busy: false, enabled: true,
  activate: noteId => {
    const state = get();
    if (state.entries[state.index]?.noteId === noteId) return;
    const previous = [...state.entries].reverse().find(item => item.noteId === noteId);
    const entries = [...state.entries.slice(0, state.index + 1), previous ?? { noteId, from: 1, to: 1 }].slice(-LIMIT);
    set({ entries, index: entries.length - 1, target: null, revision: state.revision + 1 });
  },
  record: (location, jump = false) => {
    const state = get();
    const current = state.entries[state.index];
    if (!current || current.noteId !== location.noteId || state.target || equal(current, location)) return;
    if (jump) {
      const entries = [...state.entries.slice(0, state.index + 1), location].slice(-LIMIT);
      set({ entries, index: entries.length - 1, revision: state.revision + 1 });
    } else {
      const entries = state.entries.slice();
      entries[state.index] = location;
      set({ entries });
    }
  },
  map: (noteId, mapPosition) => set(state => ({
    entries: state.entries.map(item => item.noteId === noteId ? { ...item, from: mapPosition(item.from), to: mapPosition(item.to) } : item),
    target: state.target?.noteId === noteId ? { ...state.target, from: mapPosition(state.target.from), to: mapPosition(state.target.to) } : state.target,
  })),
  restore: index => {
    const state = get();
    const entry = state.entries[index];
    if (!entry) return;
    const requestId = state.revision + 1;
    set({ index, revision: requestId, target: { ...entry, requestId } });
  },
  consumed: requestId => set(state => state.target?.requestId === requestId ? { target: null } : {}),
  remove: noteId => set(state => ({
    entries: state.entries.filter(item => item.noteId !== noteId),
    index: state.entries.slice(0, state.index + 1).filter(item => item.noteId !== noteId).length - 1,
    target: state.target?.noteId === noteId ? null : state.target,
    revision: state.revision + 1,
  })),
}));

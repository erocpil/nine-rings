import { create } from "zustand";
import type { Note, DailyPage } from "../types/models";
import { api } from "../lib/api";

interface NotesStore {
  // 状态
  currentDate: string;
  notes: Note[];
  dailyPage: DailyPage | null;
  selectedNote: Note | null;
  searchQuery: string;
  searchResults: Note[];
  loading: boolean;

  // 操作
  setDate: (date: string) => Promise<void>;
  selectNote: (note: Note | null) => void;
  createNote: () => Promise<Note | null>;
  updateNote: (id: string, changes: Partial<Note>) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  search: (query: string) => Promise<void>;
  updateTodos: (todos: DailyPage["todos"]) => Promise<void>;
}

export const useNotesStore = create<NotesStore>((set, get) => ({
  currentDate: new Date().toISOString().slice(0, 10),
  notes: [],
  dailyPage: null,
  selectedNote: null,
  searchQuery: "",
  searchResults: [],
  loading: false,

  setDate: async (date: string) => {
    set({ loading: true, currentDate: date });
    const [notes, dailyPage] = await Promise.all([
      api.notes.listByDate(date),
      api.daily.get(date),
    ]);
    set({ notes, dailyPage: dailyPage, selectedNote: notes[0] ?? null, loading: false });
  },

  selectNote: (note) => set({ selectedNote: note }),

  createNote: async () => {
    const { currentDate } = get();
    const note = await api.notes.create({
      date: currentDate,
      title: "新随笔",
      content: { ops: [] },
    });
    set((s) => ({
      notes: [...s.notes, note],
      selectedNote: note,
    }));
    return note;
  },

  updateNote: async (id, changes) => {
    await api.notes.update(id, changes as any);
    set((s) => ({
      notes: s.notes.map((n) =>
        n.id === id ? { ...n, ...changes, updated_at: new Date().toISOString() } : n
      ),
      selectedNote:
        s.selectedNote?.id === id
          ? { ...s.selectedNote, ...changes, updated_at: new Date().toISOString() }
          : s.selectedNote,
    }));
  },

  deleteNote: async (id) => {
    await api.notes.delete(id);
    set((s) => ({
      notes: s.notes.filter((n) => n.id !== id),
      selectedNote: s.selectedNote?.id === id ? null : s.selectedNote,
    }));
  },

  search: async (query) => {
    if (!query.trim()) {
      set({ searchResults: [], searchQuery: "" });
      return;
    }
    set({ searchQuery: query, loading: true });
    const results = await api.notes.search(query);
    set({ searchResults: results, loading: false });
  },

  updateTodos: async (todos) => {
    const { currentDate, dailyPage } = get();
    const updated = await api.daily.updateTodos({
      date: currentDate,
      todos,
      todo_carryover: dailyPage?.todo_carryover ?? false,
    });
    set({ dailyPage: updated });
  },
}));

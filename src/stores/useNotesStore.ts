import { create } from "zustand";
import type { Note, NotePatch } from "../types/models";
import { api } from "../lib/api";
import { withTimeout } from "../lib/async";

interface NotesStore {
  notes: Note[];
  selectedNote: Note | null;
  searchQuery: string;
  searchResults: Note[];
  loading: boolean;
  startupReady: boolean;
  error: string | null;
  initialize: (preferredNoteId?: string, selectFallback?: boolean) => Promise<void>;
  refreshNotes: () => Promise<void>;
  selectNote: (note: Note | null) => void;
  updateNote: (id: string, changes: NotePatch) => Promise<Note>;
  deleteNote: (id: string) => Promise<void>;
  batchDelete: (ids: string[]) => Promise<void>;
  search: (query: string) => Promise<void>;
  clearError: () => void;
}

let loadGeneration = 0;
let searchGeneration = 0;
let refreshGeneration = 0;
function sortNotes(a: Note, b: Note): number {
  return Number(b.pinned) - Number(a.pinned) || a.sort_order - b.sort_order
    || a.created_at.localeCompare(b.created_at);
}
function getPersistedLastNoteId(): string | undefined {
  try { return localStorage.getItem("nr:lastNote")?.trim() || undefined; }
  catch { return undefined; }
}

export const useNotesStore = create<NotesStore>((set) => ({
  notes: [], selectedNote: null, searchQuery: "", searchResults: [],
  loading: false, startupReady: false, error: null,
  clearError: () => set({ error: null }),
  initialize: async (preferredNoteId, selectFallback = true) => {
    const generation = ++loadGeneration;
    ++refreshGeneration;
    set({ loading: true, startupReady: false, error: null });
    try {
      const id = preferredNoteId || (selectFallback ? getPersistedLastNoteId() : undefined);
      let restored = id ? await withTimeout(api.notes.get(id), 5000, "恢复上次文档").catch(() => null) : null;
      if (generation !== loadGeneration) return;
      if (!restored && selectFallback) {
        const documents = await withTimeout(api.docs.search({}), 15000, "恢复文档");
        restored = documents.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
      }
      if (generation !== loadGeneration) return;
      set({ selectedNote: restored, notes: [], loading: false, startupReady: true });
    } catch (error) {
      if (generation !== loadGeneration) return;
      set({ loading: false, startupReady: true, error: `恢复文档失败: ${String(error)}` });
    }
  },
  refreshNotes: async () => {
    const generation = ++refreshGeneration;
    try {
      const notes = await withTimeout(api.docs.search({}), 15000, "加载文档");
      if (generation === refreshGeneration) set({ notes, error: null });
    } catch (error) {
      if (generation === refreshGeneration) set({ error: `加载文档失败: ${String(error)}` });
    }
  },
  selectNote: (note) => set({ selectedNote: note }),
  updateNote: async (id, changes) => {
    try {
      const updatedNote = await api.notes.update(id, changes);
      set((s) => {
        // 用 API 返回的完整对象替换本地笔记，并重新排序
        const newNotes = s.notes
          .map((n) => (n.id === id ? updatedNote : n))
          .sort(sortNotes);
        return {
          notes: newNotes,
          selectedNote:
            s.selectedNote?.id === id
              ? updatedNote
              : s.selectedNote,
          error: null,
        };
      });
      return updatedNote;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? "unknown error");
      set({ error: `更新失败: ${msg}` });
      throw e; // 重新抛出，使上层（useAutoSave）能感知失败
    }
  },

  deleteNote: async (id) => {
    try {
      await api.notes.delete(id);
      set((s) => ({
        notes: s.notes.filter((n) => n.id !== id),
        selectedNote: s.selectedNote?.id === id ? null : s.selectedNote,
        error: null,
      }));
    } catch (e) {
      set({ error: `删除失败: ${(e as Error).message}` });
      throw e;
    }
  },

  batchDelete: async (ids) => {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return;
    try {
      await api.recycle.batch.delete(uniqueIds);
      const deletedIds = new Set(uniqueIds);
      set((s) => ({
        notes: s.notes.filter((note) => !deletedIds.has(note.id)),
        selectedNote: s.selectedNote && deletedIds.has(s.selectedNote.id) ? null : s.selectedNote,
        error: null,
      }));
    } catch (e) {
      set({ error: `批量删除失败: ${(e as Error).message}` });
      throw e;
    }
  },

  search: async (query) => {
    const generation = ++searchGeneration;
    if (!query.trim()) {
      set({ searchResults: [], searchQuery: "" });
      return;
    }
    set({ searchQuery: query, loading: true, error: null });
    try {
      const results = await api.notes.search(query);
      if (generation !== searchGeneration) return;
      set({ searchResults: results, loading: false });
    } catch (e) {
      if (generation !== searchGeneration) return;
      set({ loading: false, error: `搜索失败: ${(e as Error).message}` });
    }
  },

}));

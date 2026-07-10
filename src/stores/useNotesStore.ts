import { create } from "zustand";
import type { Note, DailyPage } from "../types/models";
import { api } from "../lib/api";

/** 排序：置顶优先 → sort_order 升序 → created_at 升序 */
function sortNotes(a: Note, b: Note): number {
  const pa = a.pinned ? 1 : 0;
  const pb = b.pinned ? 1 : 0;
  if (pb !== pa) return pb - pa;
  const sa = a.sort_order ?? 0;
  const sb = b.sort_order ?? 0;
  if (sa !== sb) return sa - sb;
  return (a.created_at ?? "").localeCompare(b.created_at ?? "");
}

interface NotesStore {
  // 状态
  currentDate: string;
  notes: Note[];
  dailyPage: DailyPage | null;
  selectedNote: Note | null;
  searchQuery: string;
  searchResults: Note[];
  loading: boolean;
  error: string | null;

  // 操作
  setDate: (date: string) => Promise<void>;
  selectNote: (note: Note | null) => void;
  createNote: () => Promise<Note | null>;
  updateNote: (id: string, changes: Partial<Note>) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  search: (query: string) => Promise<void>;
  updateTodos: (todos: DailyPage["todos"]) => Promise<void>;
  clearError: () => void;
}

export const useNotesStore = create<NotesStore>((set, get) => ({
  currentDate: new Date().toISOString().slice(0, 10),
  notes: [],
  dailyPage: null,
  selectedNote: null,
  searchQuery: "",
  searchResults: [],
  loading: false,
  error: null,

  clearError: () => set({ error: null }),

  setDate: async (date: string) => {
    set({ loading: true, currentDate: date, error: null });
    try {
      const [notes, dailyPage] = await Promise.all([
        api.notes.listByDate(date),
        api.daily.get(date),
      ]);
      // ── dump: 打印从数据库加载的笔记 content 结构 ──
      for (const n of notes) {
        const c = n.content as any;
        const ops = c?.ops ?? [];
        const isPM = c?.type === "doc";
        console.log(
          `[dump/store] note ${(n.id ?? '??').slice(0, 8)} title=${JSON.stringify(n.title)} ` +
            `format=${isPM ? "ProseMirror" : ops.length ? `Delta(${ops.length}ops)` : "?empty?"} ` +
            `first_op=${(JSON.stringify(ops[0]?.insert) ?? '—').slice(0, 60)}`,
        );
      }
      // ── /dump ──
      // 优先恢复上次浏览的笔记，否则取第一项
      const lastId = localStorage.getItem("nr:lastNote");
      const preferred = lastId ? notes.find((n) => n.id === lastId) : undefined;
      set({ notes, dailyPage, selectedNote: preferred ?? notes[0] ?? null, loading: false });
    } catch (e) {
      set({ loading: false, error: `加载失败: ${(e as Error).message}` });
    }
  },

  selectNote: (note) => set({ selectedNote: note }),

  createNote: async () => {
    const { currentDate } = get();
    try {
      const note = await api.notes.create({
        date: currentDate,
        title: "新随笔",
        content: { ops: [] },
      });
      set((s) => ({
        notes: [...s.notes, note],
        selectedNote: note,
        error: null,
      }));
      return note;
    } catch (e) {
      set({ error: `创建失败: ${(e as Error).message}` });
      return null;
    }
  },

  updateNote: async (id, changes) => {
    try {
      const updatedNote = await api.notes.update(id, changes as any);
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
    } catch (e) {
      set({ error: `更新失败: ${(e as Error).message}` });
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
    }
  },

  search: async (query) => {
    if (!query.trim()) {
      set({ searchResults: [], searchQuery: "" });
      return;
    }
    set({ searchQuery: query, loading: true, error: null });
    try {
      const results = await api.notes.search(query);
      set({ searchResults: results, loading: false });
    } catch (e) {
      set({ loading: false, error: `搜索失败: ${(e as Error).message}` });
    }
  },

  updateTodos: async (todos) => {
    const { currentDate, dailyPage } = get();
    try {
      const updated = await api.daily.updateTodos({
        date: currentDate,
        todos,
        todo_carryover: dailyPage?.todo_carryover ?? false,
      });
      set({ dailyPage: updated, error: null });
    } catch (e) {
      set({ error: `保存待办失败: ${(e as Error).message}` });
    }
  },
}));

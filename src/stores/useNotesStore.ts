import { create } from "zustand";
import type { Note, DailyPage, NotePatch } from "../types/models";
import { api } from "../lib/api";
import { localDateKey } from "../lib/local-date";
import { withTimeout } from "../lib/async";

const CURRENT_DATE_KEY = "nr:currentDate";

function loadCurrentDate(): string {
  try {
    const saved = localStorage.getItem(CURRENT_DATE_KEY);
    return saved && /^\d{4}-\d{2}-\d{2}$/.test(saved) ? saved : localDateKey();
  } catch {
    return localDateKey();
  }
}

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
  startupReady: boolean;
  startupDateLoadPending: boolean;
  error: string | null;

  // 操作
  initialize: (preferredNoteId?: string, selectFallback?: boolean) => Promise<void>;
  setDate: (date: string) => Promise<void>;
  selectNote: (note: Note | null) => void;
  createNote: () => Promise<Note | null>;
  updateNote: (id: string, changes: NotePatch) => Promise<Note>;
  deleteNote: (id: string) => Promise<void>;
  batchDelete: (ids: string[]) => Promise<void>;
  search: (query: string) => Promise<void>;
  updateTodos: (todos: DailyPage["todos"]) => Promise<void>;
  clearError: () => void;
}

const LAST_NOTE_KEY = "nr:lastNote";

const NOTE_LOOKUP_TIMEOUT_MS = 5000;
const NOTE_LIST_TIMEOUT_MS = 15000;
let dateLoadGeneration = 0;
let searchGeneration = 0;

function getPersistedLastNoteId(): string | null {
  try {
    const raw = localStorage.getItem(LAST_NOTE_KEY);
    return raw && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

async function resolvePreferredNoteId(noteId: string | undefined): Promise<Note | null> {
  if (!noteId) return null;
  return withTimeout(api.notes.get(noteId), NOTE_LOOKUP_TIMEOUT_MS, "恢复上次文档")
    .catch(() => null);
}

async function resolveFallbackNoteAcrossWorkspace(lastNoteId: string | null, preferredDate: string): Promise<{ date: string; note: Note | null }> {
  // notes.all() 只包含日期随笔，文档树中的文档必须通过 docs.search() 获取。
  // 两类数据独立恢复，避免其中一路的瞬时失败让整个启动恢复失效。
  const [dailyResult, docsResult] = await withTimeout(
    Promise.allSettled([api.notes.all(), api.docs.search({})]),
    NOTE_LIST_TIMEOUT_MS,
    "加载全部笔记",
  );
  if (dailyResult.status === "rejected" && docsResult.status === "rejected") {
    throw dailyResult.reason;
  }

  const byId = new Map<string, Note>();
  const dailyNotes = dailyResult.status === "fulfilled" ? dailyResult.value : [];
  const documents = docsResult.status === "fulfilled" ? docsResult.value : [];
  for (const note of [...dailyNotes, ...documents]) byId.set(note.id, note);
  const all = [...byId.values()].sort((a, b) =>
    (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
  );
  if (!all.length) return { date: preferredDate, note: null };
  const preferred = lastNoteId ? byId.get(lastNoteId) : undefined;
  const fallback = preferred ?? all[0] ?? null;
  return fallback ? { date: fallback.date, note: fallback } : { date: preferredDate, note: null };
}

export const useNotesStore = create<NotesStore>((set, get) => ({
  currentDate: loadCurrentDate(),
  notes: [],
  dailyPage: null,
  selectedNote: null,
  searchQuery: "",
  searchResults: [],
  loading: false,
  startupReady: false,
  startupDateLoadPending: false,
  error: null,

  clearError: () => set({ error: null }),

  // 启动优先恢复最后文档：单行主键查询完成后立即交给界面渲染，日期列表和
  // Todo 等编辑器首次呈现后再加载。大备份不再要求先扫描列表才能看到文档。
  initialize: async (preferredNoteId, selectFallback = true) => {
    const generation = ++dateLoadGeneration;
    set({ loading: true, startupReady: false, startupDateLoadPending: false, error: null });
    let restored: Note | null = null;
    const preferredId = preferredNoteId
      || (selectFallback ? getPersistedLastNoteId() ?? undefined : undefined);
    if (preferredId) {
      restored = await resolvePreferredNoteId(preferredId);
    }
    if (generation !== dateLoadGeneration) return;

    const requestedDate = restored?.date ?? get().currentDate;
    localStorage.setItem(CURRENT_DATE_KEY, requestedDate);
    if (restored) {
      // 日期列表可能包含大量正文。不要在这里立刻读取；App 会在编辑器首次呈现
      // 后调用 setDate 补齐列表和 Todo，保证启动主路径只有一次按 ID 查询。
      set({
        currentDate: requestedDate,
        selectedNote: restored,
        loading: false,
        startupReady: true,
        startupDateLoadPending: true,
      });
      return;
    }

    const lastNoteId = getPersistedLastNoteId();
    try {
      let date = requestedDate;
      let [notes, dailyPage] = await withTimeout(
        Promise.all([api.notes.listByDate(date), api.daily.get(date)]),
        NOTE_LIST_TIMEOUT_MS,
        "加载笔记",
      );

      // 如果当天无可用文档，尝试在全部文档里找恢复目标。
      if (notes.length === 0 && selectFallback) {
        const fallback = await resolveFallbackNoteAcrossWorkspace(lastNoteId, date).catch(() => ({
          date,
          note: null,
        }));
        if (fallback.note) {
          date = fallback.date;
          const [fallbackNotes, fallbackPage] = await withTimeout(
            Promise.all([api.notes.listByDate(date), api.daily.get(date)]),
            NOTE_LIST_TIMEOUT_MS,
            "恢复备用文档",
          );
          notes = fallbackNotes;
          dailyPage = fallbackPage;
          if (generation !== dateLoadGeneration) return;
          localStorage.setItem(CURRENT_DATE_KEY, date);
          localStorage.setItem(LAST_NOTE_KEY, fallback.note.id);
          set({
            currentDate: date,
            notes,
            dailyPage,
            selectedNote: fallback.note,
            loading: false,
            startupReady: true,
            startupDateLoadPending: false,
          });
          return;
        }
      }

      if (generation !== dateLoadGeneration) return;
      set((state) => {
        const lastId = lastNoteId;
        const preferred = lastId ? notes.find((note) => note.id === lastId) : undefined;
        return {
          currentDate: date,
          notes,
          dailyPage,
          selectedNote: selectFallback ? preferred ?? notes[0] ?? null : state.selectedNote,
          loading: false,
          startupReady: true,
          startupDateLoadPending: false,
        };
      });
    } catch (e) {
      if (generation !== dateLoadGeneration) return;
      set({
        loading: false,
        startupReady: true,
        startupDateLoadPending: false,
        error: `加载失败: ${(e as Error).message}`,
      });
    }
  },

  setDate: async (date: string) => {
    const generation = ++dateLoadGeneration;
    const prevSelected = get().selectedNote;
    localStorage.setItem(CURRENT_DATE_KEY, date);
    set({ loading: true, currentDate: date, startupDateLoadPending: false, error: null });
    try {
      const [notes, dailyPage] = await withTimeout(
        Promise.all([
          api.notes.listByDate(date),
          api.daily.get(date),
        ]),
        15000,
        "加载笔记",
      );
      if (generation !== dateLoadGeneration) return;
      // 若当前选中的是文档（有 storagePath），保持在文档视图不切换
      if (prevSelected?.storagePath) {
        set({ notes, dailyPage, loading: false, startupReady: true });
        return;
      }
      // 优先恢复上次浏览的笔记，否则取第一项
      const lastId = localStorage.getItem("nr:lastNote");
      const preferred = lastId ? notes.find((n) => n.id === lastId) : undefined;
      set({
        notes,
        dailyPage,
        selectedNote: preferred ?? notes[0] ?? null,
        loading: false,
        startupReady: true,
      });
    } catch (e) {
      if (generation !== dateLoadGeneration) return;
      set({ loading: false, startupReady: true, error: `加载失败: ${(e as Error).message}` });
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
        notes: s.currentDate === currentDate ? [...s.notes, note] : s.notes,
        selectedNote: s.currentDate === currentDate ? note : s.selectedNote,
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

  updateTodos: async (todos) => {
    const { currentDate, dailyPage } = get();
    try {
      const updated = await api.daily.updateTodos({
        date: currentDate,
        todos,
        todo_carryover: dailyPage?.todo_carryover ?? false,
      });
      if (get().currentDate === currentDate) set({ dailyPage: updated, error: null });
    } catch (e) {
      set({ error: `保存待办失败: ${(e as Error).message}` });
    }
  },
}));

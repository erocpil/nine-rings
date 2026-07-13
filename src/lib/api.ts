import type { StorageAdapter, DocSearchQuery } from "./storage/types";
import { getAdapter } from "./storage";
import type { AppConfig, CreateNoteInput, UpdateNoteInput, UpdateTodosInput } from "../types/models";

/**
 * API 层 — 统一接口，底层自动适配 Tauri IPC / IndexedDB
 *
 * 所有 store/component 只通过此模块访问数据，不直接引用 storage adapter。
 */

let _adapterPromise: Promise<StorageAdapter> | null = null;
function adapter(): Promise<StorageAdapter> {
  if (!_adapterPromise) {
    _adapterPromise = getAdapter();
  }
  return _adapterPromise;
}

export const api = {
  notes: {
    listByDate: (date: string) =>
      adapter().then((a) => a.getNotesByDate(date)),

    get: (id: string) =>
      adapter().then((a) => a.getNote(id)),

    create: (data: CreateNoteInput) =>
      adapter().then((a) => a.createNote(data)),

    upsert: (data: CreateNoteInput) =>
      adapter().then((a) => a.upsertNote(data)),

    update: (id: string, data: UpdateNoteInput) =>
      adapter().then((a) => a.updateNote(id, data)),

    updateOrder: (id: string, sort_order: number) =>
      adapter().then((a) => a.updateNoteOrder(id, sort_order)),

    delete: (id: string) =>
      adapter().then((a) => a.deleteNote(id)),

    search: (query: string) =>
      adapter().then((a) => a.searchNotes(query)),

    listByTag: (tag: string) =>
      adapter().then((a) => a.getNotesByTag(tag)),
  },

  tags: {
    listAll: () =>
      adapter().then((a) => a.getAllTags()),

    /** 重命名标签（跨所有笔记） */
    rename: async (oldName: string, newName: string) => {
      if (oldName === newName || !newName.trim()) return { affected: 0 };
      const ad = await adapter();
      const notes = await ad.getNotesByTag(oldName);
      let affected = 0;
      for (const n of notes) {
        const updatedTags = n.tags
          .filter((t) => t !== oldName)
          .concat(newName);
        await ad.updateNote(n.id, { tags: updatedTags } as any);
        affected++;
      }
      return { affected };
    },

    /** 合并标签：将 sourceName 合并到 targetName，移除 sourceName */
    merge: async (sourceName: string, targetName: string) => {
      if (sourceName === targetName || !sourceName.trim()) return { affected: 0 };
      const ad = await adapter();
      const notes = await ad.getNotesByTag(sourceName);
      let affected = 0;
      for (const n of notes) {
        const updatedTags = n.tags
          .filter((t) => t !== sourceName)
          .concat(targetName);
        await ad.updateNote(n.id, { tags: updatedTags } as any);
        affected++;
      }
      return { affected };
    },

    /** 从所有笔记中移除指定标签 */
    remove: async (name: string) => {
      if (!name.trim()) return { affected: 0 };
      const ad = await adapter();
      const notes = await ad.getNotesByTag(name);
      let affected = 0;
      for (const n of notes) {
        const updatedTags = n.tags.filter((t) => t !== name);
        await ad.updateNote(n.id, { tags: updatedTags } as any);
        affected++;
      }
      return { affected };
    },
  },

  daily: {
    get: (date: string) =>
      adapter().then((a) => a.getDailyPage(date)),

    getAll: () =>
      adapter().then((a) => a.getAllDailyPages()),

    /** 搜索所有日期的待办 */
    searchTodos: async (query: string) => {
      if (!query.trim()) return [];
      const q = query.trim().toLowerCase();
      const pages = await adapter().then((a) => a.getAllDailyPages());
      const results: { todo: any; date: string }[] = [];
      for (const p of pages) {
        if (!Array.isArray(p.todos)) continue;
        for (const t of p.todos) {
          if (t.text?.toLowerCase().includes(q)) {
            results.push({ todo: t, date: p.date });
          }
        }
      }
      // 按日期倒序排列
      results.sort((a, b) => b.date.localeCompare(a.date));
      return results;
    },

    updateTodos: (data: UpdateTodosInput) =>
      adapter().then((a) => a.updateTodos(data)),
  },

  sync: {
    push: () => adapter().then((a) => a.syncPush()),
    pull: () => adapter().then((a) => a.syncPull()),
  },

  export: {
    data: () => adapter().then((a) => a.exportData()),

    import: (json: string) =>
      adapter().then((a) => a.importData(json)),

    noteMarkdown: (noteId: string) =>
      adapter().then((a) => a.exportNoteMarkdown(noteId)),
  },

  recycle: {
    list: () => adapter().then((a) => a.getDeletedNotes()),

    restore: (id: string) =>
      adapter().then((a) => a.restoreNote(id)),

    permanentlyDelete: (id: string) =>
      adapter().then((a) => a.permanentlyDeleteNote(id)),

    cleanOld: (older_than_days: number) =>
      adapter().then((a) => a.cleanOldDeleted(older_than_days)),

    batch: {
      delete: (ids: string[]) =>
        adapter().then((a) => a.batchDelete(ids)),

      setReadonly: (ids: string[], readonly: boolean) =>
        adapter().then((a) => a.batchSetReadonly(ids, readonly)),
    },
  },

  versions: {
    list: (noteId: string) =>
      adapter().then((a) => a.getNoteVersions(noteId)),

    restore: (versionId: string) =>
      adapter().then((a) => a.restoreNoteVersion(versionId)),
  },

  // ── Config ──
  config: {
    get: () => adapter().then((a) => a.getConfig()),
    set: (partial: Partial<AppConfig>) => adapter().then((a) => a.setConfig(partial)),
  },

  // ── Doc Tree（v2 文档分类系统）──
  docs: {
    tree: () =>
      adapter().then((a) => a.getPathTree()),

    listByPath: (pathPrefix: string) =>
      adapter().then((a) => a.getNotesByPath(pathPrefix)),

    search: (query: DocSearchQuery) =>
      adapter().then((a) => a.searchDocs(query)),

    allConcepts: () =>
      adapter().then((a) => a.getAllConcepts()),
  },
};

import type { StorageAdapter, DocSearchQuery } from "./storage/types";
import { getAdapter } from "./storage";
import type { AppConfig, CreateNoteInput, UpdateNoteInput, UpdateTodosInput, Todo } from "../types/models";
import { broadcastDataChange } from "./tab-coordination";
import { invalidateWebSearchIndex, removeFromWebSearchIndex, searchWebNotes, searchWebNoteSummaries, searchDocumentSummaries, updateWebSearchIndex } from "./web-search-index";
import { addFrontendSettingsToBackup, withFrontendSettings } from "./backup-user-settings";
import { parseJsonAsync, stringifyJsonAsync } from "./data-transform-client";
import { validateBackup } from "./backup-validation";
import { assertRestoreContext, withBackupRestore, type RestoreContext } from "./backup-restore-coordination";

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

/** Bulk writes can partially succeed; invalidate even when the operation fails. */
async function withSearchRefresh<T>(operation: Promise<T>): Promise<T> {
  try { return await operation; }
  finally {
    invalidateWebSearchIndex();
    broadcastDataChange({ type: "data-imported" });
  }
}

export const api = {
  notes: {
    listByDate: (date: string) =>
      adapter().then((a) => a.getNotesByDate(date)),

    get: (id: string) =>
      adapter().then((a) => a.getNote(id)),

    /** 获取所有日期的随笔（不含已删除），按日期倒序 */
    all: () =>
      adapter().then((a) => a.getAllNotes()),

    create: async (data: CreateNoteInput) => {
      const note = await adapter().then((a) => a.createNote(data));
      updateWebSearchIndex(note);
      broadcastDataChange({ type: "note-changed", noteId: note.id });
      return note;
    },

    upsert: async (data: CreateNoteInput) => {
      const note = await adapter().then((a) => a.upsertNote(data));
      updateWebSearchIndex(note);
      broadcastDataChange({ type: "note-changed", noteId: note.id });
      return note;
    },

    update: async (id: string, data: UpdateNoteInput) => {
      const note = await adapter().then((a) => a.updateNote(id, data));
      updateWebSearchIndex(note);
      broadcastDataChange({ type: "note-changed", noteId: id });
      return note;
    },

    updateOrder: (id: string, sort_order: number) =>
      adapter().then((a) => a.updateNoteOrder(id, sort_order)),

    delete: async (id: string) => {
      await adapter().then((a) => a.deleteNote(id));
      removeFromWebSearchIndex(id);
      broadcastDataChange({ type: "note-deleted", noteId: id });
    },

    search: (query: string) =>
      adapter().then((a) => searchWebNotes(a, query)),
    searchSummaries: (query: string) => adapter().then((a) => searchWebNoteSummaries(a, query)),

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
        const updated = await ad.updateNote(n.id, { tags: updatedTags });
        updateWebSearchIndex(updated);
        broadcastDataChange({ type: "note-changed", noteId: n.id });
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
        const updated = await ad.updateNote(n.id, { tags: updatedTags });
        updateWebSearchIndex(updated);
        broadcastDataChange({ type: "note-changed", noteId: n.id });
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
        const updated = await ad.updateNote(n.id, { tags: updatedTags });
        updateWebSearchIndex(updated);
        broadcastDataChange({ type: "note-changed", noteId: n.id });
        affected++;
      }
      return { affected };
    },
  },

  daily: {
    get: async (date: string) => {
      const storage = await adapter();
      const config = await storage.getConfig();
      return storage.getDailyPage(date, config.todo_carryover_default);
    },

    getAll: () =>
      adapter().then((a) => a.getAllDailyPages()),

    /** 搜索所有日期的待办 */
    searchTodos: async (query: string) => {
      if (!query.trim()) return [];
      const q = query.trim().toLowerCase();
      const pages = await adapter().then((a) => a.getAllDailyPages());
      const results: { todo: Todo; date: string }[] = [];
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const p = pages[pageIndex];
        if (!Array.isArray(p.todos)) continue;
        for (const t of p.todos) {
          if (t.text?.toLowerCase().includes(q)) {
            results.push({ todo: t, date: p.date });
          }
        }
        if ((pageIndex + 1) % 250 === 0 && pageIndex + 1 < pages.length) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      // 按日期倒序排列
      results.sort((a, b) => b.date.localeCompare(a.date));
      return results;
    },

    updateTodos: (data: UpdateTodosInput) =>
      adapter().then((a) => a.updateTodos(data)),
  },

  export: {
    data: async () => addFrontendSettingsToBackup(await adapter().then((a) => a.exportData())),

    import: async (json: string, mode: "merge" | "replace" = "merge", context?: RestoreContext) => {
      const bundle = await parseJsonAsync<unknown>(json);
      validateBackup(bundle);
      const settings = bundle.user_settings as { values?: Record<string, unknown> } | undefined;
      const legacyTemplates = settings?.values?.["nine-rings:templates"];
      if (bundle.templates === undefined && legacyTemplates !== undefined) {
        bundle.templates = typeof legacyTemplates === "string" ? JSON.parse(legacyTemplates) : legacyTemplates;
        validateBackup(bundle);
        json = await stringifyJsonAsync(bundle);
      }
      // Templates belong to the adapter transaction, including legacy Web→Tauri imports.
      if (settings?.values && bundle.templates !== undefined) delete settings.values["nine-rings:templates"];
      const commit = async (operation: RestoreContext) => {
        assertRestoreContext(operation);
        operation.setPhase("applying");
        const result = await withFrontendSettings(settings, async (settingsImported) => {
          const imported = await adapter().then((a) => a.importData(json, mode));
          if (settingsImported > 0) imported.configs_imported = (imported.configs_imported ?? 0) + settingsImported;
          return imported;
        });
        operation.markDataCommitted();
        invalidateWebSearchIndex();
        broadcastDataChange({ type: "data-imported" });
        return result;
      };
      return context ? commit(context) : withBackupRestore("file", mode, commit);
    },

    noteMarkdown: (noteId: string) =>
      adapter().then((a) => a.exportNoteMarkdown(noteId)),
  },

  recycle: {
    list: () => adapter().then((a) => a.getDeletedNotes()),

    restore: (id: string) =>
      withSearchRefresh(adapter().then((a) => a.restoreNote(id))),

    permanentlyDelete: (id: string) =>
      adapter().then((a) => a.permanentlyDeleteNote(id)),

    cleanOld: (older_than_days: number) =>
      adapter().then((a) => a.cleanOldDeleted(older_than_days)),

    batch: {
      delete: (ids: string[]) =>
        withSearchRefresh(adapter().then((a) => a.batchDelete(ids))),

      setReadonly: (ids: string[], readonly: boolean) =>
        withSearchRefresh(adapter().then((a) => a.batchSetReadonly(ids, readonly))),
    },
  },

  versions: {
    list: (noteId: string) =>
      adapter().then((a) => a.getNoteVersions(noteId)),

    restore: (versionId: string) =>
      withSearchRefresh(adapter().then((a) => a.restoreNoteVersion(versionId))),

    checkpoint: (noteId: string) =>
      adapter().then((a) => a.createNoteCheckpoint(noteId)),
  },

  // ── Config ──
  config: {
    get: () => adapter().then((a) => a.getConfig()),
    set: (partial: Partial<AppConfig>) => adapter().then((a) => a.setConfig(partial)),
  },

  // ── Doc Tree（v2 文档分类系统）──
  docs: {
    tree: (includeDaily = true) =>
      adapter().then((a) => a.getPathTree(includeDaily)),

    listByPath: (pathPrefix: string) =>
      adapter().then((a) => a.getNotesByPath(pathPrefix)),

    renameFolder: (oldPath: string, newPath: string) =>
      withSearchRefresh(adapter().then((a) => a.renameFolder(oldPath, newPath))),

    moveDocument: (noteId: string, targetFolderPath: string) =>
      withSearchRefresh(adapter().then((a) => a.moveDocument(noteId, targetFolderPath))),

    batchMoveDocuments: (noteIds: string[], targetFolderPath: string) =>
      withSearchRefresh(adapter().then((a) => a.batchMoveDocuments(noteIds, targetFolderPath))),

    relocateFolder: (sourcePath: string, targetPath: string) =>
      withSearchRefresh(adapter().then((a) => a.relocateFolder(sourcePath, targetPath))),

    search: (query: DocSearchQuery) =>
      adapter().then((a) => a.searchDocs(query)),

    searchSummaries: (query: DocSearchQuery) =>
      adapter().then((a) => searchDocumentSummaries(a, query)),

    allConcepts: () =>
      adapter().then((a) => a.getAllConcepts()),
  },
};

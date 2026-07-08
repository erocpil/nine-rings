import { getAdapter } from "./storage";
import type { Note, DailyPage, NoteVersion, CreateNoteInput, UpdateNoteInput, UpdateTodosInput } from "../types/models";

/**
 * API 层 — 统一接口，底层自动适配 Tauri IPC / IndexedDB
 *
 * 所有 store/component 只通过此模块访问数据，不直接引用 storage adapter。
 */

// 懒加载适配器，首次使用时 resolve
let _adapterPromise: Promise<ReturnType<typeof getAdapter>> | null = null;
function adapter(): Promise<ReturnType<typeof getAdapter>> {
  if (!_adapterPromise) {
    _adapterPromise = getAdapter();
  }
  return _adapterPromise;
}

export const api = {
  notes: {
    listByDate: (date: string) =>
      adapter().then((a) => a.getNotesByDate(date)),

    create: (data: CreateNoteInput) =>
      adapter().then((a) => a.createNote(data)),

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
  },

  daily: {
    get: (date: string) =>
      adapter().then((a) => a.getDailyPage(date)),

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
  },

  versions: {
    list: (noteId: string) =>
      adapter().then((a) => a.getNoteVersions(noteId)),

    restore: (versionId: string) =>
      adapter().then((a) => a.restoreNoteVersion(versionId)),
  },
};

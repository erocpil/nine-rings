import { invoke } from "@tauri-apps/api/core";
import type {
  Note,
  DailyPage,
  CreateNoteInput,
  UpdateNoteInput,
  UpdateTodosInput,
} from "../types/models";

export const api = {
  notes: {
    listByDate: (date: string) =>
      invoke<Note[]>("get_notes_by_date", { date }),

    create: (data: CreateNoteInput) =>
      invoke<Note>("create_note", { data }),

    update: (id: string, data: UpdateNoteInput) =>
      invoke<Note>("update_note", { id, data }),

    updateOrder: (id: string, sort_order: number) =>
      invoke<Note>("update_note_order", { id, sort_order }),

    delete: (id: string) =>
      invoke<void>("delete_note", { id }),

    search: (query: string) =>
      invoke<Note[]>("search_notes", { query }),

    listByTag: (tag: string) =>
      invoke<Note[]>("get_notes_by_tag", { tag }),
  },

  tags: {
    listAll: () =>
      invoke<string[]>("get_all_tags"),
  },

  daily: {
    get: (date: string) =>
      invoke<DailyPage>("get_daily_page", { date }),

    updateTodos: (data: UpdateTodosInput) =>
      invoke<DailyPage>("update_todos", { data }),
  },

  sync: {
    push: () => invoke<{ pushed: number }>("sync_push"),
    pull: () => invoke<{ pulled: number }>("sync_pull"),
  },

  // ──── 导出/导入 ────
  export: {
    data: () => invoke<string>("export_data"),

    import: (json: string) =>
      invoke<{ notes_imported: number; pages_imported: number }>("import_data", { json }),
  },

  // ──── 回收站 ────
  recycle: {
    list: () => invoke<Note[]>("get_deleted_notes"),

    restore: (id: string) =>
      invoke<void>("restore_note", { id }),

    permanentlyDelete: (id: string) =>
      invoke<void>("permanently_delete_note", { id }),

    cleanOld: (older_than_days: number) =>
      invoke<number>("clean_old_deleted", { olderThanDays: older_than_days }),
  },

  // ──── 版本历史 ────
  versions: {
    list: (noteId: string) =>
      invoke<NoteVersion[]>("get_note_versions", { noteId }),

    restore: (versionId: string) =>
      invoke<Note>("restore_note_version", { versionId }),
  },
};

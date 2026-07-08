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
};

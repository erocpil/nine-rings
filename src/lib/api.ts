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

    delete: (id: string) =>
      invoke<void>("delete_note", { id }),

    search: (query: string) =>
      invoke<Note[]>("search_notes", { query }),
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

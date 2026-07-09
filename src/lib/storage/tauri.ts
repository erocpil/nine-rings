import { invoke } from "@tauri-apps/api/core";
import type { Note, DailyPage, NoteVersion, CreateNoteInput, UpdateNoteInput, UpdateTodosInput } from "../../types/models";
import type { StorageAdapter, AppConfig } from "./types";

/** TauriAdapter — 通过 IPC invoke 调 Rust 后端 */
export const tauriAdapter: StorageAdapter = {
  // ── Notes ──
  getNotesByDate: (date) => invoke<Note[]>("get_notes_by_date", { date }),
  createNote: (data) => invoke<Note>("create_note", { data }),
  updateNote: (id, data) => invoke<Note>("update_note", { id, data }),
  updateNoteOrder: (id, sort_order) => invoke<Note>("update_note_order", { id, sort_order }),
  deleteNote: (id) => invoke<void>("delete_note", { id }),
  searchNotes: (query) => invoke<Note[]>("search_notes", { query }),
  getNotesByTag: (tag) => invoke<Note[]>("get_notes_by_tag", { tag }),
  getRecentDates: () => invoke<string[]>("get_recent_dates"),

  // ── Tags ──
  getAllTags: () => invoke<string[]>("get_all_tags"),

  // ── Daily ──
  getDailyPage: (date) => invoke<DailyPage>("get_daily_page", { date }),
  updateTodos: (data) => invoke<DailyPage>("update_todos", { data }),

  // ── Sync ──
  syncPush: () => invoke<{ pushed: number }>("sync_push"),
  syncPull: () => invoke<{ pulled: number }>("sync_pull"),

  // ── Export / Import ──
  exportData: () => invoke<string>("export_data"),
  importData: (json) => invoke<{ notes_imported: number; pages_imported: number }>("import_data", { json }),
  exportNoteMarkdown: (noteId) => invoke<string>("export_note_markdown", { noteId }),

  // ── Trash ──
  getDeletedNotes: () => invoke<Note[]>("get_deleted_notes"),
  restoreNote: (id) => invoke<void>("restore_note", { id }),
  permanentlyDeleteNote: (id) => invoke<void>("permanently_delete_note", { id }),
  cleanOldDeleted: (days) => invoke<number>("clean_old_deleted", { olderThanDays: days }),

  // ── Versions ──
  getNoteVersions: (noteId) => invoke<NoteVersion[]>("get_note_versions", { noteId }),
  restoreNoteVersion: (versionId) => invoke<Note>("restore_note_version", { versionId }),

  // ── Config ──
  getConfig: () => invoke<AppConfig>("get_config"),
  setConfig: (partial) => invoke<AppConfig>("set_config", { config: partial }),
};

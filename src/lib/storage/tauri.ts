/**
 * TauriAdapter — 通过 IPC 调 Rust 后端。
 *
 * Phase 3 PR B：5 个已验证操作（getNotesByDate, createNote, updateNote,
 * deleteNote, getPathTree）已切换到 tauriDriver（通用 db_query/db_exec 命令）。
 *
 * 其余操作保持旧 invoke 路径。旧 Rust 命令仍注册在 lib.rs 中（死代码但未删除），
 * PR B 验证通过后再批量移除。
 *
 * FTS5 搜索（searchNotes）不纳入 Op 抽象，保持为独立命令。
 */

import { invoke } from "@tauri-apps/api/core";
import type { Note, DailyPage, NoteVersion } from "../../types/models";
import type { StorageAdapter, AppConfig } from "./types";
import { tauriDriver } from "./tauri-driver";

/** TauriAdapter — 通过 IPC invoke 调 Rust 后端 */
export const tauriAdapter: StorageAdapter = {
  // ══════ Notes（5 个已迁移到 tauriDriver）══════

  getNotesByDate: (date) => tauriDriver.getNotesByDate(date),
  createNote: (data) => tauriDriver.createNote(data),
  updateNote: (id, data) => tauriDriver.updateNote(id, data),
  deleteNote: (id) => tauriDriver.deleteNote(id),

  // ── 未迁移，保留旧 IPC ──
  getNote: (id) => invoke<Note | null>("get_note", { id }),
  upsertNote: (data) => invoke<Note>("upsert_note", { data }),
  updateNoteOrder: (id, sort_order) => invoke<Note>("update_note_order", { id, sort_order }),
  // FTS5 全文搜索 — 有意不纳入 Op 抽象，保留独立命令
  searchNotes: (query) => invoke<Note[]>("search_notes", { query }),
  getNotesByTag: (tag) => invoke<Note[]>("get_notes_by_tag", { tag }),
  getRecentDates: () => invoke<string[]>("get_recent_dates"),

  // ── Tags ──
  getAllTags: () => invoke<string[]>("get_all_tags"),

  // ── Daily ──
  getDailyPage: (date) => invoke<DailyPage>("get_daily_page", { date }),
  updateTodos: (data) => invoke<DailyPage>("update_todos", { data }),
  getAllDailyPages: () => invoke<DailyPage[]>("get_all_daily_pages"),

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

  // ── Batch ──
  batchDelete: (ids) => invoke<void>("batch_delete", { ids }),
  batchSetReadonly: (ids, readonly) => invoke<void>("batch_set_readonly", { ids, readonly }),

  // ── Versions ──
  getNoteVersions: (noteId) => invoke<NoteVersion[]>("get_note_versions", { noteId }),
  restoreNoteVersion: (versionId) => invoke<Note>("restore_note_version", { versionId }),

  // ── Config ──
  getConfig: () => invoke<AppConfig>("get_config"),
  setConfig: (partial) => invoke<AppConfig>("set_config", { config: partial }),

  // ══════ Doc Tree（getPathTree 已迁移，其余保留）══════

  getPathTree: () => tauriDriver.getPathTree(),
  getNotesByPath: (pathPrefix) => invoke<Note[]>("get_notes_by_path", { pathPrefix }),
  searchDocs: (query) => invoke<Note[]>("search_docs", { query }),
  getAllConcepts: () => invoke<string[]>("get_all_concepts"),
};

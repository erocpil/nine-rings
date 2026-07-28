/**
 * TauriAdapter — 通过 IPC 调 Rust 后端。
 *
 * Phase 3A 完成：upsertNote / getRecentDates / getAllDailyPages / batchDelete /
 * batchSetReadonly / getNoteVersions / restoreNoteVersion / createNoteCheckpoint
 * 已迁移到 tauriDriver（通用 db_query/db_exec/db_transaction 命令）。
 *
 * 未迁移的操作保持旧 invoke 路径（均为已注册且 Rust 侧有实现的命令）。
 *
 * 不纳入 Op 抽象的操作：FTS5 搜索、同步、导出/导入、配置、托盘/快捷记录。
 */

import { invoke } from "@tauri-apps/api/core";
import type { Note, DailyPage } from "../../types/models";
import type { StorageAdapter, AppConfig } from "./types";
import { tauriDriver } from "./tauri-driver";

/** TauriAdapter — 通过 IPC invoke 调 Rust 后端 */
export const tauriAdapter: StorageAdapter = {
  // ══════ Notes（已迁移到 tauriDriver）══════

  getNotesByDate: (date) => tauriDriver.getNotesByDate(date),
  createNote: (data) => tauriDriver.createNote(data),
  updateNote: (id, data) => tauriDriver.updateNote(id, data),
  deleteNote: (id) => tauriDriver.deleteNote(id),
  upsertNote: (data) => tauriDriver.upsertNote(data),
  getRecentDates: () => tauriDriver.getRecentDates(),
  getAllNotes: () => tauriDriver.getAllDailyNotes(),
  batchDelete: (ids) => tauriDriver.batchDelete(ids),
  batchSetReadonly: (ids, readonly) => tauriDriver.batchSetReadonly(ids, readonly),
  getNoteVersions: (noteId) => tauriDriver.getNoteVersions(noteId),
  restoreNoteVersion: (versionId) => tauriDriver.restoreNoteVersion(versionId),
  createNoteCheckpoint: (noteId) => tauriDriver.createNoteCheckpoint(noteId),

  // ── 未迁移，保留旧 IPC ──
  getNote: (id) => invoke<Note | null>("get_note", { id }),
  updateNoteOrder: (id, sort_order) => invoke<Note>("update_note_order", { id, sort_order }),
  // FTS5 全文搜索 — 有意不纳入 Op 抽象，保留独立命令
  searchNotes: (query) => invoke<Note[]>("search_notes", { query }),
  getNotesByTag: (tag) => invoke<Note[]>("get_notes_by_tag", { tag }),

  // ── Tags ──
  getAllTags: () => invoke<string[]>("get_all_tags"),

  // ── Daily ──
  getDailyPage: (date) => invoke<DailyPage>("get_daily_page", { date }),
  updateTodos: (data) => invoke<DailyPage>("update_todos", { data }),
  getAllDailyPages: () => tauriDriver.getAllDailyPages(),

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

  // ── Config ──
  getConfig: () => invoke<AppConfig>("get_config"),
  setConfig: (partial) => invoke<AppConfig>("set_config", { config: partial }),

  // ══════ Doc Tree（getPathTree 已迁移，其余保留）══════

  getPathTree: () => tauriDriver.getPathTree(),
  getNotesByPath: (pathPrefix) => invoke<Note[]>("get_notes_by_path", { pathPrefix }),

  async renameFolder(oldPath: string, newPath: string): Promise<number> {
    if (!oldPath || !newPath || oldPath === newPath) return 0;
    const docs = await invoke<Note[]>("get_notes_by_path", { pathPrefix: oldPath });
    let count = 0;
    for (const doc of docs) {
      const sp = (doc as any).storage_path ?? doc.storagePath;
      if (!sp) continue;
      let newSp: string;
      if (sp === oldPath) {
        newSp = newPath;
      } else if (sp.startsWith(oldPath + "/")) {
        newSp = newPath + sp.slice(oldPath.length);
      } else {
        continue;
      }
      await tauriDriver.updateNote(doc.id, { storagePath: newSp });
      count++;
    }
    return count;
  },

  searchDocs: (query) => invoke<Note[]>("search_docs", { query }),
  getAllConcepts: () => invoke<string[]>("get_all_concepts"),
};

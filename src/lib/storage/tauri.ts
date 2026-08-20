/**
 * TauriAdapter — 通过 IPC 调 Rust 后端。
 *
 * Phase 3A 完成：upsertNote / getRecentDates / getAllDailyPages / batchDelete /
 * batchSetReadonly / getNoteVersions / restoreNoteVersion / createNoteCheckpoint
 * 已迁移到 tauriDriver（通用 db_query/db_exec/db_transaction 命令）。
 *
 * Phase 4A：旧 invoke 响应过 snakeNoteToCamel 规范化，消除 as any 桥接。
 *
 * 不纳入 Op 抽象的操作：FTS5 搜索、导出/导入、配置、托盘/快捷记录。
 */

import { invoke } from "@tauri-apps/api/core";
import type { Note, DailyPage } from "../../types/models";
import type { StorageAdapter, AppConfig } from "./types";
import { tauriDriver } from "./tauri-driver";
import { snakeNoteToCamel, snakeDailyPageToCamel } from "./normalize";

// ── 旧 invoke 响应规范化 ──

/** 包装 invoke，将 Rust snake_case 响应规范化为 TS camelCase */
async function invokeNote(cmd: string, args: Record<string, unknown> = {}): Promise<Note> {
  const raw = await invoke<any>(cmd, args);
  return snakeNoteToCamel(raw);
}

async function invokeNoteNullable(cmd: string, args: Record<string, unknown> = {}): Promise<Note | null> {
  const raw = await invoke<any>(cmd, args);
  if (raw === null || raw === undefined) return null;
  return snakeNoteToCamel(raw);
}

async function invokeNotes(cmd: string, args: Record<string, unknown> = {}): Promise<Note[]> {
  const raw = await invoke<any[]>(cmd, args);
  return raw.map(snakeNoteToCamel);
}

async function invokeDailyPage(cmd: string, args: Record<string, unknown> = {}): Promise<DailyPage> {
  const raw = await invoke<any>(cmd, args);
  return snakeDailyPageToCamel(raw);
}

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

  // ── 旧 IPC（过规范化包装，消除 snake_case → camelCase 桥接）──
  getNote: (id) => invokeNoteNullable("get_note", { id }),
  updateNoteOrder: (id, sort_order) => invokeNote("update_note_order", { id, sort_order }),
  // FTS5 全文搜索 — 有意不纳入 Op 抽象，保留独立命令
  searchNotes: (query) => invokeNotes("search_notes", { query }),
  getNotesByTag: (tag) => invokeNotes("get_notes_by_tag", { tag }),

  // ── Tags ──
  getAllTags: () => invoke<string[]>("get_all_tags"),

  // ── Daily ──
  getDailyPage: (date) => invokeDailyPage("get_daily_page", { date }),
  updateTodos: (data) => invokeDailyPage("update_todos", { data }),
  getAllDailyPages: () => tauriDriver.getAllDailyPages(),

  // ── Export / Import ──
  exportData: () => invoke<string>("export_data"),
  importData: (json) => invoke<{ notes_imported: number; pages_imported: number }>("import_data", { json }),
  exportNoteMarkdown: (noteId) => invoke<string>("export_note_markdown", { noteId }),

  // ── Trash ──
  getDeletedNotes: () => invokeNotes("get_deleted_notes"),
  restoreNote: (id) => invoke<void>("restore_note", { id }),
  permanentlyDeleteNote: (id) => invoke<void>("permanently_delete_note", { id }),
  cleanOldDeleted: (days) => invoke<number>("clean_old_deleted", { olderThanDays: days }),

  // ── Config ──
  getConfig: () => invoke<AppConfig>("get_config"),
  setConfig: (partial) => invoke<AppConfig>("set_config", { config: partial }),

  // ══════ Doc Tree（getPathTree 已迁移，其余保留）══════

  getPathTree: (includeDaily) => tauriDriver.getPathTree(includeDaily),
  getNotesByPath: (pathPrefix) => invokeNotes("get_notes_by_path", { pathPrefix }),
  moveDocument: (noteId, targetFolderPath) => tauriDriver.moveDocument(noteId, targetFolderPath),
  relocateFolder: (sourcePath, targetPath) => tauriDriver.relocateFolder(sourcePath, targetPath),

  async renameFolder(oldPath: string, newPath: string): Promise<number> {
    if (!oldPath || !newPath || oldPath === newPath) return 0;
    // getNotesByPath 现在通过 invokeNotes 返回规范化后的 camelCase Note
    const docs = await invokeNotes("get_notes_by_path", { pathPrefix: oldPath });
    let count = 0;
    for (const doc of docs) {
      if (!doc.storagePath) continue;
      let newSp: string;
      if (doc.storagePath === oldPath) {
        newSp = newPath;
      } else if (doc.storagePath.startsWith(oldPath + "/")) {
        newSp = newPath + doc.storagePath.slice(oldPath.length);
      } else {
        continue;
      }
      await tauriDriver.updateNote(doc.id, { storagePath: newSp });
      count++;
    }
    return count;
  },

  searchDocs: (query) => invokeNotes("search_docs", { query }),
  getAllConcepts: () => invoke<string[]>("get_all_concepts"),
};

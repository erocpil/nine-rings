import { noteToMarkdown } from "../markdown-serializer";
/**
 * TauriAdapter — 通过 IPC 调 Rust 后端。
 *
 * Phase 3A 完成：upsertNote / getRecentDates / batchDelete /
 * batchSetReadonly / getNoteVersions / restoreNoteVersion / createNoteCheckpoint
 * 已迁移到 tauriDriver（通用 db_query/db_exec/db_transaction 命令）。
 *
 * Phase 4A：旧 invoke 响应过 snakeNoteToCamel 规范化，消除 as any 桥接。
 *
 * 不纳入 Op 抽象的操作：FTS5 搜索、导出/导入、配置、托盘。
 */

import { invoke } from "@tauri-apps/api/core";
import type { Note } from "../../types/models";
import type { StorageAdapter, AppConfig } from "./types";
import { tauriDriver } from "./tauri-driver";
import { type SnakeNoteRow, snakeNoteToCamel } from "./normalize";
import { tauriTemplates } from "./template-tauri";
import { resolveImageRefs } from "./db-images";
import { validateBackup } from "../backup-validation";

// ── 旧 invoke 响应规范化 ──

/** 包装 invoke，将 Rust snake_case 响应规范化为 TS camelCase */
async function invokeNote(cmd: string, args: Record<string, unknown> = {}): Promise<Note> {
  const raw = await invoke<SnakeNoteRow>(cmd, args);
  return snakeNoteToCamel(raw);
}

async function invokeNoteNullable(cmd: string, args: Record<string, unknown> = {}): Promise<Note | null> {
  const raw = await invoke<SnakeNoteRow | null>(cmd, args);
  if (raw === null || raw === undefined) return null;
  return snakeNoteToCamel(raw);
}

async function invokeNotes(cmd: string, args: Record<string, unknown> = {}): Promise<Note[]> {
  const raw = await invoke<SnakeNoteRow[]>(cmd, args);
  return raw.map(snakeNoteToCamel);
}

/** TauriAdapter — 通过 IPC invoke 调 Rust 后端 */
export const tauriAdapter: StorageAdapter = {
  ...tauriTemplates,
  // ══════ Notes（已迁移到 tauriDriver）══════

  getNotesByDate: (date) => tauriDriver.getNotesByDate(date),
  createNote: (data) => tauriDriver.createNote(data),
  updateNote: (id, data) => tauriDriver.updateNote(id, data),
  deleteNote: (id) => tauriDriver.deleteNote(id),
  upsertNote: (data) => tauriDriver.upsertNote(data),
  getRecentDates: () => tauriDriver.getRecentDates(),
  getAllNotes: () => tauriDriver.getAllNotes(),
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

  // ── Export / Import ──
  exportData: async () => {
    const data = JSON.parse(await invoke<string>("export_data"));
    data.notes = await resolveImageRefs(data.notes);
    return JSON.stringify(data);
  },
  importData: (json, mode = "merge") => {
    const data = JSON.parse(json);
    validateBackup(data);
    // Compatibility for legacy SQLite-shaped JSON fields; shared validation
    // runs before invoking Rust, whose serde model also enforces field types.
    for (const note of data.notes) {
      for (const key of ["content", "tags", "concepts", "linked_doc_ids", "linkedDocIds"]) {
        if (typeof note[key] === "string") note[key] = JSON.parse(note[key]);
      }
      // Legacy SQLite exports store content as JSON text. Redact only after
      // decoding so both representations receive the same protection.
      if (note.content && typeof note.content === "object" && "encrypted" in note.content) note.search_text = "";
      for (const key of ["tags", "concepts", "linked_doc_ids"]) if (note[key] === null) note[key] = [];
      if (note.linkedDocIds === null) note.linkedDocIds = [];
    }
    return invoke<{ notes_imported: number }>("import_data", {
      json: JSON.stringify(data),
      replace: mode === "replace",
    });
  },
  exportNoteMarkdown: async (noteId) => {
    const note = await invokeNoteNullable("get_note", { id: noteId });
    if (!note) throw new Error(`Note ${noteId} not found`);
    return noteToMarkdown(note.title, note.content);
  },

  // ── Trash ──
  getDeletedNotes: () => invokeNotes("get_deleted_notes"),
  restoreNote: (id) => invoke<void>("restore_note", { id }),
  permanentlyDeleteNote: (id) => invoke<void>("permanently_delete_note", { id }),
  cleanOldDeleted: (days) => invoke<number>("clean_old_deleted", { olderThanDays: days }),

  // ── Config ──
  getConfig: () => invoke<AppConfig>("get_config"),
  setConfig: (partial) => invoke<AppConfig>("set_config", { config: partial }),

  // ══════ Doc Tree（getPathTree 已迁移，其余保留）══════

  getPathTree: () => tauriDriver.getPathTree(),
  getNotesByPath: (pathPrefix) => invokeNotes("get_notes_by_path", { pathPrefix }),
  moveDocument: (noteId, targetFolderPath) => tauriDriver.moveDocument(noteId, targetFolderPath),
  batchMoveDocuments: (noteIds, targetFolderPath) => tauriDriver.batchMoveDocuments(noteIds, targetFolderPath),
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

/**
 * IndexedDBAdapter — 纯浏览器端存储，零依赖
 * 实现 StorageAdapter 全部接口，与 Tauri (SQLite) 后端语义对齐
 */

import type { Note, DailyPage, Todo, CreateNoteInput, UpdateNoteInput, UpdateTodosInput, PathNode } from "../../types/models";
import type { StorageAdapter, DocSearchQuery } from "./types";
import {
  assertFolderRelocation,
  buildDocTree,
  extractPlainText,
  isPathUnder,
  normalizeStoragePath,
  uuid,
  now,
  noteToDB,
  noteFromDB,
  upsertMatchKey,
  type FlatDocRecord,
  type FlatDailyRecord,
} from "./core";
import { withDB, getOne, getAll, getAllFromIndex, putRecord, abortTransaction, delRecord } from "./db";
import { saveVersionSnapshot, createNoteCheckpoint, getNoteVersions, restoreNoteVersion } from "./db-versions";
import { exportData, importData, exportNoteMarkdown } from "./db-export-import";
import { getConfig, setConfig } from "./db-config";
import { localDateKey } from "../local-date";
export { extractSnippet } from "./idb-snippet";

// ── 工具函数 ──

function today(): string {
  return localDateKey();
}

// ── 适配器实现 ──

export const idbAdapter: StorageAdapter = {
  // ══════ Notes ══════

  async getNotesByDate(date: string): Promise<Note[]> {
    return withDB(async (db) => {
      const index = db.transaction("notes", "readonly").objectStore("notes").index("date");
      const all = await getAllFromIndex<any>(index, date);
      return all.filter((n) => !n.deleted_at).sort(sortNotes).map(noteFromDB);
    });
  },

  async getNote(id: string): Promise<Note | null> {
    return withDB(async (db) => {
      const store = db.transaction("notes", "readonly").objectStore("notes");
      const note = await getOne<any>(store, id);
      if (!note || note.deleted_at) return null;
      return noteFromDB(note);
    });
  },

  async createNote(data: CreateNoteInput): Promise<Note> {
    return withDB(async (db) => {
      const tx = db.transaction(["notes", "note_versions"], "readwrite");
      const noteStore = tx.objectStore("notes");

      const note: Note = {
        id: uuid(),
        date: data.date ?? today(),
        title: data.title ?? null,
        content: data.content ?? { ops: [] },
        tags: data.tags ?? [],
        pinned: data.pinned ?? false,
        readonly: false,
        sort_order: 0,
        created_at: now(),
        updated_at: now(),
        storagePath: data.storagePath,
        docType: data.docType,
        concepts: data.concepts,
        linkedDocIds: data.linkedDocIds,
      };

      await putRecord(noteStore, noteToDB(note));
      return note;
    });
  },

  async upsertNote(data: CreateNoteInput): Promise<Note> {
    return withDB(async (db) => {
      // ── 查重 + 写入合并到同一个 readwrite 事务，消除 TOCTOU 竞态 ──
      // IndexedDB 对同一 scope 的 readwrite 事务串行化，事务内的读改写是原子的。
      const tx = db.transaction(["notes", "note_versions"], "readwrite");
      const noteStore = tx.objectStore("notes");
      const verStore = tx.objectStore("note_versions");

      // ── 查重：匹配谓词由 core.ts 的 upsertMatchKey 统一 ──
      const matchKey = upsertMatchKey(data);
      let existing: Note | null = null;

      if (matchKey?.kind === "document") {
        // 文档：按 storagePath + title 匹配（同一目录允许多篇不同标题文档）
        const index = noteStore.index("storagePath");
        const rows = await getAllFromIndex<any>(index, matchKey.storagePath);
        const candidates = rows
          .filter((n: any) => !n.deleted_at && n.title === matchKey.title)
          .sort((a: any, b: any) =>
            (b.updated_at ?? "").localeCompare(a.updated_at ?? "") ||
            (a.id ?? "").localeCompare(b.id ?? ""),
          );
        existing = candidates[0] ? noteFromDB(candidates[0]) : null;
      } else if (matchKey?.kind === "daily") {
        // 随笔：按 title + date 匹配（仅非文档笔记，storagePath 为空）
        const all = await getAll<any>(noteStore);
        const candidates = all
          .filter(
            (n: any) =>
              !n.deleted_at &&
              !n.storagePath &&
              n.title === matchKey.title &&
              n.date === matchKey.date,
          )
          .sort((a: any, b: any) =>
            (b.updated_at ?? "").localeCompare(a.updated_at ?? "") ||
            (a.id ?? "").localeCompare(b.id ?? ""),
          );
        existing = candidates[0] ? noteFromDB(candidates[0]) : null;
      }

      // ── 写：命中则保留旧元数据（created_at / readonly / sort_order）──
      const note: Note = {
        id: existing?.id ?? uuid(),
        date: data.date ?? today(),
        title: data.title ?? null,
        content: data.content ?? { ops: [] },
        tags: data.tags ?? [],
        pinned: data.pinned ?? false,
        readonly: existing?.readonly ?? false,
        sort_order: existing?.sort_order ?? 0,
        created_at: existing?.created_at ?? now(),
        updated_at: now(),
        storagePath: data.storagePath,
        docType: data.docType,
        concepts: data.concepts,
        linkedDocIds: data.linkedDocIds,
      };

      await putRecord(noteStore, noteToDB(note));

      if (existing && data.content) {
        await saveVersionSnapshot(verStore, note);
      }

      return note;
    });
  },

  async updateNote(id: string, data: UpdateNoteInput): Promise<Note> {
    return withDB(async (db) => {
      const tx = db.transaction(["notes"], "readwrite");
      const noteStore = tx.objectStore("notes");

      const existing = await getOne<any>(noteStore, id);
      if (!existing) throw new Error(`Note ${id} not found`);

      const updated: any = {
        ...existing,
        ...data,
        updated_at: now(),
        tags: data.tags !== undefined ? JSON.stringify(data.tags) : existing.tags,
        pinned: data.pinned !== undefined ? (data.pinned ? 1 : 0) : existing.pinned,
        readonly: data.readonly !== undefined ? (data.readonly ? 1 : 0) : existing.readonly,
        search_text: data.content ? extractPlainText(data.content) : existing.search_text,
      };

      await putRecord(noteStore, updated);
      return noteFromDB(updated);
    });
  },

  createNoteCheckpoint,

  async updateNoteOrder(id: string, sort_order: number): Promise<Note> {
    return withDB(async (db) => {
      const tx = db.transaction("notes", "readwrite");
      const store = tx.objectStore("notes");
      const existing = await getOne<any>(store, id);
      if (!existing) throw new Error(`Note ${id} not found`);
      existing.sort_order = sort_order;
      existing.updated_at = now();
      await putRecord(store, existing);
      return noteFromDB(existing);
    });
  },

  async deleteNote(id: string): Promise<void> {
    return withDB(async (db) => {
      const store = db.transaction("notes", "readwrite").objectStore("notes");
      const existing = await getOne<any>(store, id);
      if (!existing) return;
      existing.deleted_at = now();
      existing.updated_at = now();
      await putRecord(store, existing);
    });
  },

  async searchNotes(query: string): Promise<Note[]> {
    if (!query.trim()) return [];
    const like = query.trim().toLowerCase();
    return withDB(async (db) => {
      const store = db.transaction("notes", "readonly").objectStore("notes");
      const all = await getAll<any>(store);
      return all
        .filter((n) => !n.deleted_at)
        .filter((n) => (n.search_text ?? "").toLowerCase().includes(like))
        .sort((a, b) => (b.pinned ?? 0) - (a.pinned ?? 0) || b.updated_at.localeCompare(a.updated_at))
        .map(noteFromDB);
    });
  },

  async getNotesByTag(tag: string): Promise<Note[]> {
    return withDB(async (db) => {
      const store = db.transaction("notes", "readonly").objectStore("notes");
      const all = await getAll<any>(store);
      return all
        .filter((n) => !n.deleted_at)
        .filter((n) => {
          try {
            const tags = typeof n.tags === "string" ? JSON.parse(n.tags) : n.tags;
            return Array.isArray(tags) && tags.includes(tag);
          } catch {
            return false;
          }
        })
        .sort(sortNotes)
        .map(noteFromDB);
    });
  },

  async getRecentDates(): Promise<string[]> {
    return withDB(async (db) => {
      const store = db.transaction("notes", "readonly").objectStore("notes");
      const all = await getAll<any>(store);
      const dates = new Set(
        all.filter((n) => !n.deleted_at).map((n) => n.date)
      );
      return [...dates].sort().reverse().slice(0, 30);
    });
  },

  // ══════ Tags ══════

  async getAllTags(): Promise<string[]> {
    return withDB(async (db) => {
      const store = db.transaction("notes", "readonly").objectStore("notes");
      const all = await getAll<any>(store);
      const tags = new Set<string>();
      for (const n of all) {
        if (n.deleted_at) continue;
        try {
          const list = typeof n.tags === "string" ? JSON.parse(n.tags) : n.tags;
          if (Array.isArray(list)) list.forEach((t: string) => tags.add(t));
        } catch { /* skip */ }
      }
      return [...tags].sort();
    });
  },

  // ══════ Daily Page ══════

  async getDailyPage(date: string): Promise<DailyPage> {
    return withDB(async (db) => {
      const store = db.transaction("daily_pages", "readwrite").objectStore("daily_pages");
      let page = await getOne<any>(store, date);
      if (!page) {
        // Try carryover from yesterday (local date arithmetic, not UTC)
        const d = new Date(date + "T00:00:00");
        d.setDate(d.getDate() - 1);
        const yesterday = localDateKey(d);
        const yPage = await getOne<any>(store, yesterday);
        let carryoverTodos: Todo[] = [];
        if (yPage && yPage.todo_carryover) {
          const todos: Todo[] = typeof yPage.todos === "string" ? JSON.parse(yPage.todos) : yPage.todos;
          carryoverTodos = todos
            .filter((t: any) => !(t.done === 1 || t.done === true))
            .map((t: any) => ({ ...t, id: uuid() }));
        }
        page = {
          date,
          todos: JSON.stringify(carryoverTodos),
          todo_carryover: 0,
          updated_at: now(),
        };
        await putRecord(store, page);
      }
      return {
        date: page.date,
        todos: typeof page.todos === "string" ? JSON.parse(page.todos) : page.todos,
        todo_carryover: page.todo_carryover === 1 || page.todo_carryover === true,
        updated_at: page.updated_at,
      };
    });
  },

  async getAllDailyPages(): Promise<DailyPage[]> {
    return withDB(async (db) => {
      const store = db.transaction("daily_pages", "readonly").objectStore("daily_pages");
      const all = await getAll<any>(store);
      return all.map((p: any) => ({
        date: p.date,
        todos: typeof p.todos === "string" ? JSON.parse(p.todos) : p.todos,
        todo_carryover: p.todo_carryover === 1 || p.todo_carryover === true,
        updated_at: p.updated_at,
      }));
    });
  },

  async updateTodos(data: UpdateTodosInput): Promise<DailyPage> {
    return withDB(async (db) => {
      const store = db.transaction("daily_pages", "readwrite").objectStore("daily_pages");
      const page: any = {
        date: data.date,
        todos: JSON.stringify(data.todos),
        todo_carryover: data.todo_carryover ? 1 : 0,
        updated_at: now(),
      };
      await putRecord(store, page);
      return {
        date: page.date,
        todos: data.todos,
        todo_carryover: !!data.todo_carryover,
        updated_at: page.updated_at,
      };
    });
  },

  exportData,
  importData,
  exportNoteMarkdown,

  // ══════ Trash ══════

  async getDeletedNotes(): Promise<Note[]> {
    return withDB(async (db) => {
      const store = db.transaction("notes", "readonly").objectStore("notes");
      const all = await getAll<any>(store);
      return all
        .filter((n) => n.deleted_at)
        .sort((a, b) => b.deleted_at.localeCompare(a.deleted_at))
        .map(noteFromDB);
    });
  },

  async restoreNote(id: string): Promise<void> {
    return withDB(async (db) => {
      const store = db.transaction("notes", "readwrite").objectStore("notes");
      const existing = await getOne<any>(store, id);
      if (!existing) return;
      delete existing.deleted_at;
      existing.updated_at = now();
      await putRecord(store, existing);
    });
  },

  async permanentlyDeleteNote(id: string): Promise<void> {
    return withDB(async (db) => {
      const tx = db.transaction(["notes", "note_versions"], "readwrite");
      await delRecord(tx.objectStore("notes"), id);

      // Delete all versions for this note
      const verIndex = tx.objectStore("note_versions").index("note_id");
      const versions = await getAllFromIndex<any>(verIndex, id);
      for (const v of versions) {
        await delRecord(tx.objectStore("note_versions"), v.id);
      }
    });
  },

  async cleanOldDeleted(olderThanDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
    return withDB(async (db) => {
      const store = db.transaction("notes", "readwrite").objectStore("notes");
      const all = await getAll<any>(store);
      let cleaned = 0;
      for (const n of all) {
        if (n.deleted_at && n.deleted_at < cutoff) {
          await delRecord(store, n.id);
          cleaned++;
        }
      }
      return cleaned;
    });
  },

  // ══════ Batch ══════

  async batchDelete(ids: string[]): Promise<void> {
    return withDB(async (db) => {
      const store = db.transaction("notes", "readwrite").objectStore("notes");
      const nowStr = now();
      for (const id of ids) {
        const existing = await getOne<any>(store, id);
        if (!existing) continue;
        existing.deleted_at = nowStr;
        existing.updated_at = nowStr;
        await putRecord(store, existing);
      }
    });
  },

  async batchSetReadonly(ids: string[], readonly: boolean): Promise<void> {
    return withDB(async (db) => {
      const store = db.transaction("notes", "readwrite").objectStore("notes");
      const val = readonly ? 1 : 0;
      for (const id of ids) {
        const existing = await getOne<any>(store, id);
        if (!existing) continue;
        existing.readonly = val;
        existing.updated_at = now();
        await putRecord(store, existing);
      }
    });
  },

  getNoteVersions,
  restoreNoteVersion,

  getConfig,
  setConfig,

  // ══════ Doc Tree（v2 文档分类系统）══════

  /** 构建文档树: 查询 IDB → 映射为 FlatRecord → 委托 core.ts buildDocTree */
  async getPathTree(): Promise<PathNode[]> {
    return withDB(async (db) => {
      const store = db.transaction("notes", "readonly").objectStore("notes");
      const all = await getAll<any>(store);
      const notes = all.filter((n) => !n.deleted_at).map(noteFromDB);

      // 映射为 core.ts 的输入类型（snake_case）
      const docs: FlatDocRecord[] = [];
      const dailies: FlatDailyRecord[] = [];
      for (const n of notes) {
        if (n.storagePath) {
          docs.push({
            id: n.id,
            title: n.title,
            storage_path: n.storagePath,
            doc_type: n.docType,
            updated_at: n.updated_at,
            readonly: n.readonly ?? false,
          });
        } else {
          dailies.push({
            id: n.id,
            date: n.date,
            title: n.title,
            updated_at: n.updated_at,
          });
        }
      }

      return buildDocTree(docs, dailies);
    });
  },

  async getNotesByPath(pathPrefix: string): Promise<Note[]> {
    return withDB(async (db) => {
      const store = db.transaction("notes", "readonly").objectStore("notes");
      const all = await getAll<any>(store);
      const notes = all.filter((n) => !n.deleted_at).map(noteFromDB);

      // daily/ 前缀 → 返回对应日期的每日随笔（无 storagePath）
      if (pathPrefix.startsWith("daily/")) {
        const date = pathPrefix.slice(6); // 去掉 "daily/"
        if (date) {
          return notes
            .filter((n) => n.date === date && !n.storagePath)
            .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
        }
        return notes
          .filter((n) => !n.storagePath)
          .sort((a, b) => b.date.localeCompare(a.date) || (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
      }

      return notes
        .filter((n) => n.storagePath && (n.storagePath === pathPrefix || n.storagePath.startsWith(pathPrefix + "/")))
        .sort((a, b) => (a.storagePath ?? "").localeCompare(b.storagePath ?? ""));
    });
  },

  async renameFolder(oldPath: string, newPath: string): Promise<number> {
    return this.relocateFolder(oldPath, newPath);
  },

  async moveDocument(noteId: string, targetFolderPath: string): Promise<number> {
    const target = normalizeStoragePath(targetFolderPath);
    return withDB(async (db) => {
      const tx = db.transaction("notes", "readwrite");
      try {
        const store = tx.objectStore("notes");
        const note = await getOne<any>(store, noteId);
        if (!note || note.deleted_at || !(note.storagePath ?? note.storage_path)) {
          throw new Error("只能移动未删除的普通文档");
        }
        note.storagePath = target;
        delete note.storage_path;
        await putRecord(store, note);
        return 1;
      } catch (error) {
        await abortTransaction(tx);
        throw error;
      }
    });
  },

  async relocateFolder(sourcePath: string, targetPath: string): Promise<number> {
    const { source, target } = assertFolderRelocation(sourcePath, targetPath);
    return withDB(async (db) => {
      const tx = db.transaction("notes", "readwrite");
      try {
        const store = tx.objectStore("notes");
        const all = await getAll<any>(store);
        const docs = all.filter((n) => {
          const path = n.storagePath ?? n.storage_path;
          return !n.deleted_at && path && isPathUnder(path, source);
        });
        if (docs.length === 0) throw new Error("源目录不存在或没有可移动文档");
        for (const note of docs) {
          const path = note.storagePath ?? note.storage_path;
          note.storagePath = path === source ? target : target + path.slice(source.length);
          delete note.storage_path;
          await putRecord(store, note);
        }
        return docs.length;
      } catch (error) {
        await abortTransaction(tx);
        throw error;
      }
    });
  },

  async searchDocs(query: DocSearchQuery): Promise<Note[]> {
    return withDB(async (db) => {
      const store = db.transaction("notes", "readonly").objectStore("notes");
      const all = await getAll<any>(store);
      return all
        .filter((n) => !n.deleted_at)
        .filter((n) => {
          if (query.storagePath && !n.storagePath?.startsWith(query.storagePath)) return false;
          if (query.docType && n.docType !== query.docType) return false;
          if (query.concept) {
            const concepts: string[] = typeof n.concepts === "string"
              ? JSON.parse(n.concepts)
              : n.concepts ?? [];
            if (!concepts.includes(query.concept)) return false;
          }
          if (query.text) {
            const text = (n.search_text ?? "") + " " + (n.title ?? "") + " " + (Array.isArray(n.tags) ? n.tags.join(" ") : n.tags ?? "");
            if (!text.toLowerCase().includes(query.text.toLowerCase())) return false;
          }
          if (query.staleBefore) {
            if ((n.updated_at ?? "") > query.staleBefore) return false;
          }
          return true;
        })
        .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
        .map(noteFromDB);
    });
  },

  /** 获取所有日期的随笔（storagePath 为空的笔记，不含文档视图中的文档） */
  async getAllNotes(): Promise<Note[]> {
    return withDB(async (db) => {
      const store = db.transaction("notes", "readonly").objectStore("notes");
      const all = await getAll<any>(store);
      return all
        .filter((n) => !n.deleted_at && !n.storagePath)
        .sort((a: any, b: any) => (b.date ?? "").localeCompare(a.date ?? "") || (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
        .map(noteFromDB);
    });
  },

  async getAllConcepts(): Promise<string[]> {
    return withDB(async (db) => {
      const store = db.transaction("notes", "readonly").objectStore("notes");
      const all = await getAll<any>(store);
      const concepts = new Set<string>();
      for (const n of all) {
        if (n.deleted_at) continue;
        try {
          const list: string[] = typeof n.concepts === "string"
            ? JSON.parse(n.concepts)
            : n.concepts ?? [];
          if (Array.isArray(list)) list.forEach((c) => concepts.add(c));
        } catch { /* skip */ }
      }
      return [...concepts].sort();
    });
  },
};

// ── 排序辅助 ──

function sortNotes(a: any, b: any): number {
  // pinned first, then sort_order ascending, then created_at ascending
  const pa = a.pinned === 1 || a.pinned === true ? 1 : 0;
  const pb = b.pinned === 1 || b.pinned === true ? 1 : 0;
  if (pb !== pa) return pb - pa;
  const sa = a.sort_order ?? 0;
  const sb = b.sort_order ?? 0;
  if (sa !== sb) return sa - sb;
  return (a.created_at ?? "").localeCompare(b.created_at ?? "");
}

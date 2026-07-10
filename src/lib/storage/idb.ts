/**
 * IndexedDBAdapter — 纯浏览器端存储，零依赖
 * 实现 StorageAdapter 全部接口，与 Tauri (SQLite) 后端语义对齐
 */

import type { Note, DailyPage, Todo, NoteVersion, CreateNoteInput, UpdateNoteInput, UpdateTodosInput, PathNode } from "../../types/models";
import type { StorageAdapter, AppConfig, DocSearchQuery } from "./types";
import { DEFAULT_CONFIG } from "./types";

const DB_NAME = "nine_rings";
const DB_VERSION = 2;

// ── 工具函数 ──

const CONFIG_KEY = "nine_rings_config";

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function now(): string {
  return new Date().toISOString();
}

function today(): string {
  return now().slice(0, 10);
}

/** 从 Delta JSON 提取纯文本用于搜索 */
function extractPlainText(content: any): string {
  try {
    const ops = content?.ops ?? (Array.isArray(content) ? content : []);
    return ops
      .filter((op: any) => typeof op.insert === "string")
      .map((op: any) => op.insert)
      .join("")
      .trim();
  } catch {
    return "";
  }
}

/** Delta → Markdown（与 Rust 侧 delta_to_markdown 逻辑一致） */
function deltaToMarkdown(content: any): string {
  try {
    const ops = content?.ops ?? (Array.isArray(content) ? content : []);
    const lines: string[] = [];
    for (const op of ops) {
      if (typeof op.insert !== "string") continue;
      if (op.insert === "\n") continue;
      let text = op.insert;
      const attrs = op.attributes ?? {};
      if (attrs.bold) text = `**${text}**`;
      if (attrs.italic) text = `*${text}*`;
      if (attrs.strike) text = `~~${text}~~`;
      if (attrs.code) text = `\`${text}\``;
      if (attrs.link) text = `[${text}](${attrs.link})`;
      if (attrs.header === 1) text = `# ${text}`;
      if (attrs.header === 2) text = `## ${text}`;
      if (attrs.header === 3) text = `### ${text}`;
      if (attrs.list === "bullet") text = `- ${text}`;
      if (attrs.list === "ordered") text = `1. ${text}`;
      if (attrs.blockquote) text = `> ${text}`;
      if (attrs["code-block"]) text = "```\n" + text + "\n```";
      lines.push(text);
    }
    return lines.join("\n").trim();
  } catch {
    return JSON.stringify(content);
  }
}

// ── 数据库初始化 ──

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;

      // notes store
      if (!db.objectStoreNames.contains("notes")) {
        const store = db.createObjectStore("notes", { keyPath: "id" });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("deleted_at", "deleted_at", { unique: false });
        store.createIndex("tags", "tags", { unique: false }); // JSON array string
        store.createIndex("pinned_sort", ["pinned", "sort_order"], { unique: false });
      }

      // v2: 添加 storagePath 索引（用于文档分类树）
      if (db.objectStoreNames.contains("notes")) {
        const tx = req.transaction!;
        const store = tx.objectStore("notes");
        if (!store.indexNames.contains("storagePath")) {
          store.createIndex("storagePath", "storagePath", { unique: false });
        }
      }

      // daily_pages store
      if (!db.objectStoreNames.contains("daily_pages")) {
        db.createObjectStore("daily_pages", { keyPath: "date" });
      }

      // note_versions store
      if (!db.objectStoreNames.contains("note_versions")) {
        const store = db.createObjectStore("note_versions", { keyPath: "id" });
        store.createIndex("note_id", "note_id", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withDB<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDB();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

function getOne<T>(store: IDBObjectStore, key: IDBValidKey): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

function getAll<T>(store: IDBObjectStore, query?: IDBValidKey | IDBKeyRange, count?: number): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = store.getAll(query, count);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllFromIndex<T>(index: IDBIndex, range?: IDBValidKey | IDBKeyRange, count?: number): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = index.getAll(range, count);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function putRecord(store: IDBObjectStore, value: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function delRecord(store: IDBObjectStore, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Delta → Note DB shape ──

function noteToDB(n: Note): any {
  return {
    ...n,
    content: n.content, // stored as DeltaOps (object)
    tags: JSON.stringify(n.tags),
    concepts: n.concepts ? JSON.stringify(n.concepts) : undefined,
    linkedDocIds: n.linkedDocIds ? JSON.stringify(n.linkedDocIds) : undefined,
    pinned: n.pinned ? 1 : 0,
    readonly: n.readonly ? 1 : 0,
    search_text: extractPlainText(n.content),
  };
}

function noteFromDB(d: any): Note {
  return {
    ...d,
    tags: typeof d.tags === "string" ? JSON.parse(d.tags) : d.tags,
    concepts: typeof d.concepts === "string" ? JSON.parse(d.concepts) : d.concepts ?? undefined,
    linkedDocIds: typeof d.linkedDocIds === "string" ? JSON.parse(d.linkedDocIds) : d.linkedDocIds ?? undefined,
    pinned: d.pinned === 1 || d.pinned === true,
    readonly: d.readonly === 1 || d.readonly === true,
    content: typeof d.content === "string" ? JSON.parse(d.content) : d.content,
  };
}

// ── Version snapshot ──

async function saveVersionSnapshot(store: IDBObjectStore, note: Note): Promise<void> {
  const ver: NoteVersion = {
    id: uuid(),
    note_id: note.id,
    title: note.title ?? "",
    content: note.content,
    tags: note.tags,
    pinned: note.pinned,
    sort_order: (note as any).sort_order ?? 0,
    saved_at: now(),
  };
  await putRecord(store, ver);

  // Keep max 30 versions per note
  const allVersions = await getAllFromIndex<any>(store.index("note_id"), note.id);
  if (allVersions.length > 30) {
    allVersions.sort((a, b) => a.saved_at.localeCompare(b.saved_at));
    const excess = allVersions.slice(0, allVersions.length - 30);
    for (const v of excess) {
      await delRecord(store, v.id);
    }
  }
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
      } as any;

      // @ts-ignore for sort_order
      (note as any).sort_order = 0;

      await putRecord(noteStore, noteToDB(note));
      return note;
    });
  },

  async updateNote(id: string, data: UpdateNoteInput): Promise<Note> {
    return withDB(async (db) => {
      const tx = db.transaction(["notes", "note_versions"], "readwrite");
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

      await saveVersionSnapshot(tx.objectStore("note_versions"), noteFromDB(existing));
      await putRecord(noteStore, updated);
      return noteFromDB(updated);
    });
  },

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
        // Try carryover from yesterday
        const yesterday = new Date(new Date(date + "T00:00:00").getTime() - 86400000)
          .toISOString().slice(0, 10);
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

  // ══════ Sync (存桩) ══════

  async syncPush(): Promise<{ pushed: number }> {
    console.warn("[IDB] syncPush — 未对接后端");
    return { pushed: 0 };
  },

  async syncPull(): Promise<{ pulled: number }> {
    console.warn("[IDB] syncPull — 未对接后端");
    return { pulled: 0 };
  },

  // ══════ Export / Import ══════

  async exportData(): Promise<string> {
    return withDB(async (db) => {
      const tx = db.transaction(["notes", "daily_pages"], "readonly");
      const notes = await getAll<any>(tx.objectStore("notes"));
      const dailyPages = await getAll<any>(tx.objectStore("daily_pages"));
      return JSON.stringify({
        version: 1,
        exported_at: now(),
        notes: notes.filter((n) => !n.deleted_at).map(noteFromDB),
        daily_pages: dailyPages.map((p: any) => ({
          ...p,
          todos: typeof p.todos === "string" ? JSON.parse(p.todos) : p.todos,
          todo_carryover: p.todo_carryover === 1 || p.todo_carryover === true,
        })),
      }, null, 2);
    });
  },

  async importData(json: string): Promise<{ notes_imported: number; pages_imported: number }> {
    return withDB(async (db) => {
      const data = JSON.parse(json);
      const notes = data.notes ?? [];
      const pages = data.daily_pages ?? [];

      const tx = db.transaction(["notes", "daily_pages"], "readwrite");
      for (const n of notes) {
        await putRecord(tx.objectStore("notes"), noteToDB(n));
      }
      for (const p of pages) {
        await putRecord(tx.objectStore("daily_pages"), {
          ...p,
          todos: JSON.stringify(p.todos ?? []),
          todo_carryover: p.todo_carryover ? 1 : 0,
        });
      }
      return { notes_imported: notes.length, pages_imported: pages.length };
    });
  },

  async exportNoteMarkdown(noteId: string): Promise<string> {
    return withDB(async (db) => {
      const store = db.transaction("notes", "readonly").objectStore("notes");
      const note = await getOne<any>(store, noteId);
      if (!note) throw new Error(`Note ${noteId} not found`);
      const n = noteFromDB(note);
      const md = deltaToMarkdown(n.content);
      return `# ${n.title ?? "无标题"}\n\n${md}`;
    });
  },

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

  // ══════ Version History ══════

  async getNoteVersions(noteId: string): Promise<NoteVersion[]> {
    return withDB(async (db) => {
      const index = db.transaction("note_versions", "readonly").objectStore("note_versions").index("note_id");
      const all = await getAllFromIndex<any>(index, noteId);
      return all.sort((a, b) => b.saved_at.localeCompare(a.saved_at)).map((v) => ({
        ...v,
        content: typeof v.content === "string" ? JSON.parse(v.content) : v.content,
        tags: typeof v.tags === "string" ? JSON.parse(v.tags) : v.tags,
      }));
    });
  },

  async restoreNoteVersion(versionId: string): Promise<Note> {
    return withDB(async (db) => {
      const tx = db.transaction(["notes", "note_versions"], "readwrite");
      const verStore = tx.objectStore("note_versions");
      const version = await getOne<any>(verStore, versionId);
      if (!version) throw new Error(`Version ${versionId} not found`);

      const noteStore = tx.objectStore("notes");
      const existing = await getOne<any>(noteStore, version.note_id);
      if (!existing) throw new Error(`Note ${version.note_id} not found`);

      // Save current as version first
      await saveVersionSnapshot(verStore, noteFromDB(existing));

      // Restore
      const restored: any = {
        ...existing,
        title: version.title ?? existing.title,
        content: typeof version.content === "string" ? JSON.parse(version.content) : version.content,
        tags: typeof version.tags === "string" ? JSON.parse(version.tags) : version.tags,
        sort_order: version.sort_order ?? existing.sort_order,
        updated_at: now(),
        search_text: extractPlainText(
          typeof version.content === "string" ? JSON.parse(version.content) : version.content
        ),
      };
      await putRecord(noteStore, restored);
      return noteFromDB(restored);
    });
  },

  // ══════ Config (localStorage) ══════

  async getConfig(): Promise<AppConfig> {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  },

  async setConfig(partial: Partial<AppConfig>): Promise<AppConfig> {
    const current = await this.getConfig();
    const merged = { ...current, ...partial };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(merged));
    return merged;
  },

  // ══════ Doc Tree（v2 文档分类系统）══════

  /** 构建文档树: 遍历所有有 storagePath 的 Note，按路径前缀聚合 */
  async getPathTree(): Promise<PathNode[]> {
    return withDB(async (db) => {
      const store = db.transaction("notes", "readonly").objectStore("notes");
      const all = await getAll<any>(store);
      const docs = all
        .filter((n) => !n.deleted_at && n.storagePath)
        .map(noteFromDB);

      // 收集所有唯一路径前缀
      const folders = new Set<string>();
      const tree: PathNode[] = [];

      for (const d of docs) {
        const path = d.storagePath!;
        // 生成各级父路径
        const parts = path.split("/");
        for (let i = 1; i < parts.length; i++) {
          folders.add(parts.slice(0, i).join("/"));
        }
        // 文档节点
        tree.push({
          path,
          name: parts[parts.length - 1],
          type: 'document',
          noteId: d.id,
          docType: d.docType,
          updatedAt: d.updated_at,
        });
      }

      // 文件夹节点（按 count 汇总）
      const folderCounts = new Map<string, number>();
      for (const d of docs) {
        const p = d.storagePath!;
        const parts = p.split("/");
        for (let i = 1; i < parts.length; i++) {
          const prefix = parts.slice(0, i).join("/");
          folderCounts.set(prefix, (folderCounts.get(prefix) ?? 0) + 1);
        }
      }

      for (const f of folders) {
        tree.push({
          path: f,
          name: f.split("/").pop()!,
          type: 'folder',
          count: folderCounts.get(f) ?? 0,
        });
      }

      return tree;
    });
  },

  async getNotesByPath(pathPrefix: string): Promise<Note[]> {
    return withDB(async (db) => {
      const store = db.transaction("notes", "readonly").objectStore("notes");
      const all = await getAll<any>(store);
      return all
        .filter((n) => !n.deleted_at && n.storagePath && n.storagePath.startsWith(pathPrefix))
        .sort((a, b) => (a.storagePath ?? "").localeCompare(b.storagePath ?? ""))
        .map(noteFromDB);
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

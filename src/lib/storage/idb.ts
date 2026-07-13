/**
 * IndexedDBAdapter — 纯浏览器端存储，零依赖
 * 实现 StorageAdapter 全部接口，与 Tauri (SQLite) 后端语义对齐
 */

import type { Note, DailyPage, Todo, NoteVersion, CreateNoteInput, UpdateNoteInput, UpdateTodosInput, PathNode } from "../../types/models";
import type { StorageAdapter, AppConfig, DocSearchQuery } from "./types";
import { DEFAULT_CONFIG } from "./types";

const DB_NAME = "nine_rings";
const DB_VERSION = 3;

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

// ── 图片 Blob 存储 ──

/** 将图片 Blob 存入 IndexedDB，返回 `nr-image://<id>` 引用 */
export async function storeImage(blob: Blob): Promise<string> {
  const id = uuid();
  return withDB(async (db) => {
    const tx = db.transaction("images", "readwrite");
    const store = tx.objectStore("images");
    await new Promise<void>((resolve, reject) => {
      const req = store.put({ id, blob, stored_at: now() });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return `nr-image://${id}`;
  });
}

/** 从 IndexedDB 读取图片并创建 Object URL（调用方负责在适当时机 revoke） */
export async function getImageUrl(ref: string): Promise<string | null> {
  const id = ref.replace(/^nr-image:\/\//, "");
  return withDB(async (db) => {
    const tx = db.transaction("images", "readonly");
    const store = tx.objectStore("images");
    const record: any = await new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    if (!record) return null;
    return URL.createObjectURL(record.blob);
  });
}

/** 批量解析 Delta 中的 nr-image:// 引用为 base64（用于导出） */
export async function resolveImageRefs(delta: any): Promise<any> {
  if (!delta?.ops) return delta;
  return withDB(async (db) => {
    const ops = [...delta.ops];
    const tx = db.transaction("images", "readonly");
    const store = tx.objectStore("images");
    for (const op of ops) {
      if (typeof op.insert !== "object") continue;
      const img = (op.insert as any)?.resizableImage || (op.insert as any)?.image;
      if (!img?.src || typeof img.src !== "string" || !img.src.startsWith("nr-image://")) continue;
      const id = img.src.replace(/^nr-image:\/\//, "");
      const record: any = await new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
      if (record) {
        const base64 = await blobToBase64(record.blob);
        img.src = base64;
      }
    }
    return { ...delta, ops };
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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

/** 从纯文本中提取匹配片段（带 <mark> 高亮），上下文各约 40 字符 */
export function extractSnippet(text: string, query: string): string {
  if (!text || !query) return "";
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx === -1) return text.slice(0, 120);

  const contextBefore = 40;
  const contextAfter = 60;
  const start = Math.max(0, idx - contextBefore);
  const end = Math.min(text.length, idx + query.length + contextAfter);

  let snippet = text.slice(start, end);
  // 分界符
  if (start > 0) snippet = "\u2026" + snippet;
  if (end < text.length) snippet = snippet + "\u2026";

  // 高亮所有匹配（不区分大小写）
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  return snippet.replace(re, '<mark>$1</mark>');
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

let _dbOpenPromise: Promise<IDBDatabase> | null = null;
let _dbOpenError: Error | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_dbOpenError) return Promise.reject(_dbOpenError);
  if (_dbOpenPromise) return _dbOpenPromise;

  _dbOpenPromise = new Promise((resolve, reject) => {
    // 5 秒超时保护：Chrome 移动端 IndexedDB 偶发 hang
    const timeout = setTimeout(() => {
      _dbOpenError = new Error("IndexedDB open timeout");
      reject(_dbOpenError);
    }, 5000);

    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // ... stores
      if (!db.objectStoreNames.contains("notes")) {
        const store = db.createObjectStore("notes", { keyPath: "id" });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("deleted_at", "deleted_at", { unique: false });
        store.createIndex("tags", "tags", { unique: false });
        store.createIndex("pinned_sort", ["pinned", "sort_order"], { unique: false });
      }
      if (db.objectStoreNames.contains("notes")) {
        const tx = req.transaction!;
        const store = tx.objectStore("notes");
        if (!store.indexNames.contains("storagePath")) {
          store.createIndex("storagePath", "storagePath", { unique: false });
        }
      }
      if (!db.objectStoreNames.contains("daily_pages")) {
        db.createObjectStore("daily_pages", { keyPath: "date" });
      }
      if (!db.objectStoreNames.contains("note_versions")) {
        const store = db.createObjectStore("note_versions", { keyPath: "id" });
        store.createIndex("note_id", "note_id", { unique: false });
      }
      if (!db.objectStoreNames.contains("images")) {
        db.createObjectStore("images", { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      clearTimeout(timeout);
      resolve(req.result);
    };
    req.onerror = () => {
      clearTimeout(timeout);
      _dbOpenError = req.error || new Error("IndexedDB open failed");
      reject(_dbOpenError);
    };
    req.onblocked = () => {
      console.warn("[IDB] blocked — another connection is open");
    };
  });

  return _dbOpenPromise;
}

async function withDB<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDB();
  // SPA: 保持连接打开，不 close()，避免 Safari 报 "connection is closing"
  return fn(db);
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
      const tx = db.transaction(["notes", "daily_pages", "images"], "readonly");
      const notes = await getAll<any>(tx.objectStore("notes"));
      const dailyPages = await getAll<any>(tx.objectStore("daily_pages"));
      const imageStore = tx.objectStore("images");
      const images: Record<string, string> = {};

      // 收集所有 nr-image:// 引用并按需导出图片 blob 为 base64
      const noteRecords = notes.filter((n) => !n.deleted_at).map(noteFromDB);
      for (const note of noteRecords) {
        const ops = note.content?.ops ?? [];
        for (const op of ops) {
          if (typeof op.insert !== "object") continue;
          const img = (op.insert as any)?.resizableImage || (op.insert as any)?.image;
          if (!img?.src || typeof img.src !== "string" || !img.src.startsWith("nr-image://")) continue;
          const id = img.src.replace(/^nr-image:\/\//, "");
          if (images[id]) continue; // already resolved
          const record: any = await new Promise((resolve, reject) => {
            const req = imageStore.get(id);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => reject(req.error);
          });
          if (record?.blob) {
            images[id] = await blobToBase64(record.blob);
          }
        }
      }

      // 替换 delta 中的引用为 base64
      for (const note of noteRecords) {
        const ops = note.content?.ops ?? [];
        for (const op of ops) {
          if (typeof op.insert !== "object") continue;
          const img = (op.insert as any)?.resizableImage || (op.insert as any)?.image;
          if (!img?.src || !img.src.startsWith("nr-image://")) continue;
          const id = img.src.replace(/^nr-image:\/\//, "");
          if (images[id]) img.src = images[id];
        }
        note.content = { ...note.content, ops };
      }

      return JSON.stringify({
        version: 1,
        exported_at: now(),
        notes: noteRecords,
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
      const importedNotes: any[] = data.notes ?? [];
      const pages = data.daily_pages ?? [];

      // ── Step 1: 读取现有笔记，构建去重索引 ──
      const existingNotes: any[] = await new Promise((resolve, reject) => {
        const tx = db.transaction("notes", "readonly");
        const store = tx.objectStore("notes");
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const byStoragePath = new Map<string, any>();
      const byTitleDate = new Map<string, any>();
      for (const n of existingNotes) {
        if (n.deleted_at) continue;
        if (n.storagePath) byStoragePath.set(n.storagePath, n);
        if (n.title) {
          const key = `${n.title}\x00${n.date}`;
          // title+date 去重仅用于非文档笔记（无 storagePath），
          // 避免误匹配同标题的文档笔记
          if (!n.storagePath) byTitleDate.set(key, n);
        }
      }

      // ── Step 2: 去重导入 ──
      return new Promise<{ notes_imported: number; pages_imported: number }>((resolve, reject) => {
        const tx = db.transaction(["notes", "daily_pages"], "readwrite");

        tx.oncomplete = () => {
          resolve({ notes_imported: importedNotes.length, pages_imported: pages.length });
        };
        tx.onerror = () => { console.error("[importData] 事务失败:", tx.error); reject(tx.error); };
        tx.onabort = () => { console.error("[importData] 事务中止:", tx.error); reject(tx.error); };

        const noteStore = tx.objectStore("notes");
        const pageStore = tx.objectStore("daily_pages");

        let merged = 0;
        for (const imported of importedNotes) {
          try {
            let target = imported;

            // 去重策略: storagePath（文档笔记）> title+date（日记/随笔）
            if (imported.storagePath) {
              const existing = byStoragePath.get(imported.storagePath);
              if (existing) {
                target = { ...imported, id: existing.id };
                merged++;
              }
            } else if (imported.title) {
              const key = `${imported.title}\x00${imported.date}`;
              const existing = byTitleDate.get(key);
              if (existing) {
                target = { ...imported, id: existing.id };
                merged++;
              }
            }

            noteStore.put(noteToDB(target));
          } catch (e) {
            console.error(`[importData] noteToDB 失败:`, e);
            reject(e as Error);
            return;
          }
        }

        if (merged > 0) {
          console.log(`[importData] 去重合并 ${merged} 条，总计 ${importedNotes.length} notes + ${pages.length} pages`);
        }

        for (const p of pages) {
          pageStore.put({
            ...p,
            todos: JSON.stringify(p.todos ?? []),
            todo_carryover: p.todo_carryover ? 1 : 0,
          });
        }
      });
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

  /** 构建文档树: 遍历所有有 storagePath 的 Note，按路径前缀聚合。
   *  同时将每日随笔（无 storagePath）注入为 daily/YYYY-MM-DD/ 虚拟路径。 */
  async getPathTree(): Promise<PathNode[]> {
    return withDB(async (db) => {
      const store = db.transaction("notes", "readonly").objectStore("notes");
      const all = await getAll<any>(store);
      const notes = all.filter((n) => !n.deleted_at).map(noteFromDB);

      // ── 1. 文档类笔记（有 storagePath）──
      const docNotes = notes.filter((n) => n.storagePath);
      // 收集所有唯一路径前缀
      const folders = new Set<string>();
      const tree: PathNode[] = [];

      for (const d of docNotes) {
        const path = d.storagePath!;
        const parts = path.split("/");
        for (let i = 1; i <= parts.length; i++) {
          folders.add(parts.slice(0, i).join("/"));
        }
        tree.push({
          path: `${path}/${d.id}`,
          name: d.title || "无标题",
          type: 'document',
          noteId: d.id,
          docType: d.docType,
          updatedAt: d.updated_at,
          readonly: d.readonly ?? false,
        });
      }

      // 文件夹节点（按 count 汇总）
      const folderCounts = new Map<string, number>();
      for (const d of docNotes) {
        const p = d.storagePath!;
        const parts = p.split("/");
        for (let i = 1; i <= parts.length; i++) {
          const prefix = parts.slice(0, i).join("/");
          folderCounts.set(prefix, (folderCounts.get(prefix) ?? 0) + 1);
        }
      }

      // ── 2. 每日随笔 → 注入虚拟 daily/YYYY-MM-DD/ 路径 ──
      const dailyNotes = notes.filter((n) => !n.storagePath);
      if (dailyNotes.length > 0) {
        // 收集唯日期
        const dateSet = new Set<string>();
        for (const d of dailyNotes) {
          dateSet.add(d.date);
        }

        // daily/ 根文件夹
        folders.add("daily");
        folderCounts.set("daily", dateSet.size);

        for (const date of [...dateSet].sort().reverse()) {
          const datePath = `daily/${date}`;
          folders.add(datePath);

          // 该日期下的每日笔记
          const dateDocs = dailyNotes.filter((n) => n.date === date);
          folderCounts.set(datePath, dateDocs.length);

          for (const d of dateDocs) {
            tree.push({
              path: `${datePath}/${d.id}`,
              name: d.title || "无标题",
              type: 'document',
              noteId: d.id,
              docType: d.docType,
              updatedAt: d.updated_at,
              readonly: false,
            });
          }
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
        .filter((n) => n.storagePath && n.storagePath.startsWith(pathPrefix))
        .sort((a, b) => (a.storagePath ?? "").localeCompare(b.storagePath ?? ""));
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

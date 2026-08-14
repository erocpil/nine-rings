/**
 * IndexedDBAdapter — 纯浏览器端存储，零依赖
 * 实现 StorageAdapter 全部接口，与 Tauri (SQLite) 后端语义对齐
 */

import type { Note, DailyPage, Todo, NoteVersion, CreateNoteInput, UpdateNoteInput, UpdateTodosInput, PathNode } from "../../types/models";
import type { StorageAdapter, AppConfig, DocSearchQuery } from "./types";
import { DEFAULT_CONFIG } from "./types";
import {
  assertFolderRelocation,
  buildDocTree,
  extractPlainText,
  isPathUnder,
  normalizeStoragePath,
  uuid,
  now,
  blobToBase64,
  type FlatDocRecord,
  type FlatDailyRecord,
} from "./core";
import { snakeImportToCamel } from "./normalize";
import { localDateKey } from "../local-date";
import { IDB_DATABASE_VERSION, IDB_STORES } from "../../types/schema_gen";
export { extractSnippet } from "./idb-snippet";

const DB_NAME = "nine_rings";

// ── 工具函数 ──

const CONFIG_KEY = "nine_rings_config";

function today(): string {
  return localDateKey();
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

    const req = indexedDB.open(DB_NAME, IDB_DATABASE_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const tx = req.transaction!;
      for (const [storeName, definition] of Object.entries(IDB_STORES)) {
        const store = db.objectStoreNames.contains(storeName)
          ? tx.objectStore(storeName)
          : db.createObjectStore(storeName, { keyPath: definition.keyPath });
        for (const index of definition.indexes) {
          if (!store.indexNames.contains(index.name)) {
            store.createIndex(index.name, index.keyPath, { unique: false });
          }
        }
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

export async function withDB<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
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

function abortTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.onabort = () => resolve();
    tx.oncomplete = () => resolve();
    try {
      tx.abort();
    } catch {
      resolve();
    }
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
    sort_order: note.sort_order ?? 0,
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
      };

      await putRecord(noteStore, noteToDB(note));
      return note;
    });
  },

  async upsertNote(data: CreateNoteInput): Promise<Note> {
    return withDB(async (db) => {
      // ── 查找已存在的匹配笔记 ──
      let existingId: string | null = null;

      // 1. (storagePath, title) 联合匹配（文档笔记）
      if (data.storagePath && data.title) {
        const sp = data.storagePath;
        const tl = data.title;
        const existing = await new Promise<any | null>((resolve, reject) => {
          const tx = db.transaction("notes", "readonly");
          const store = tx.objectStore("notes");
          const index = store.index("storagePath");
          const req = index.getAll(sp);
          req.onsuccess = () => {
            const match = req.result.find(
              (n: any) => !n.deleted_at && n.title === tl,
            );
            resolve(match ?? null);
          };
          req.onerror = () => reject(req.error);
        });
        if (existing) existingId = existing.id;
      }

      // 2. title + date 匹配（日记/随笔，仅非文档笔记）
      if (!existingId && data.title) {
        const existing = await new Promise<any | null>((resolve, reject) => {
          const tx = db.transaction("notes", "readonly");
          const store = tx.objectStore("notes");
          const req = store.getAll();
          req.onsuccess = () => {
            const match = req.result.find(
              (n: any) =>
                !n.deleted_at &&
                !n.storagePath &&
                n.title === data.title &&
                n.date === data.date,
            );
            resolve(match ?? null);
          };
          req.onerror = () => reject(req.error);
        });
        if (existing) existingId = existing.id;
      }

      // ── 写事务 ──
      const tx = db.transaction(["notes", "note_versions"], "readwrite");
      const noteStore = tx.objectStore("notes");

      const id = existingId ?? uuid();
      const note: Note = {
        id,
        date: data.date ?? today(),
        title: data.title ?? null,
        content: data.content ?? { ops: [] },
        tags: data.tags ?? [],
        pinned: data.pinned ?? false,
        readonly: false,
        sort_order: 0,
        created_at: existingId
          ? (await getOne<any>(noteStore, id))?.created_at ?? now()
          : now(),
        updated_at: now(),
        storagePath: data.storagePath,
        docType: data.docType,
        concepts: data.concepts,
        linkedDocIds: data.linkedDocIds,
      } as any;

      (note as any).sort_order = 0;

      await putRecord(noteStore, noteToDB(note));

      if (existingId && data.content) {
        const verStore = tx.objectStore("note_versions");
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

  /** 为指定笔记创建版本 checkpoint — 保存当前内容为历史版本 */
  async createNoteCheckpoint(noteId: string): Promise<void> {
    return withDB(async (db) => {
      const tx = db.transaction(["notes", "note_versions"], "readwrite");
      const noteStore = tx.objectStore("notes");
      const verStore = tx.objectStore("note_versions");

      const existing = await getOne<any>(noteStore, noteId);
      if (!existing) throw new Error(`Note ${noteId} not found`);

      // 去重：如果内容与最新版本相同，不创建 checkpoint
      const allVersions = await getAll<any>(verStore);
      const noteVersions = allVersions
        .filter((v: any) => v.note_id === noteId)
        .sort((a: any, b: any) => (b.saved_at ?? "").localeCompare(a.saved_at ?? ""));
      if (noteVersions.length > 0) {
        const latest = noteVersions[0];
        const latestContent = typeof latest.content === "string"
          ? latest.content
          : JSON.stringify(latest.content);
        const currentContent = JSON.stringify(noteFromDB(existing).content);
        if (latestContent === currentContent) return; // 相同内容，跳过
      }

      await saveVersionSnapshot(verStore, noteFromDB(existing));
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
      const docCount = noteRecords.filter((n: any) => n.storagePath).length;
      const essayCount = noteRecords.filter((n: any) => !n.storagePath).length;
      console.log(`[exportData] 导出 ${noteRecords.length} 篇笔记 (文档 ${docCount} + 随笔 ${essayCount}), ${dailyPages.length} 每日页面`);

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

      const json = JSON.stringify({
        version: 1,
        exported_at: now(),
        notes: noteRecords,
        daily_pages: dailyPages.map((p: any) => ({
          ...p,
          todos: typeof p.todos === "string" ? JSON.parse(p.todos) : p.todos,
          todo_carryover: p.todo_carryover === 1 || p.todo_carryover === true,
        })),
      }, null, 2);

      // 日志延后到 JSON 序列化后打印
      console.log(`[exportData] 完成 — 大小 ${(json.length / 1024).toFixed(1)} KB`);
      if (docCount > 0) {
        console.log(`[exportData] 文档列表 (P.A.R.A.):`);
        for (const n of noteRecords) {
          if (!n.storagePath) continue;
          const dt = n.docType ? ` [${n.docType}]` : "";
          const concepts = n.concepts?.length ? `  🏷 ${n.concepts.join(", ")}` : "";
          console.log(`  ${n.storagePath}/${n.id.slice(0, 6)}  "${(n.title ?? "无标题").slice(0, 30)}"${dt}${concepts}`);
        }
      }
      return json;
    });
  },

  async importData(json: string): Promise<{ notes_imported: number; pages_imported: number }> {
    return withDB(async (db) => {
      const data = JSON.parse(json);
      const importedNotes: any[] = (data.notes ?? []).map(snakeImportToCamel);
      const pages = data.daily_pages ?? [];

      const importDocs = importedNotes.filter((n: any) => n.storagePath);
      const importEssays = importedNotes.filter((n: any) => !n.storagePath);
      console.log(`[importData] 解析: ${importedNotes.length} 笔记 (文档 ${importDocs.length} + 随笔 ${importEssays.length}), ${pages.length} 每日页面`);

      // ── Step 0: 字段名归一化（snake_case → camelCase），
      //    兼容 Rust serde 导出格式和 Web 导出格式 ──
      // （inline 在顶部，函数定义见文件末尾）

      // ── Step 1: 读取现有笔记，构建去重索引（按 id）──
      const existingNotes: any[] = await new Promise((resolve, reject) => {
        const tx = db.transaction("notes", "readonly");
        const store = tx.objectStore("notes");
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const existingIds = new Set<string>();
      for (const n of existingNotes) {
        if (n.deleted_at) continue;
        existingIds.add(n.id);
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
            let dedupKind = "";

            // 去重策略: 按 id 匹配（UUID 跨设备一致）
            if (existingIds.has(imported.id)) {
              target = { ...imported, id: imported.id };  // 保留原 id，content 覆盖
              merged++;
              dedupKind = ` [merge: id=${imported.id.slice(0, 8)}]`;
            }

            noteStore.put(noteToDB(target));

            // 逐条日志（仅文档笔记）: 显示 storagePath + docType + concepts
            if (imported.storagePath) {
              const dt = imported.docType ? ` [${imported.docType}]` : "";
              const cpts = imported.concepts?.length ? ` 🏷 ${imported.concepts.join(", ")}` : "";
              console.log(`[importData]   ${imported.storagePath}/${(imported.id ?? "?").slice(0, 6)}  "${(imported.title ?? "无标题").slice(0, 30)}"${dt}${cpts}${dedupKind}`);
            }
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
    if (!raw) {
      console.log("[getConfig] localStorage empty → using defaults");
      return { ...DEFAULT_CONFIG };
    }
    try {
      const parsed = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      console.log("[getConfig]", "highlight_active_line:", parsed.highlight_active_line, "editor_show_line_numbers:", parsed.editor_show_line_numbers);
      return parsed;
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  },

  async setConfig(partial: Partial<AppConfig>): Promise<AppConfig> {
    const current = await this.getConfig();
    const merged = { ...current, ...partial };
    console.log("[setConfig]", JSON.stringify(partial), "→", JSON.stringify({ highlight_active_line: merged.highlight_active_line, editor_show_line_numbers: merged.editor_show_line_numbers }));
    localStorage.setItem(CONFIG_KEY, JSON.stringify(merged));
    return merged;
  },

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

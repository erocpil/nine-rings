/**
 * tauri-driver.ts — Tauri/SQLite 端 Op 驱动。
 *
 * Phase 3 PR A：通过三个通用命令（db_query / db_exec / db_transaction）
 * 实现 5 个已验证操作。与旧的 10 个业务命令并存，通过 Rust 集成测试对拍验证。
 *
 * 树构建（buildDocTree）从 core.ts import，与 idb-driver.ts 共享同一段代码。
 *
 * 与 idb-driver.ts 的区别：
 * - idb-driver 直接操作 IndexedDB，内部有 Op→IDB 编译器
 * - tauri-driver 将 Op JSON 发送给 Rust 端，由 db/query.rs 编译为 SQL 执行
 * - 两边产出的 Op JSON 结构完全相同
 */

import type { Note, CreateNoteInput, PathNode, DocType, NoteVersion, DailyPage } from "../../types/models";
import type { SelectOp, InsertOp, UpdateOp } from "./ops";
import { buildDocTree, type FlatDocRecord, type FlatDailyRecord } from "./core";
import { snakeNoteToCamel, snakeVersionToCamel, snakeDailyPageToCamel } from "./normalize";

// ═══════════════════════════════════════════════════════════════════
// Tauri IPC
// ═══════════════════════════════════════════════════════════════════

// 延迟加载，避免非 Tauri 环境直接 import 时炸模块
let _invokeModule: { invoke: (cmd: string, args: Record<string, unknown>) => Promise<any> } | null = null;

async function getInvoke() {
  if (!_invokeModule) {
    _invokeModule = await import("@tauri-apps/api/core");
  }
  return _invokeModule.invoke;
}

// ═══════════════════════════════════════════════════════════════════
// 工具函数（与 idb-driver.ts 对齐）
// ═══════════════════════════════════════════════════════════════════

function now(): string {
  return new Date().toISOString();
}

function today(): string {
  return now().slice(0, 10);
}

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

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

// ═══════════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════════

async function dbQuery(op: SelectOp): Promise<Record<string, any>[]> {
  const invoke = await getInvoke();
  return invoke("db_query", { opJson: JSON.stringify(op) });
}

async function dbExec(op: InsertOp | UpdateOp): Promise<void> {
  const invoke = await getInvoke();
  await invoke("db_exec", { opJson: JSON.stringify(op) });
}

async function dbTransaction(ops: (InsertOp | UpdateOp)[]): Promise<void> {
  const invoke = await getInvoke();
  await invoke("db_transaction", { opsJson: JSON.stringify(ops) });
}

// ═══════════════════════════════════════════════════════════════════
// 已验证操作（Phase 3 补齐至 16 个）
// ═══════════════════════════════════════════════════════════════════

export const tauriDriver = {
  // ── getNotesByDate ──
  async getNotesByDate(date: string): Promise<Note[]> {
    const op: SelectOp = {
      type: "select",
      table: "notes",
      columns: [
        "id", "date", "title", "content", "search_text", "tags",
        "pinned", "sort_order", "created_at", "updated_at",
        "storage_path", "doc_type", "concepts", "linked_doc_ids", "readonly",
      ],
      where: [{ col: "date", op: "=", val: date }],
      orderBy: [
        { col: "pinned", desc: true },
        { col: "sort_order" },
        { col: "created_at" },
      ],
    };
    const rows = await dbQuery(op);
    return rows.map(snakeNoteToCamel);
  },

  // ── createNote ──
  async createNote(data: CreateNoteInput): Promise<Note> {
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

    // Op 使用 snake_case 列名，与 SQLite schema 对齐
    const op: InsertOp = {
      type: "insert",
      table: "notes",
      values: {
        id: note.id,
        date: note.date,
        title: note.title,
        content: JSON.stringify(note.content),
        search_text: extractPlainText(note.content),
        tags: JSON.stringify(note.tags),
        pinned: note.pinned ? 1 : 0,
        sort_order: note.sort_order,
        created_at: note.created_at,
        updated_at: note.updated_at,
        storage_path: note.storagePath ?? null,
        doc_type: note.docType ?? null,
        concepts: note.concepts ? JSON.stringify(note.concepts) : "[]",
        linked_doc_ids: note.linkedDocIds ? JSON.stringify(note.linkedDocIds) : "[]",
        readonly: note.readonly ? 1 : 0,
      },
    };
    await dbExec(op);
    return note;
  },

  // ── updateNote ──
  async updateNote(id: string, data: {
    title?: string | null;
    content?: any;
    tags?: string[];
    pinned?: boolean;
    readonly?: boolean;
    sort_order?: number;
    storagePath?: string;
    docType?: DocType;
    concepts?: string[];
    linkedDocIds?: string[];
  }): Promise<Note> {
    const set: Record<string, any> = {};
    if (data.title !== undefined) set.title = data.title;
    if (data.content !== undefined) {
      set.content = JSON.stringify(data.content);
      set.search_text = extractPlainText(data.content);
    }
    if (data.tags !== undefined) set.tags = JSON.stringify(data.tags);
    if (data.pinned !== undefined) set.pinned = data.pinned ? 1 : 0;
    if (data.readonly !== undefined) set.readonly = data.readonly ? 1 : 0;
    if (data.sort_order !== undefined) set.sort_order = data.sort_order;
    if (data.storagePath !== undefined) set.storage_path = data.storagePath;
    if (data.docType !== undefined) set.doc_type = data.docType;
    if (data.concepts !== undefined) set.concepts = data.concepts ? JSON.stringify(data.concepts) : "[]";
    if (data.linkedDocIds !== undefined) set.linked_doc_ids = data.linkedDocIds ? JSON.stringify(data.linkedDocIds) : "[]";
    set.updated_at = now();

    const op: UpdateOp = {
      type: "update",
      table: "notes",
      set,
      where: [
        { col: "id", op: "=", val: id },
        { col: "deleted_at", op: "IS", val: null },
      ],
    };
    await dbExec(op);

    // 读回更新后的记录
    const selectOp: SelectOp = {
      type: "select",
      table: "notes",
      columns: [
        "id", "date", "title", "content", "search_text", "tags",
        "pinned", "sort_order", "created_at", "updated_at",
        "storage_path", "doc_type", "concepts", "linked_doc_ids", "readonly",
      ],
      where: [{ col: "id", op: "=", val: id }],
      limit: 1,
    };
    const rows = await dbQuery(selectOp);
    if (rows.length === 0) throw new Error(`Note ${id} not found after update`);
    return snakeNoteToCamel(rows[0]);
  },

  // ── deleteNote（软删除）──
  async deleteNote(id: string): Promise<void> {
    const op: UpdateOp = {
      type: "update",
      table: "notes",
      set: {
        deleted_at: now(),
        updated_at: now(),
      },
      where: [{ col: "id", op: "=", val: id }],
    };
    await dbExec(op);
  },

  // ── getPathTree ──
  async getPathTree(): Promise<PathNode[]> {
    // Part A: 文档类笔记（storage_path IS NOT NULL）
    const docsOp: SelectOp = {
      type: "select",
      table: "notes",
      columns: ["id", "title", "storage_path", "doc_type", "updated_at", "readonly"],
      where: [{ col: "storage_path", op: "IS", val: null, not: true }],
      orderBy: [
        { col: "storage_path" },
        { col: "updated_at", desc: true },
      ],
    };
    const docRows = await dbQuery(docsOp);

    // Part B: 随笔/日记（storage_path IS NULL）
    const dailyOp: SelectOp = {
      type: "select",
      table: "notes",
      columns: ["id", "date", "title", "updated_at"],
      where: [{ col: "storage_path", op: "IS", val: null }],
      orderBy: [
        { col: "date", desc: true },
        { col: "updated_at", desc: true },
      ],
    };
    const dailyRows = await dbQuery(dailyOp);

    // 转换为树构建器的输入类型（snake_case，与 core.ts 对齐）
    const docs: FlatDocRecord[] = docRows.map((r) => ({
      id: r.id,
      title: r.title,
      storage_path: r.storage_path,   // SQL 列名就是 snake_case，直接对齐
      doc_type: r.doc_type,
      updated_at: r.updated_at,
      readonly: r.readonly === 1 || r.readonly === true,
    }));

    const dailies: FlatDailyRecord[] = dailyRows.map((r) => ({
      id: r.id,
      date: r.date,
      title: r.title,
      updated_at: r.updated_at,
    }));

    return buildDocTree(docs, dailies);
  },

  // ── getAllDailyNotes（全部随笔，不含文档视图中的文档）──
  async getAllDailyNotes(): Promise<Note[]> {
    const op: SelectOp = {
      type: "select",
      table: "notes",
      columns: [
        "id", "date", "title", "content", "search_text", "tags",
        "pinned", "sort_order", "created_at", "updated_at",
        "storage_path", "doc_type", "concepts", "linked_doc_ids", "readonly",
      ],
      where: [
        { col: "storage_path", op: "IS", val: null },
        { col: "deleted_at", op: "IS", val: null },
      ],
      orderBy: [
        { col: "date", desc: true },
        { col: "updated_at", desc: true },
      ],
    };
    const rows = await dbQuery(op);
    return rows.map(snakeNoteToCamel);
  },

  // ── upsertNote：INSERT OR REPLACE ──
  async upsertNote(data: CreateNoteInput): Promise<Note> {
    const d = data as any; // upsertNote 可能携带 id/created_at/updated_at（从导入路径传入）
    const note: Note = {
      id: d.id ?? uuid(),
      date: data.date ?? today(),
      title: data.title ?? null,
      content: data.content ?? { ops: [] },
      tags: data.tags ?? [],
      pinned: data.pinned ?? false,
      readonly: false,
      sort_order: 0,
      created_at: d.created_at ?? now(),
      updated_at: d.updated_at ?? now(),
      storagePath: data.storagePath,
      docType: data.docType,
      concepts: data.concepts,
      linkedDocIds: data.linkedDocIds,
    } as any;

    const op: InsertOp = {
      type: "insert",
      table: "notes",
      onConflict: "replace",
      values: {
        id: note.id,
        date: note.date,
        title: note.title,
        content: JSON.stringify(note.content),
        search_text: extractPlainText(note.content),
        tags: JSON.stringify(note.tags),
        pinned: note.pinned ? 1 : 0,
        sort_order: note.sort_order,
        created_at: note.created_at,
        updated_at: note.updated_at,
        storage_path: note.storagePath ?? null,
        doc_type: note.docType ?? null,
        concepts: note.concepts ? JSON.stringify(note.concepts) : "[]",
        linked_doc_ids: note.linkedDocIds ? JSON.stringify(note.linkedDocIds) : "[]",
        readonly: note.readonly ? 1 : 0,
      },
    };
    await dbExec(op);
    return note;
  },

  // ── getRecentDates：最近 N 个有笔记的日期 ──
  async getRecentDates(limit: number = 50): Promise<string[]> {
    const op: SelectOp = {
      type: "select",
      table: "notes",
      columns: ["date"],
      where: [{ col: "deleted_at", op: "IS", val: null }],
      orderBy: [{ col: "date", desc: true }],
    };
    const rows = await dbQuery(op);
    // 日期去重（同一日期可能有多条笔记）
    const seen = new Set<string>();
    const dates: string[] = [];
    for (const r of rows) {
      const d = r.date as string;
      if (seen.has(d)) continue;
      seen.add(d);
      dates.push(d);
      if (dates.length >= limit) break;
    }
    return dates;
  },

  // ── getAllDailyPages ──
  async getAllDailyPages(): Promise<DailyPage[]> {
    const op: SelectOp = {
      type: "select",
      table: "daily_pages",
      columns: ["date", "todos", "todo_carryover", "updated_at"],
      orderBy: [{ col: "date", desc: true }],
    };
    const rows = await dbQuery(op);
    return rows.map(snakeDailyPageToCamel);
  },

  // ── batchDelete：事务内批量软删除 ──
  async batchDelete(ids: string[]): Promise<void> {
    const ts = now();
    const ops: UpdateOp[] = ids.map((id) => ({
      type: "update" as const,
      table: "notes",
      set: { deleted_at: ts, updated_at: ts },
      where: [{ col: "id", op: "=" as const, val: id }],
    }));
    if (ops.length > 0) await dbTransaction(ops);
  },

  // ── batchSetReadonly：事务内批量设置只读 ──
  async batchSetReadonly(ids: string[], readonly: boolean): Promise<void> {
    const ops: UpdateOp[] = ids.map((id) => ({
      type: "update" as const,
      table: "notes",
      set: { readonly: readonly ? 1 : 0 },
      where: [{ col: "id", op: "=" as const, val: id }],
    }));
    if (ops.length > 0) await dbTransaction(ops);
  },

  // ── getNoteVersions ──
  async getNoteVersions(noteId: string): Promise<NoteVersion[]> {
    const op: SelectOp = {
      type: "select",
      table: "note_versions",
      columns: ["id", "note_id", "title", "content", "tags", "pinned", "sort_order", "saved_at"],
      where: [{ col: "note_id", op: "=", val: noteId }],
      orderBy: [{ col: "saved_at", desc: true }],
    };
    const rows = await dbQuery(op);
    return rows.map(snakeVersionToCamel);
  },

  // ── restoreNoteVersion：从版本恢复笔记内容 ──
  async restoreNoteVersion(versionId: string): Promise<Note> {
    // 1. 读取版本记录
    const verOp: SelectOp = {
      type: "select",
      table: "note_versions",
      columns: ["id", "note_id", "title", "content", "tags", "pinned", "sort_order", "saved_at"],
      where: [{ col: "id", op: "=", val: versionId }],
      limit: 1,
    };
    const verRows = await dbQuery(verOp);
    if (verRows.length === 0) throw new Error(`Version ${versionId} not found`);
    const ver = verRows[0];
    const content = typeof ver.content === "string" ? JSON.parse(ver.content) : ver.content;
    const tags = typeof ver.tags === "string" ? JSON.parse(ver.tags) : (ver.tags ?? []);

    // 2. 恢复笔记内容
    const upOp: UpdateOp = {
      type: "update",
      table: "notes",
      set: {
        title: ver.title,
        content: typeof ver.content === "string" ? ver.content : JSON.stringify(ver.content),
        search_text: extractPlainText(content),
        tags: JSON.stringify(tags),
        pinned: ver.pinned,
        sort_order: ver.sort_order,
        updated_at: now(),
      },
      where: [{ col: "id", op: "=", val: ver.note_id }],
    };
    await dbExec(upOp);

    // 3. 读回更新后的笔记
    return tauriDriver.getNotesByDate(await (async () => {
      const nop: SelectOp = {
        type: "select",
        table: "notes",
        columns: ["date"],
        where: [{ col: "id", op: "=", val: ver.note_id }],
        limit: 1,
      };
      const nr = await dbQuery(nop);
      return (nr[0]?.date as string) ?? today();
    })()).then((notes) => {
      const note = notes.find((n) => n.id === ver.note_id as string);
      if (!note) throw new Error(`Note ${ver.note_id} not found after restore`);
      return note;
    });
  },

  // ── createNoteCheckpoint：创建笔记版本快照 ──
  async createNoteCheckpoint(noteId: string): Promise<void> {
    const op: SelectOp = {
      type: "select",
      table: "notes",
      columns: ["id", "title", "content", "tags", "pinned", "sort_order"],
      where: [{ col: "id", op: "=", val: noteId }],
      limit: 1,
    };
    const rows = await dbQuery(op);
    if (rows.length === 0) return; // 笔记不存在，静默跳过
    const note = rows[0];

    // 去重：与最近一条版本内容相同则跳过
    const lastVerOp: SelectOp = {
      type: "select",
      table: "note_versions",
      columns: ["content", "title", "tags", "pinned", "sort_order"],
      where: [{ col: "note_id", op: "=", val: noteId }],
      orderBy: [{ col: "saved_at", desc: true }],
      limit: 1,
    };
    const lastRows = await dbQuery(lastVerOp);
    const curContent = typeof note.content === "string" ? note.content : JSON.stringify(note.content);
    const curTags = typeof note.tags === "string" ? note.tags : JSON.stringify(note.tags ?? []);
    if (lastRows.length > 0) {
      const last = lastRows[0];
      const lastContent = typeof last.content === "string" ? last.content : "";
      const lastTitle = last.title ?? null;
      const lastTags = typeof last.tags === "string" ? last.tags : "[]";
      const lastPinned = last.pinned === 1 || last.pinned === true || last.pinned === "1";
      const lastSort = last.sort_order ?? 0;
      const curTitle = note.title ?? null;
      const curPinned = note.pinned === 1 || note.pinned === true || note.pinned === "1";
      const curSort = note.sort_order ?? 0;
      if (
        lastContent === curContent &&
        lastTitle === curTitle &&
        lastTags === curTags &&
        lastPinned === curPinned &&
        lastSort === curSort
      ) {
        return; // 内容相同，跳过
      }
    }

    const insOp: InsertOp = {
      type: "insert",
      table: "note_versions",
      values: {
        id: uuid(),
        note_id: noteId,
        title: note.title,
        content: curContent,
        tags: curTags,
        pinned: note.pinned ?? 0,
        sort_order: note.sort_order ?? 0,
        saved_at: now(),
      },
    };
    await dbExec(insOp);
  },
};

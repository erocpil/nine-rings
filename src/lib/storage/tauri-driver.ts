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

import type { Note, CreateNoteInput, PathNode, DocType } from "../../types/models";
import type { SelectOp, InsertOp, UpdateOp } from "./ops";
import { buildDocTree, type FlatDocRecord, type FlatDailyRecord } from "./core";

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
// SQL 行 → Note 映射
// db_query 返回的 JSON 对象使用 SQL 列名（snake_case），
// 需要转换为 Note 的字段名和类型。
// ═══════════════════════════════════════════════════════════════════

function noteFromRow(row: Record<string, any>): Note {
  return {
    id: row.id,
    date: row.date,
    title: row.title ?? null,
    content: typeof row.content === "string" ? JSON.parse(row.content) : row.content,
    tags: typeof row.tags === "string" ? JSON.parse(row.tags) : (row.tags ?? []),
    pinned: row.pinned === 1 || row.pinned === true || row.pinned === "1",
    readonly: row.readonly === 1 || row.readonly === true || row.readonly === "1",
    sort_order: row.sort_order ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
    storagePath: row.storage_path ?? undefined,
    docType: row.doc_type ?? undefined,
    concepts: typeof row.concepts === "string" ? JSON.parse(row.concepts) : (row.concepts ?? undefined),
    linkedDocIds: typeof row.linked_doc_ids === "string" ? JSON.parse(row.linked_doc_ids) : (row.linked_doc_ids ?? undefined),
  };
}

// ═══════════════════════════════════════════════════════════════════
// IPC 封装
// ═══════════════════════════════════════════════════════════════════

async function dbQuery(op: SelectOp): Promise<Record<string, any>[]> {
  const invoke = await getInvoke();
  return invoke("db_query", { opJson: JSON.stringify(op) });
}

async function dbExec(op: InsertOp | UpdateOp): Promise<void> {
  const invoke = await getInvoke();
  await invoke("db_exec", { opJson: JSON.stringify(op) });
}

// ═══════════════════════════════════════════════════════════════════
// 5 个已验证操作
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
    return rows.map(noteFromRow);
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
    return noteFromRow(rows[0]);
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
};

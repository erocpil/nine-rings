/**
 * idb-driver.ts — IndexedDB Op 编译器。
 *
 * 将中间表示 Op（SelectOp / InsertOp / UpdateOp）翻译为 IndexedDB 游标操作。
 * 与 idb.ts 并行运行、共享同一个 IndexedDB 数据库（nine_rings, v3）。
 *
 * Phase 1：仅覆盖 5 个已验证操作（getNotesByDate, createNote, updateNote,
 *           deleteNote, getPathTree），其余操作保留在 idb.ts。
 *
 * 设计约定：
 * - 默认值（UUID、时间戳）在本文件操作包装器中生成，不留给 compiler。
 * - 软删除自动过滤：SelectOp.includeDeleted=false（默认）→ 过滤 deleted_at。
 * - UpdateOp 仅携带变更字段，IDB compiler 用 read-modify-write。
 * - 树构建（buildDocTree）是纯 JS 函数，不依赖 IndexedDB，
 *   输入类型按 Op 层的扁平记录类型定义，确保与未来 SQL 端对齐。
 */

import type { Note, CreateNoteInput, PathNode, DocType } from "../../types/models";
import type { Op, SelectOp, InsertOp, UpdateOp } from "./ops";
import { buildDocTree, type FlatDocRecord, type FlatDailyRecord } from "./core";

// ═══════════════════════════════════════════════════════════════════
// Op column name → IndexedDB field name 映射
// Op 层统一使用 snake_case（与 SQLite 对齐），IDB 存储为混合命名。
// ═══════════════════════════════════════════════════════════════════

const OP_TO_IDB: Record<string, string> = {
  storage_path: "storagePath",
  doc_type: "docType",
  linked_doc_ids: "linkedDocIds",
};

function idbField(col: string): string {
  return OP_TO_IDB[col] ?? col;
}

// ═══════════════════════════════════════════════════════════════════
// 工具函数（与 idb.ts 共享逻辑，不重复实现 DB open）
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

/** Note → IDB 存储格式（与 idb.ts noteToDB 一致） */
function noteToDB(n: Record<string, any>): Record<string, any> {
  const record: Record<string, any> = { ...n };
  if (n.tags !== undefined) record.tags = JSON.stringify(n.tags);
  if (n.concepts !== undefined) record.concepts = n.concepts ? JSON.stringify(n.concepts) : undefined;
  if (n.linkedDocIds !== undefined) record.linkedDocIds = n.linkedDocIds ? JSON.stringify(n.linkedDocIds) : undefined;
  if (n.pinned !== undefined) record.pinned = n.pinned ? 1 : 0;
  if (n.readonly !== undefined) record.readonly = n.readonly ? 1 : 0;
  if (n.content !== undefined) record.search_text = extractPlainText(n.content);
  return record;
}

/** IDB 存储格式 → Note（与 idb.ts noteFromDB 一致） */
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

// ═══════════════════════════════════════════════════════════════════
// Where 子句求值（IDB 端，JS 内存过滤）
// ═══════════════════════════════════════════════════════════════════

function matchWhere(record: Record<string, any>, col: string, op: string, val: any, not?: boolean): boolean {
  const field = idbField(col);
  const recordVal = record[field];

  // IS NULL / IS NOT NULL
  if (op === "IS" && val === null) {
    return not ? recordVal != null : recordVal == null;
  }
  // != NULL → IS NOT NULL
  if (op === "!=" && val === null) {
    return recordVal != null;
  }
  // = NULL → IS NULL
  if (op === "=" && val === null) {
    return recordVal == null;
  }

  // Normal comparison
  let result: boolean;
  switch (op) {
    case "=":  result = recordVal === val; break;
    case "!=": result = recordVal !== val; break;
    case "<":  result = recordVal < val; break;
    case ">":  result = recordVal > val; break;
    case "<=": result = recordVal <= val; break;
    case ">=": result = recordVal >= val; break;
    case "LIKE": {
      // LIKE in IDB: simple substring match (not full SQL LIKE)
      if (typeof recordVal !== "string" || typeof val !== "string") return false;
      result = recordVal.includes(val);
      break;
    }
    default: return false;
  }
  return not ? !result : result;
}

function checkAllWhere(record: Record<string, any>, where: SelectOp["where"]): boolean {
  if (!where || where.length === 0) return true;
  return where.every((w) => matchWhere(record, w.col, w.op, w.val, w.not));
}

// ═══════════════════════════════════════════════════════════════════
// Compiler — Op → IndexedDB
// ═══════════════════════════════════════════════════════════════════

/**
 * 执行 SelectOp。返回 IDB 原始记录（不经过 noteFromDB 转换）。
 *
 * 策略：
 * - 如果 where 里只有一个等值条件在索引列上（date），走索引。
 * - 否则 scan all + 内存过滤。
 * - 自动过滤 deleted_at（除非 includeDeleted=true）。
 */
async function compileSelect(db: IDBDatabase, op: SelectOp): Promise<Record<string, any>[]> {
  const tx = db.transaction(op.table, "readonly");
  const store = tx.objectStore(op.table);

  let records: Record<string, any>[];

  // ── 尝试走索引 ──
  const eqWhere = (op.where ?? []).filter(
    (w) => w.op === "=" && w.val !== null && w.val !== undefined && !w.not
  );
  const indexCols = new Set<string>(
    Array.from(store.indexNames).filter((name) => name !== "tags" && name !== "pinned_sort")
  );

  const indexMatch = eqWhere.find((w) => indexCols.has(w.col));
  if (indexMatch && (op.where ?? []).length === 1) {
    // 单条件等值索引查询
    const index = store.index(indexMatch.col);
    records = await new Promise<Record<string, any>[]>((resolve, reject) => {
      const req = index.getAll(indexMatch.val as IDBValidKey);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } else if (eqWhere.length === 1 && eqWhere[0].col === "id") {
    // 主键查询
    const record = await new Promise<Record<string, any> | undefined>((resolve, reject) => {
      const req = store.get(eqWhere[0].val as IDBValidKey);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    records = record ? [record] : [];
  } else {
    // Scan all
    records = await new Promise<Record<string, any>[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // ── 过滤 where 条件（除了已在索引查询中覆盖的）──
  const remainingWhere = indexMatch
    ? [] // 索引已覆盖唯一条件
    : (op.where ?? []);

  if (remainingWhere.length > 0) {
    records = records.filter((r) => checkAllWhere(r, remainingWhere));
  }

  // ── 自动过滤软删除 ──
  if (!op.includeDeleted) {
    records = records.filter((r) => r.deleted_at == null);
  }

  // ── 排序 ──
  if (op.orderBy && op.orderBy.length > 0) {
    records.sort((a, b) => {
      for (const o of op.orderBy!) {
        const field = idbField(o.col);
        const av = a[field];
        const bv = b[field];
        if (av === bv) continue;
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return o.desc ? -cmp : cmp;
      }
      return 0;
    });
  }

  // ── LIMIT / OFFSET ──
  if (op.offset) records = records.slice(op.offset);
  if (op.limit) records = records.slice(0, op.limit);

  return records;
}

/**
 * 执行 InsertOp。过滤 undefined 的列，映射 Op 列名 → IDB 字段名，
 * 写入 IDB。
 */
async function compileInsert(db: IDBDatabase, op: InsertOp): Promise<void> {
  const tx = db.transaction(op.table, "readwrite");
  const store = tx.objectStore(op.table);

  // 过滤 undefined，映射列名
  const record: Record<string, any> = {};
  for (const [col, val] of Object.entries(op.values)) {
    if (val === undefined) continue;
    record[idbField(col)] = val;
  }

  await new Promise<void>((resolve, reject) => {
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * 执行 UpdateOp。Read-modify-write：
 * 1. 从 where 提取主键
 * 2. get 现有记录
 * 3. merge set 字段（仅非 undefined）
 * 4. put 回 IDB
 */
async function compileUpdate(db: IDBDatabase, op: UpdateOp): Promise<void> {
  // 必须包含 id = val 条件（IDB 只能通过主键定位记录）
  const idWhere = op.where.find((w) => w.col === "id" && w.op === "=");
  if (!idWhere) {
    throw new Error("UpdateOp must have WHERE id = ? for IDB compiler");
  }

  const tx = db.transaction(op.table, "readwrite");
  const store = tx.objectStore(op.table);

  const existing = await new Promise<Record<string, any> | undefined>((resolve, reject) => {
    const req = store.get(idWhere.val as IDBValidKey);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (!existing) {
    throw new Error(`Record not found: ${idWhere.val}`);
  }

  // 验证所有 WHERE 条件（不只是 id=val）。
  // 这确保像 deleted_at IS NULL 这样的附加条件也被检查，
  // 而非被 silently ignored。
  if (!checkAllWhere(existing, op.where)) {
    throw new Error(
      `UpdateOp: record ${idWhere.val} does not satisfy all WHERE conditions. ` +
      `WHERE had ${op.where.length} clause(s); only id=val can be used for record lookup, ` +
      `but all conditions are verified before writing.`
    );
  }

  // merge: 仅设置 op.set 中的非 undefined 字段
  for (const [col, val] of Object.entries(op.set)) {
    if (val === undefined) continue;
    existing[idbField(col)] = val;
  }

  await new Promise<void>((resolve, reject) => {
    const req = store.put(existing);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Op 顶层分发（Phase 2/3 统一入口） */
export async function executeOp(db: IDBDatabase, op: Op): Promise<any> {
  switch (op.type) {
    case "select": return compileSelect(db, op);
    case "insert": return compileInsert(db, op);
    case "update": return compileUpdate(db, op);
    case "raw":
      throw new Error("RawOp not supported in IDB compiler");
  }
}

// ═══════════════════════════════════════════════════════════════════
// 5 个已验证操作
// ═══════════════════════════════════════════════════════════════════

/** 对 IDBDatabase 执行操作的上下文。外部（测试或生产环境）提供 open DB。 */
export interface DriverContext {
  db: IDBDatabase;
}

/** 5 个已验证操作的实现 */
export const idbDriver = {
  // ── getNotesByDate ──
  async getNotesByDate(ctx: DriverContext, date: string): Promise<Note[]> {
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
    const records = await compileSelect(ctx.db, op);
    return records.map(noteFromDB);
  },

  // ── createNote ──
  async createNote(ctx: DriverContext, data: CreateNoteInput): Promise<Note> {
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

    const dbRecord = noteToDB(note as any);

    const op: InsertOp = {
      type: "insert",
      table: "notes",
      values: {
        id: dbRecord.id,
        date: dbRecord.date,
        title: dbRecord.title,
        content: dbRecord.content,
        search_text: dbRecord.search_text,
        tags: dbRecord.tags,
        pinned: dbRecord.pinned,
        sort_order: dbRecord.sort_order,
        created_at: dbRecord.created_at,
        updated_at: dbRecord.updated_at,
        storage_path: dbRecord.storagePath,
        doc_type: dbRecord.docType,
        concepts: dbRecord.concepts,
        linked_doc_ids: dbRecord.linkedDocIds,
        readonly: dbRecord.readonly,
      },
    };
    await compileInsert(ctx.db, op);
    return note;
  },

  // ── updateNote ──
  async updateNote(
    ctx: DriverContext,
    id: string,
    data: {
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
    },
  ): Promise<Note> {
    // 提取变更字段，映射到 Op 列名
    const set: Record<string, any> = {};
    if (data.title !== undefined) set.title = data.title;
    if (data.content !== undefined) {
      set.content = data.content;
      set.search_text = extractPlainText(data.content);
    }
    if (data.tags !== undefined) set.tags = JSON.stringify(data.tags);
    if (data.pinned !== undefined) set.pinned = data.pinned ? 1 : 0;
    if (data.readonly !== undefined) set.readonly = data.readonly ? 1 : 0;
    if (data.sort_order !== undefined) set.sort_order = data.sort_order;
    if (data.storagePath !== undefined) set.storage_path = data.storagePath;
    if (data.docType !== undefined) set.doc_type = data.docType;
    if (data.concepts !== undefined) set.concepts = data.concepts ? JSON.stringify(data.concepts) : undefined;
    if (data.linkedDocIds !== undefined) set.linked_doc_ids = data.linkedDocIds ? JSON.stringify(data.linkedDocIds) : undefined;
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
    await compileUpdate(ctx.db, op);

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
    const records = await compileSelect(ctx.db, selectOp);
    if (records.length === 0) throw new Error(`Note ${id} not found after update`);
    return noteFromDB(records[0]);
  },

  // ── deleteNote（软删除）──
  async deleteNote(ctx: DriverContext, id: string): Promise<void> {
    const op: UpdateOp = {
      type: "update",
      table: "notes",
      set: {
        deleted_at: now(),
        updated_at: now(),
      },
      where: [{ col: "id", op: "=", val: id }],
    };
    await compileUpdate(ctx.db, op);
  },

  // ── getPathTree ──
  async getPathTree(ctx: DriverContext): Promise<PathNode[]> {
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
    const docRecords = await compileSelect(ctx.db, docsOp);

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
    const dailyRecords = await compileSelect(ctx.db, dailyOp);

    // 转换为树构建器的输入类型
    const docs: FlatDocRecord[] = docRecords.map((r) => ({
      id: r.id,
      title: r.title,
      storage_path: r.storagePath,   // IDB 字段 → Op 字段
      doc_type: r.docType,
      updated_at: r.updated_at,
      readonly: r.readonly === 1 || r.readonly === true,
    }));

    const dailies: FlatDailyRecord[] = dailyRecords.map((r) => ({
      id: r.id,
      date: r.date,
      title: r.title,
      updated_at: r.updated_at,
    }));

    return buildDocTree(docs, dailies);
  },
};

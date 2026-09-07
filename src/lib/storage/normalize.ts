/**
 * normalize.ts — 字段名规范化：snake_case (DB/Op) ↔ camelCase (TS 应用层)。
 *
 * 设计原则：
 * - 数据库层（SQLite 列名、Op JSON）：snake_case
 * - TS 应用类型（Note、DailyPage 等）：camelCase
 * - 本模块提供双向转换，消除各文件中的 ad-hoc as any 桥接
 *
 * 用法：
 *   import { snakeNoteToCamel, snakeImportToCamel } from "./normalize";
 *   const note: Note = snakeNoteToCamel(sqlRow);
 *   const normalized = snakeImportToCamel(importRaw);
 */

import type { Note, NoteVersion, DailyPage, DocType } from "../../types/models";

// ═══════════════════════════════════════════════════════════════════
// 原始 snake_case 行类型（SQLite / IndexedDB 查询返回）
// ═══════════════════════════════════════════════════════════════════

/** SQLite/IDB 查询返回的 snake_case 原始行 */
export interface SnakeNoteRow {
  id: string;
  date: string;
  title: string | null;
  content: string;  // SQLite 中为 JSON 字符串
  search_text?: string;
  tags: string;     // SQLite 中为 JSON 字符串
  pinned: number | boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  storage_path?: string | null;
  doc_type?: string | null;
  concepts?: string;
  linked_doc_ids?: string;
  readonly?: number | boolean;
}

export interface SnakeVersionRow {
  id: string;
  note_id: string;
  title: string | null;
  content: string;
  tags: string;
  pinned: number | boolean;
  sort_order: number;
  saved_at: string;
}

export interface SnakeDailyPageRow {
  date: string;
  todos: string;
  todo_carryover: number | boolean;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════════
// 核心规范化函数
// ═══════════════════════════════════════════════════════════════════

function parseBool(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (v === "1" || v === "true") return true;
  return false;
}

export function normalizeDocType(value: unknown): DocType | undefined {
  return value === "explanation" || value === "how-to" || value === "reference" || value === "tutorial"
    ? value : undefined;
}

function parseJson<T>(v: string | T | undefined): T {
  if (v === undefined) return ([]) as T;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return ([]) as T; }
  }
  return v;
}

/** snake_case SQL/IDB 行 → camelCase TS Note */
export function snakeNoteToCamel(row: SnakeNoteRow): Note {
  const note: Note = {
    id: row.id,
    date: row.date,
    title: row.title ?? null,
    content: typeof row.content === "string" ? JSON.parse(row.content) : row.content,
    tags: parseJson<string[]>(row.tags),
    pinned: parseBool(row.pinned),
    readonly: parseBool(row.readonly),
    sort_order: row.sort_order ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
    storagePath: row.storage_path ?? undefined,
    docType: normalizeDocType(row.doc_type),
  };
  // 仅当 key 存在时设置可选字段（缺失 → undefined 而非空数组）
  if ("concepts" in row) note.concepts = parseJson<string[]>(row.concepts);
  if ("linked_doc_ids" in row) note.linkedDocIds = parseJson<string[]>(row.linked_doc_ids);
  return note;
}

/** snake_case SQL/IDB 行 → NoteVersion */
export function snakeVersionToCamel(row: SnakeVersionRow): NoteVersion {
  return {
    id: row.id,
    note_id: row.note_id,
    title: row.title ?? null,
    content: typeof row.content === "string" ? JSON.parse(row.content) : row.content,
    tags: parseJson<string[]>(row.tags),
    pinned: parseBool(row.pinned),
    sort_order: row.sort_order ?? 0,
    saved_at: row.saved_at,
  };
}

/** snake_case SQL/IDB 行 → DailyPage */
export function snakeDailyPageToCamel(row: SnakeDailyPageRow): DailyPage {
  return {
    date: row.date,
    todos: parseJson<DailyPage["todos"]>(row.todos),
    todo_carryover: parseBool(row.todo_carryover),
    updated_at: row.updated_at,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 导入 JSON 规范化（兼容 Rust serde snake_case 和 Web camelCase 导出）
// ═══════════════════════════════════════════════════════════════════

/**
 * 将 snake_case / camelCase 混合的导入 JSON 归一化为 camelCase。
 *
 * 兼容两端导出格式：
 * - Rust serde (tauri): storage_path, doc_type, linked_doc_ids
 * - Web IDB:           storagePath, docType, linkedDocIds
 *
 * 策略：优先保留 camelCase；若仅存在 snake_case 则转换为 camelCase。
 */
export function snakeImportToCamel(raw: Record<string, unknown>): Record<string, unknown> {
  const n = { ...raw };
  if (typeof n.content === "string") n.content = JSON.parse(n.content);
  for (const key of ["tags", "concepts", "linked_doc_ids", "linkedDocIds"]) {
    if (typeof n[key] === "string") n[key] = JSON.parse(n[key]);
  }
  for (const key of ["pinned", "readonly"]) {
    if (n[key] !== undefined) n[key] = parseBool(n[key]);
  }

  // storage_path / storagePath
  if (n.storage_path !== undefined) {
    if (n.storagePath === undefined) n.storagePath = n.storage_path;
    delete n.storage_path;
  }

  // doc_type / docType
  if (n.doc_type !== undefined) {
    if (n.docType === undefined) n.docType = n.doc_type;
    delete n.doc_type;
  }

  // linked_doc_ids / linkedDocIds
  if (n.linked_doc_ids !== undefined) {
    if (n.linkedDocIds === undefined) n.linkedDocIds = n.linked_doc_ids;
    delete n.linked_doc_ids;
  }

  // concepts / Concepts: 两边同名，无需转换

  return n;
}

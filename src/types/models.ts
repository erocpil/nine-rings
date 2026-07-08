// ──── 数据模型 (与 schema/note.yaml 保持同步) ────

export interface Note {
  id: string;            // UUID v4
  date: string;          // ISO 8601 date "2026-07-08"
  title: string | null;  // 随心记标题
  content: DeltaOps;     // Delta JSON
  created_at: string;    // ISO 8601 datetime
  updated_at: string;
}

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  order: number;
}

export interface DailyPage {
  date: string;               // PK, 唯一
  todos: Todo[];
  todo_carryover: boolean;    // 是否跨日继承未完成项
  updated_at: string;
}

export interface SyncChange {
  id: string;
  entity_type: "daily_page" | "note";
  entity_id: string;
  action: "create" | "update" | "delete";
  data: unknown;
  timestamp: string;
  synced_at: string | null;
}

// TipTap / Quill Delta 格式
export interface DeltaOps {
  ops: DeltaOp[];
}

export interface DeltaOp {
  insert: string | Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

// Tauri IPC 命令参数
export interface CreateNoteInput {
  date: string;
  title?: string;
  content?: DeltaOps;
}

export interface UpdateNoteInput {
  id: string;
  title?: string | null;
  content?: DeltaOps;
}

export interface UpdateTodosInput {
  date: string;
  todos: Todo[];
  todo_carryover?: boolean;
}

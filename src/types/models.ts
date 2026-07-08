// ──── 数据模型（与 schema/note.yaml 保持一致）────

export interface Note {
  id: string;
  date: string;
  title: string | null;
  content: DeltaOps;
  tags: string[];
  pinned: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  order: number;
  tags: string[];
}

export interface DailyPage {
  date: string;
  todos: Todo[];
  todo_carryover: boolean;
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

export interface DeltaOps {
  ops: DeltaOp[];
}

export interface DeltaOp {
  insert: string | Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

// ──── Tauri IPC 参数 ────

export interface CreateNoteInput {
  date: string;
  title?: string;
  content?: DeltaOps;
  tags?: string[];
  pinned?: boolean;
}

export interface UpdateNoteInput {
  id: string;
  title?: string | null;
  content?: DeltaOps;
  tags?: string[];
  pinned?: boolean;
  sort_order?: number;
}

export interface UpdateTodosInput {
  date: string;
  todos: Todo[];
  todo_carryover?: boolean;
}

export interface NoteVersion {
  id: string;
  note_id: string;
  title: string | null;
  content: DeltaOps;
  tags: string[];
  pinned: boolean;
  sort_order: number;
  saved_at: string;
}

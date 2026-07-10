// ──── 数据模型（与 schema/note.yaml 保持一致）────

export interface Note {
  id: string;
  date: string;
  title: string | null;
  content: DeltaOps;
  tags: string[];
  pinned: boolean;
  readonly: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
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
  readonly?: boolean;
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

// ──── 应用的端配置 ────

/** 应用配置（与 schema/config.yaml 对齐） */
export interface AppConfig {
  theme: "system" | "light" | "dark" | "grace" | "sui" | "zhi";
  default_view: "daily" | "list";
  todo_carryover_default: boolean;
  auto_clean_days: number;
  note_font_size: number;
  enable_sync: boolean;
  dev_port: number;
  highlight_active_line: boolean;
  editor_show_line_numbers: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  theme: "system",
  default_view: "daily",
  todo_carryover_default: false,
  auto_clean_days: 30,
  note_font_size: 16,
  enable_sync: false,
  dev_port: 1420,
  highlight_active_line: true,
  editor_show_line_numbers: false,
};

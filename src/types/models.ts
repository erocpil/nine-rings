// ──── 数据模型（与 schema/note.yaml 保持一致）────

export type DocType = 'explanation' | 'how-to' | 'reference' | 'tutorial';

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

  // ── 文档分类系统（v2，可选字段，非日记文档使用）──
  // 生命周期维度: 目录即分类
  storagePath?: string;       // e.g. "projects/nine-rings", "areas/dpdk", "references", "ideas"
  // Diátaxis 维度: 写作意图
  docType?: DocType;
  // Zettelkasten 维度: 概念标签
  concepts?: string[];
  // 关联文档 ID
  linkedDocIds?: string[];
}

// ── PathNode: 文档树节点 ──

export interface PathNode {
  path: string;         // 完整路径, e.g. "projects/nine-rings"
  name: string;         // 叶子名, e.g. "nine-rings"
  type: 'folder' | 'document';
  noteId?: string;      // document 时对应 Note.id
  docType?: DocType;    // document 时
  updatedAt?: string;   // document 时
  count?: number;       // folder 时，子文档数
  readonly?: boolean;   // document 时
}

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  order: number;
  tags: string[];
  remind_at?: string;  // ISO datetime string for Notification API reminder
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
  storagePath?: string;
  docType?: DocType;
  concepts?: string[];
  linkedDocIds?: string[];
}

export interface UpdateNoteInput {
  id: string;
  title?: string | null;
  content?: DeltaOps;
  tags?: string[];
  pinned?: boolean;
  readonly?: boolean;
  sort_order?: number;
  storagePath?: string;
  docType?: DocType;
  concepts?: string[];
  linkedDocIds?: string[];
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
  theme: "system" | "light" | "dark" | "fu" | "azure" | "azure-dark" | "grace" | "sui" | "zhi";
  default_view: "daily" | "list";
  todo_carryover_default: boolean;
  auto_clean_days: number;
  note_font_size: number;
  enable_sync: boolean;
  dev_port: number;
  highlight_active_line: boolean;
  editor_show_line_numbers: boolean;
  hotkeys: Record<string, string>;
}

export const DEFAULT_HOTKEYS: Record<string, string> = {
  new_note:       "CommandOrControl+N",
  quick_capture:  "CommandOrControl+Alt+N",
  focus_search:   "CommandOrControl+E",
  open_settings:  "Alt+,",
  go_to_daily:    "CommandOrControl+Shift+D",
  show_window:    "Alt+Y",
};

export const HOTKEY_LABELS: Record<string, string> = {
  new_note:       "新建随笔",
  quick_capture:  "快捷记录",
  focus_search:   "聚焦搜索",
  open_settings:  "打开设置",
  go_to_daily:    "打开每日列表",
  show_window:    "显示主窗口",
};

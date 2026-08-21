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

/** One-shot request to reveal a full-text-search occurrence in the editor. */
export interface SearchNavigationTarget {
  noteId: string;
  query: string;
  requestId: number;
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
  parent_id?: string | null;  // parent todo id, null = top-level
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
  title?: string | null;
  content?: DeltaOps;
  date?: string;
  tags?: string[];
  pinned?: boolean;
  readonly?: boolean;
  sort_order?: number;
  storagePath?: string;
  docType?: DocType;
  concepts?: string[];
  linkedDocIds?: string[];
}

/** Editable Note fields accepted by every storage backend. */
export type NotePatch = UpdateNoteInput;

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
  editor_font_family: "system" | "sans" | "serif" | "monospace";
  editor_line_height: number;
  editor_block_spacing: number;
  editor_paragraph_indent: number;
  editor_heading_margin_top: number;
  editor_heading_margin_bottom: number;
  editor_list_margin_top: number;
  editor_list_margin_bottom: number;
  editor_list_indent: number;
  editor_list_marker_gap: number;
  editor_blockquote_indent: number;
  editor_search_highlight_color: string;
  editor_cjk_spacing: boolean;
  dev_port: number;
  highlight_active_line: boolean;
  editor_show_line_numbers: boolean;
  editor_show_status_block_number: boolean;
  editor_show_status_bar: boolean;
  editor_vim_mode: boolean;
  use_custom_context_menu: boolean;
  hotkeys: Record<string, string>;
}

export const DEFAULT_HOTKEYS: Record<string, string> = {
  new_note:       "",
  quick_capture:  "CommandOrControl+Alt+N",
  focus_search:   "Alt+E",
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

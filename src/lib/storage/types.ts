import type { Note, DailyPage, NoteVersion, CreateNoteInput, UpdateNoteInput, UpdateTodosInput, PathNode, DocType } from "../../types/models";

// ── 配置类型（与 schema/config.yaml 对齐）──

export interface AppConfig {
  theme: "system" | "light" | "dark" | "fu" | "azure" | "azure-dark" | "grace" | "sui" | "zhi";
  default_view: "daily" | "list";
  todo_carryover_default: boolean;
  auto_clean_days: number;
  note_font_size: number;
  enable_sync: boolean;
  dev_port: number; // 仅 web 模式生效
  highlight_active_line: boolean;
  editor_show_line_numbers: boolean;
  hotkeys: Record<string, string>;
}

export const DEFAULT_CONFIG: AppConfig = {
  theme: "light",
  default_view: "daily",
  todo_carryover_default: false,
  auto_clean_days: 30,
  note_font_size: 16,
  enable_sync: false,
  dev_port: 1420,
  highlight_active_line: true,
  editor_show_line_numbers: false,
  hotkeys: {
    new_note:      "CommandOrControl+N",
    quick_capture: "CommandOrControl+Alt+N",
    focus_search:  "CommandOrControl+E",
    open_settings: "CommandOrControl+,",
  },
};

/** StorageAdapter — 抽象存储后端 */
export interface StorageAdapter {
  // ── Notes ──
  getNotesByDate(date: string): Promise<Note[]>;
  getNote(id: string): Promise<Note | null>;
  createNote(data: CreateNoteInput): Promise<Note>;
  /** upsertNote: 若存在同 storagePath 或同 title+date 的笔记则更新，否则新建。
   *  用于 .md 导入等批量场景，防止重复。保持本地 ID 不变。 */
  upsertNote(data: CreateNoteInput): Promise<Note>;
  updateNote(id: string, data: UpdateNoteInput): Promise<Note>;
  updateNoteOrder(id: string, sort_order: number): Promise<Note>;
  deleteNote(id: string): Promise<void>;
  searchNotes(query: string): Promise<Note[]>;
  getNotesByTag(tag: string): Promise<Note[]>;
  getRecentDates(): Promise<string[]>;

  // ── Tags ──
  getAllTags(): Promise<string[]>;

  // ── Daily Page ──
  getDailyPage(date: string): Promise<DailyPage>;
  updateTodos(data: UpdateTodosInput): Promise<DailyPage>;
  getAllDailyPages(): Promise<DailyPage[]>;

  // ── Sync (存桩) ──
  syncPush(): Promise<{ pushed: number }>;
  syncPull(): Promise<{ pulled: number }>;

  // ── Export / Import ──
  exportData(): Promise<string>;
  importData(json: string): Promise<{ notes_imported: number; pages_imported: number }>;
  exportNoteMarkdown(noteId: string): Promise<string>;

  // ── Trash ──
  getDeletedNotes(): Promise<Note[]>;
  restoreNote(id: string): Promise<void>;
  permanentlyDeleteNote(id: string): Promise<void>;
  cleanOldDeleted(olderThanDays: number): Promise<number>;

  // ── Batch ──
  batchDelete(ids: string[]): Promise<void>;
  batchSetReadonly(ids: string[], readonly: boolean): Promise<void>;

  // ── Version History ──
  getNoteVersions(noteId: string): Promise<NoteVersion[]>;
  restoreNoteVersion(versionId: string): Promise<Note>;

  // ── Config ──
  getConfig(): Promise<AppConfig>;
  setConfig(partial: Partial<AppConfig>): Promise<AppConfig>;

  // ── Doc Tree（v2 文档分类系统）──
  getPathTree(): Promise<PathNode[]>;
  getNotesByPath(pathPrefix: string): Promise<Note[]>;
  searchDocs(query: DocSearchQuery): Promise<Note[]>;
  getAllConcepts(): Promise<string[]>;
}

// ── Doc Search Query ──

export interface DocSearchQuery {
  text?: string;
  storagePath?: string;
  docType?: DocType;
  concept?: string;
  staleBefore?: string;   // ISO datetime: 更新早于该时间的
}

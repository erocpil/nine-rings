import type { Note, DailyPage, NoteVersion, CreateNoteInput, UpdateNoteInput, UpdateTodosInput } from "../../types/models";

// ── 配置类型（与 schema/config.yaml 对齐）──

export interface AppConfig {
  theme: "system" | "light" | "dark";
  default_view: "daily" | "list";
  todo_carryover_default: boolean;
  auto_clean_days: number;
  note_font_size: number;
  enable_sync: boolean;
  dev_port: number; // 仅 web 模式生效
}

export const DEFAULT_CONFIG: AppConfig = {
  theme: "system",
  default_view: "daily",
  todo_carryover_default: false,
  auto_clean_days: 30,
  note_font_size: 16,
  enable_sync: false,
  dev_port: 1420,
};

/** StorageAdapter — 抽象存储后端 */
export interface StorageAdapter {
  // ── Notes ──
  getNotesByDate(date: string): Promise<Note[]>;
  createNote(data: CreateNoteInput): Promise<Note>;
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

  // ── Version History ──
  getNoteVersions(noteId: string): Promise<NoteVersion[]>;
  restoreNoteVersion(versionId: string): Promise<Note>;

  // ── Config ──
  getConfig(): Promise<AppConfig>;
  setConfig(partial: Partial<AppConfig>): Promise<AppConfig>;
}

import type { Note, DailyPage, Todo, NoteVersion, CreateNoteInput, UpdateNoteInput, UpdateTodosInput } from "../../types/models";

/** StorageAdapter — 抽象存储后端，Tauri (SQLite) 和 Web (IndexedDB) 各有一个实现 */
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

  // ── Sync (存桩，web 版后续对接后端) ──
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
}

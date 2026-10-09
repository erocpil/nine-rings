import type { Note, NoteVersion, CreateNoteInput, UpdateNoteInput, PathNode, DocType } from "../../types/models";
import type { TemplateStorage } from "./template-service";

// ── 配置类型（与 schema/config.yaml 对齐）──

export interface AppConfig {
  hierarchy_path_mode: "off" | "default" | "custom";
  hierarchy_path_custom_colors: string[];
  hierarchy_outline_mode: "off" | "default" | "custom";
  hierarchy_outline_custom_colors: string[];
  interface_style: "classic" | "calm" | "calm-compact" | "paper" | "minimal" | "nine-rings" | "mono-aware" | "yugen" | "wabi-sabi";
  workspace_layout: "standard" | "exhibition";
  exhibition_text_width: "narrow" | "standard" | "wide";
  exhibition_density: "comfortable" | "compact";
  interface_color_mode: "light" | "dark" | "system";
  interface_font_family: "system" | "sans" | "serif" | "monospace";
  interface_font_size: number;
  interface_line_height: number;
  interface_block_spacing_px: number;
  interface_heading_margin_top_px: number;
  interface_heading_margin_bottom_px: number;
  interface_content_width: number;
  theme: "system" | "light" | "dark" | "fu" | "azure" | "azure-dark" | "grace" | "sui" | "zhi" | "nord" | "dracula";
  auto_clean_days: number;
  note_font_size: number;
  editor_font_family: "system" | "sans" | "serif" | "monospace";
  editor_line_height: number;
  editor_block_spacing: number;
  editor_block_number_gap: number;
  editor_h1_font_size: number;
  editor_h2_font_size: number;
  editor_h3_font_size: number;
  editor_h4_font_size: number;
  editor_h5_font_size: number;
  editor_h6_font_size: number;
  editor_code_font_family: "default" | "system" | "sans" | "serif" | "monospace";
  editor_quote_font_family: "default" | "system" | "sans" | "serif" | "monospace";
  editor_mermaid_font_family: "default" | "system" | "sans" | "serif" | "monospace";
  editor_flow_font_family: "default" | "system" | "sans" | "serif" | "monospace";
  editor_code_font_size: number;
  editor_quote_font_size: number;
  editor_mermaid_font_size: number;
  editor_flow_font_size: number;

  editor_paragraph_indent: number;
  editor_heading_margin_top: number;
  editor_heading_margin_bottom: number;
  editor_list_margin_top: number;
  editor_list_margin_bottom: number;
  editor_list_indent: number;
  editor_list_marker_gap: number;
  editor_blockquote_indent: number;
  editor_search_highlight_color: string;
  navigation_font_size: number;
  navigation_text_color: string;
  navigation_background_color: string;
  navigation_outline_font_size: number;
  navigation_outline_text_color: string;
  navigation_outline_background_color: string;
  navigation_bookmark_font_size: number;
  navigation_bookmark_text_color: string;
  navigation_bookmark_background_color: string;
  navigation_tree_font_size: number;
  navigation_tree_text_color: string;
  navigation_tree_background_color: string;
  navigation_list_font_size: number;
  navigation_list_text_color: string;
  navigation_list_background_color: string;
  editor_cjk_spacing: boolean;
  dev_port: number; // 仅 web 模式生效
  highlight_active_line: boolean;
  editor_show_line_numbers: boolean;
  editor_fold_icon_style: "chevron" | "triangle" | "custom";
  editor_fold_icon_collapsed: string;
  editor_fold_icon_expanded: string;
  editor_outline_fold_icon_style: "triangle" | "chevron" | "inherit" | null;
  editor_show_status_block_number: boolean;
  editor_show_status_bar: boolean;
  editor_readonly_heading_fold: boolean;
  /** Vim keybindings in the standalone code block editor only. */
  editor_vim_mode: boolean;
  editor_code_wrap_default: boolean;
  use_custom_context_menu: boolean;
  user_name: string;
  user_organization: string;
  user_email: string;
  user_website: string;
  user_copyright: string;
  user_default_language: string;
  user_default_license: string;
  hotkeys: Record<string, string>;
}

export const DEFAULT_CONFIG: AppConfig = {
  hierarchy_path_mode: "default",
  hierarchy_path_custom_colors: ["#247F7B", "#9A5B00", "#5266A8", "#5E7C36", "#8356A1", "#B0473C"],
  hierarchy_outline_mode: "default",
  hierarchy_outline_custom_colors: ["#247F7B", "#9A5B00", "#5266A8", "#5E7C36", "#8356A1", "#B0473C"],
  interface_style: "classic",
  workspace_layout: "standard",
  exhibition_text_width: "wide",
  exhibition_density: "comfortable",
  interface_color_mode: "light",
  interface_font_family: "system",
  interface_font_size: 16,
  interface_line_height: 1.8,
  interface_block_spacing_px: 16,
  interface_heading_margin_top_px: 28,
  interface_heading_margin_bottom_px: 12,
  interface_content_width: 0,
  theme: "light",
  auto_clean_days: 30,
  note_font_size: 16,
  editor_font_family: "system",
  editor_line_height: 1.6,
  editor_block_spacing: 1,
  editor_block_number_gap: 8,
  editor_h1_font_size: 0,
  editor_h2_font_size: 0,
  editor_h3_font_size: 0,
  editor_h4_font_size: 0,
  editor_h5_font_size: 0,
  editor_h6_font_size: 0,
  editor_code_font_family: "default",
  editor_quote_font_family: "default",
  editor_mermaid_font_family: "default",
  editor_flow_font_family: "default",
  editor_code_font_size: 0,
  editor_quote_font_size: 0,
  editor_mermaid_font_size: 0,
  editor_flow_font_size: 0,

  editor_paragraph_indent: 0,
  editor_heading_margin_top: 0.7,
  editor_heading_margin_bottom: 0.35,
  editor_list_margin_top: 0.25,
  editor_list_margin_bottom: 0.25,
  editor_list_indent: 1,
  editor_list_marker_gap: 0.35,
  editor_blockquote_indent: 8,
  editor_search_highlight_color: "#ffd54f",
  navigation_font_size: 14,
  navigation_text_color: "#333333",
  navigation_background_color: "#f5f1e8",
  navigation_outline_font_size: 14,
  navigation_outline_text_color: "#333333",
  navigation_outline_background_color: "#f5f1e8",
  navigation_bookmark_font_size: 14,
  navigation_bookmark_text_color: "#333333",
  navigation_bookmark_background_color: "#f5f1e8",
  navigation_tree_font_size: 14,
  navigation_tree_text_color: "#333333",
  navigation_tree_background_color: "#f5f1e8",
  navigation_list_font_size: 14,
  navigation_list_text_color: "#333333",
  navigation_list_background_color: "#f5f1e8",
  editor_cjk_spacing: true,
  dev_port: 8000,
  highlight_active_line: true,
  editor_show_line_numbers: false,
  editor_fold_icon_style: "chevron",
  editor_fold_icon_collapsed: "▶",
  editor_fold_icon_expanded: "▼",
  editor_outline_fold_icon_style: null,
  editor_show_status_block_number: true,
  editor_show_status_bar: true,
  editor_readonly_heading_fold: true,
  editor_vim_mode: false,
  editor_code_wrap_default: true,
  use_custom_context_menu: true,
  user_name: "",
  user_organization: "",
  user_email: "",
  user_website: "",
  user_copyright: "",
  user_default_language: "zh-CN",
  user_default_license: "",
  hotkeys: {
    focus_search:  "Alt+E",
    open_settings: "Alt+,",
  },
};

/** StorageAdapter — 抽象存储后端 */
export interface StorageAdapter extends TemplateStorage {
  // ── Notes ──
  getNotesByDate(date: string): Promise<Note[]>;
  getNote(id: string): Promise<Note | null>;
  getAllNotes(): Promise<Note[]>;
  createNote(data: CreateNoteInput): Promise<Note>;
  /** upsertNote: 文档按 storagePath+title 匹配，存在则更新，否则新建。
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

  // ── Export / Import ──
  exportData(): Promise<string>;
  importData(
    json: string,
    mode?: "merge" | "replace",
  ): Promise<{ notes_imported: number; configs_imported?: number }>;
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
  /** 为指定笔记创建版本 checkpoint（保存当前内容为历史版本） */
  createNoteCheckpoint(noteId: string): Promise<void>;

  // ── Config ──
  getConfig(): Promise<AppConfig>;
  setConfig(partial: Partial<AppConfig>): Promise<AppConfig>;

  // ── Doc Tree（v2 文档分类系统）──
  getPathTree(): Promise<PathNode[]>;
  getNotesByPath(pathPrefix: string): Promise<Note[]>;
  /** 重命名文件夹：将 oldPath 下所有文档的 storagePath 前缀替换为 newPath */
  renameFolder(oldPath: string, newPath: string): Promise<number>;
  /** 移动单篇文档到目标目录，不改变更新时间或版本历史 */
  moveDocument(noteId: string, targetFolderPath: string): Promise<number>;
  /** 在单个事务中移动多篇文档到同一目录，不改变更新时间或版本历史 */
  batchMoveDocuments(noteIds: string[], targetFolderPath: string): Promise<void>;
  /** 原子移动目录及其全部后代，不改变更新时间或版本历史 */
  relocateFolder(sourcePath: string, targetPath: string): Promise<number>;
  searchDocs(query: DocSearchQuery): Promise<Note[]>;
  getAllConcepts(): Promise<string[]>;
}

// ── Doc Search Query ──

export interface DocSearchQuery {
  text?: string;
  options?: import("../search-matching").SearchOptions;
  storagePath?: string;
  docType?: DocType;
  concept?: string;
  staleBefore?: string;   // ISO datetime: 更新早于该时间的
}

import type { AppConfig } from "../../types/models";
import type { BrowserSettingsStore } from "../../lib/local-files/browser-workspace-contract";
import { DEFAULT_EDITOR_FOLD_ICONS } from "../../lib/editor-fold-icons";

export const EDITOR_SETTINGS_KEY = "source-editor";
export type WorkbenchEditorSettings = Pick<AppConfig, "editor_show_line_numbers" | "editor_fold_icon_style" | "editor_fold_icon_collapsed" | "editor_fold_icon_expanded">;

function normalize(value: Partial<WorkbenchEditorSettings>): WorkbenchEditorSettings {
  const symbol = (text: unknown, fallback: string) => typeof text === "string" && text.trim() && [...text].length <= 8 ? text : fallback;
  return {
    editor_show_line_numbers: typeof value.editor_show_line_numbers === "boolean" ? value.editor_show_line_numbers : true,
    editor_fold_icon_style: ["chevron", "triangle", "custom"].includes(value.editor_fold_icon_style ?? "") ? value.editor_fold_icon_style! : "chevron",
    editor_fold_icon_collapsed: symbol(value.editor_fold_icon_collapsed, DEFAULT_EDITOR_FOLD_ICONS.editor_fold_icon_collapsed),
    editor_fold_icon_expanded: symbol(value.editor_fold_icon_expanded, DEFAULT_EDITOR_FOLD_ICONS.editor_fold_icon_expanded),
  };
}
export function readWorkbenchEditorSettings(store: BrowserSettingsStore): WorkbenchEditorSettings {
  try { return normalize(JSON.parse(store.getItem(EDITOR_SETTINGS_KEY) ?? "{}") ?? {}); }
  catch { return normalize({}); }
}
/** Persist first: a failed write must not report success or change the live view. */
export function saveWorkbenchEditorSettings(store: BrowserSettingsStore, current: WorkbenchEditorSettings, patch: Partial<AppConfig>): WorkbenchEditorSettings {
  const next = normalize({ ...current, ...patch });
  store.setItem(EDITOR_SETTINGS_KEY, JSON.stringify(next));
  return next;
}

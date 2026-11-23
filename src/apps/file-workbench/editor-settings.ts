import { DOCUMENT_LANGUAGE_OPTIONS, AUTO_DOCUMENT_LANGUAGE } from "../../lib/document-language";
import type { AppConfig } from "../../types/models";
import type { BrowserSettingsStore } from "../../lib/local-files/browser-workspace-contract";
import { DEFAULT_EDITOR_FOLD_ICONS } from "../../lib/editor-fold-icons";

export const EDITOR_SETTINGS_KEY = "source-editor";
export const EDITOR_SETTINGS_EVENT = "file-workbench:editor-settings";
export const WORKBENCH_TAB_WIDTH = { default: 8, min: 6, max: 32 } as const;
type TabWidthSetting = { tab_width_chars: number; shrink_short_tabs: boolean };
export type WorkbenchEditorSettings = Pick<AppConfig, "editor_show_line_numbers" | "highlight_active_line" | "editor_show_status_bar" | "editor_show_status_block_number" | "use_custom_context_menu" | "editor_fold_icon_overrides" | "editor_fold_icon_style" | "editor_fold_icon_collapsed" | "editor_fold_icon_expanded"> & TabWidthSetting;

function normalize(value: Partial<WorkbenchEditorSettings>): WorkbenchEditorSettings {
  const symbol = (text: unknown, fallback: string) => typeof text === "string" && text.trim() && [...text].length <= 8 ? text : fallback;
  const overrides: WorkbenchEditorSettings["editor_fold_icon_overrides"] = {};
  for (const scope of ["heading", "block", "outline"]) {
    const override = value.editor_fold_icon_overrides?.[scope];
    if (override && ["inherit", "triangle", "chevron", "custom"].includes(override.style)) {
      overrides[scope] = {
        style: override.style,
        collapsed: symbol(override.collapsed, DEFAULT_EDITOR_FOLD_ICONS.editor_fold_icon_collapsed),
        expanded: symbol(override.expanded, DEFAULT_EDITOR_FOLD_ICONS.editor_fold_icon_expanded),
      };
    }
  }
  return {
    shrink_short_tabs: value.shrink_short_tabs === true,
    tab_width_chars: typeof value.tab_width_chars === "number" && Number.isInteger(value.tab_width_chars) &&
      value.tab_width_chars >= WORKBENCH_TAB_WIDTH.min && value.tab_width_chars <= WORKBENCH_TAB_WIDTH.max
      ? value.tab_width_chars : WORKBENCH_TAB_WIDTH.default,
    highlight_active_line: value.highlight_active_line !== false,
    editor_show_status_bar: value.editor_show_status_bar !== false,
    editor_show_status_block_number: value.editor_show_status_block_number !== false,
    use_custom_context_menu: value.use_custom_context_menu !== false,
    editor_fold_icon_overrides: overrides,
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
export function saveWorkbenchEditorSettings(store: BrowserSettingsStore, current: WorkbenchEditorSettings, patch: Partial<AppConfig & TabWidthSetting>): WorkbenchEditorSettings {
  const next = normalize({ ...current, ...patch });
  store.setItem(EDITOR_SETTINGS_KEY, JSON.stringify(next));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EDITOR_SETTINGS_EVENT));
  return next;
}

/** Presentation override only; never rename the file or change its bytes. */
export function readWorkbenchFileLanguage(store: BrowserSettingsStore, identity: string): string | null {
  try { const value = store.getItem(`language:${identity}`); return DOCUMENT_LANGUAGE_OPTIONS.some(option => option.value === value) ? value : null; }
  catch { return null; }
}
export function saveWorkbenchFileLanguage(store: BrowserSettingsStore, identity: string, value: string) {
  if (value !== AUTO_DOCUMENT_LANGUAGE && !DOCUMENT_LANGUAGE_OPTIONS.some(option => option.value === value)) throw new Error("不支持的文件格式");
  store.setItem(`language:${identity}`, value);
}

export interface WorkbenchFileView { readonly?: boolean; rendered?: boolean }
export function readWorkbenchFileView(store: BrowserSettingsStore, identity: string): WorkbenchFileView {
  try {
    const value = JSON.parse(store.getItem(`view:${identity}`) ?? "{}");
    return { ...(typeof value?.readonly === "boolean" ? { readonly: value.readonly } : {}), ...(typeof value?.rendered === "boolean" ? { rendered: value.rendered } : {}) };
  } catch { return {}; }
}
export function saveWorkbenchFileView(store: BrowserSettingsStore, identity: string, patch: WorkbenchFileView) {
  store.setItem(`view:${identity}`, JSON.stringify({ ...readWorkbenchFileView(store, identity), ...patch }));
}

import { commitBlockDisplaySettings } from "../../lib/block-display-settings";
import type { BlockDisplayDraft } from "../../lib/save-editor-appearance";
import type { AppConfig } from "../../types/models";
import { useMemo, useSyncExternalStore } from "react";
import type { BrowserSettingsStore } from "../../lib/local-files/browser-workspace-contract";
import { BLOCK_TYPOGRAPHY_KEYS, DEFAULT_BLOCK_TYPOGRAPHY, DEFAULT_EDITOR_APPEARANCE, blockFontFamily, customFontSize, editorAppearanceVariables } from "../../lib/editor-appearance";

export const TYPOGRAPHY_KEY = "editor-typography";
const changedEvent = "file-workbench:typography";
// Navigation panels have their own settings. Keep this storage record editor-only.
const { navigation_font_size: _navigationFontSize, navigation_text_color: _navigationTextColor,
  navigation_background_color: _navigationBackgroundColor, ...editorDefaults } = DEFAULT_EDITOR_APPEARANCE;
export const DEFAULT_TYPOGRAPHY = {
  ...editorDefaults,
  ...DEFAULT_BLOCK_TYPOGRAPHY,
  note_font_size: 18,
  editor_cjk_spacing: false,
  editor_block_number_gap: 8,
  source_font_family: "monospace",
} satisfies Partial<AppConfig> & { source_font_family: AppConfig["editor_font_family"] };

export type WorkbenchTypography = Pick<AppConfig, Exclude<keyof typeof DEFAULT_TYPOGRAPHY, "source_font_family">> & {
  source_font_family: AppConfig["editor_font_family"];
};

const limits = {
  note_font_size: [12, 32],
  editor_line_height: [1.2, 2.2],
  editor_block_spacing: [0, 3],
  editor_paragraph_indent: [0, 2],
  editor_heading_margin_top: [0, 2],
  editor_heading_margin_bottom: [0, 1.5],
  editor_list_margin_top: [0, 2],
  editor_list_margin_bottom: [0, 1.5],
  editor_list_indent: [1, 3],
  editor_list_marker_gap: [0.1, 0.8],
  editor_blockquote_indent: [4, 32],
  editor_block_number_gap: [4, 32],
  editor_source_gutter_divider_width: [0, 4],
  editor_source_gutter_divider_left_space: [0, 24],
  editor_source_gutter_divider_right_space: [0, 24],
} as const;

export function parseWorkbenchTypography(raw: string | null): WorkbenchTypography {
  let value: Partial<WorkbenchTypography> = {};
  try { const parsed = JSON.parse(raw ?? "{}"); if (parsed && typeof parsed === "object") value = parsed; } catch { /* Use independent defaults. */ }
  const font = (saved: unknown, fallback: AppConfig["editor_font_family"]) =>
    blockFontFamily(saved) ? saved as AppConfig["editor_font_family"] : fallback;
  const color = value.editor_search_highlight_color;
  const next: WorkbenchTypography = {
    ...DEFAULT_TYPOGRAPHY,
    editor_font_family: font(value.editor_font_family, "system"),
    source_font_family: font(value.source_font_family, "monospace"),
    editor_search_highlight_color: typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_TYPOGRAPHY.editor_search_highlight_color,
    editor_cjk_spacing: typeof value.editor_cjk_spacing === "boolean" ? value.editor_cjk_spacing : DEFAULT_TYPOGRAPHY.editor_cjk_spacing,
  };
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    const saved = value[key];
    if (typeof saved === "number" && Number.isFinite(saved)) {
      const [min, max] = limits[key];
      next[key] = Math.min(max, Math.max(min, saved));
    }
  }
  for (const key of BLOCK_TYPOGRAPHY_KEYS) {
    if (key.endsWith("_size")) {
      next[key as Extract<typeof key, `${string}_size`>] = typeof value[key] === "number" ? customFontSize(value[key]) ?? 0 : 0;
    } else {
      const saved = value[key];
      next[key as Extract<typeof key, `${string}_family`>] = blockFontFamily(saved) ? saved as AppConfig["editor_font_family"] : "default";
    }
  }
  return next;
}

export function saveWorkbenchTypography(store: BrowserSettingsStore, value: WorkbenchTypography, display?: BlockDisplayDraft) {
  const next = JSON.stringify(parseWorkbenchTypography(JSON.stringify(value)));
  const previous = display ? store.getItem(TYPOGRAPHY_KEY) : null;
  store.setItem(TYPOGRAPHY_KEY, next);
  try {
    if (display) commitBlockDisplaySettings(display.preferences, display.height);
  } catch (error) {
    try { store.setItem(TYPOGRAPHY_KEY, previous ?? JSON.stringify(DEFAULT_TYPOGRAPHY)); }
    catch { throw new Error("显示设置保存失败，排版设置也未能回滚，请重新打开设置核对。"); }
    throw error;
  }
  window.dispatchEvent(new Event(changedEvent));
}

function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(changedEvent, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(changedEvent, notify); };
}
export function useWorkbenchTypography(store: BrowserSettingsStore) {
  const raw = useSyncExternalStore(subscribe, () => { try { return store.getItem(TYPOGRAPHY_KEY); } catch { return null; } });
  return useMemo(() => parseWorkbenchTypography(raw), [raw]);
}
export function workbenchTypographyVariables(value: WorkbenchTypography) {
  return {
    ...editorAppearanceVariables(value),
    // The shared non-Classic reading rules use pixel gaps; keep both paths in sync.
    "--style-block-gap": `${value.note_font_size * value.editor_block_spacing}px`,
  };
}

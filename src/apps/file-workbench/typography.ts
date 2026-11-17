import { useMemo, useSyncExternalStore } from "react";
import type { BrowserSettingsStore } from "../../lib/local-files/browser-workspace-contract";
import { blockFontFamily, editorAppearanceVariables } from "../../lib/editor-appearance";

export const TYPOGRAPHY_KEY = "editor-typography";
const changedEvent = "file-workbench:typography";
export const DEFAULT_TYPOGRAPHY = {
  note_font_size: 18,
  editor_font_family: "system",
  source_font_family: "monospace",
  editor_line_height: 1.7,
  editor_block_spacing: 1,
} as const;
export type WorkbenchTypography = {
  note_font_size: number;
  editor_font_family: "system" | "sans" | "serif" | "monospace";
  source_font_family: "system" | "sans" | "serif" | "monospace";
  editor_line_height: number;
  editor_block_spacing: number;
};
const bounded = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
export function parseWorkbenchTypography(raw: string | null): WorkbenchTypography {
  let value: Partial<WorkbenchTypography> = {};
  try { const parsed = JSON.parse(raw ?? "{}"); if (parsed && typeof parsed === "object") value = parsed; } catch { /* Use independent defaults. */ }
  const font = (value: unknown, fallback: WorkbenchTypography["editor_font_family"]) =>
    typeof value === "string" && blockFontFamily(value) ? value as WorkbenchTypography["editor_font_family"] : fallback;
  return {
    note_font_size: bounded(value.note_font_size, 12, 32, 18),
    editor_font_family: font(value.editor_font_family, "system"),
    source_font_family: font(value.source_font_family, "monospace"),
    editor_line_height: bounded(value.editor_line_height, 1.2, 2.2, 1.7),
    editor_block_spacing: bounded(value.editor_block_spacing, 0, 3, 1),
  };
}
export function saveWorkbenchTypography(store: BrowserSettingsStore, value: WorkbenchTypography) {
  const next = parseWorkbenchTypography(JSON.stringify(value));
  store.setItem(TYPOGRAPHY_KEY, JSON.stringify(next));
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

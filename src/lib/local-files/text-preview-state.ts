import type { BrowserSettingsStore } from "./browser-workspace-contract";
import { markdownContentFingerprint } from "../external-markdown-source";
import {
  DEFAULT_EDITOR_FOLD_ICONS,
  type EditorFoldIconConfig,
} from "../editor-fold-icons";

export const TEXT_READER_STATE_KEY = "nr:file-browser-text-reading";
export const TEXT_READER_OPTIONS_KEY = "nr:file-browser-text-options";
export interface TextReaderBookmark {
  id: string;
  position: number;
  label: string;
  preview: string;
}
export interface TextReaderPosition {
  offset: number;
  left: number;
  from: number;
  to: number;
  folds: Array<{ from: number; to: number }>;
  bookmarks: TextReaderBookmark[];
}
export interface TextReaderOptions extends EditorFoldIconConfig {
  fontSize: number;
  editor_show_line_numbers: boolean;
}
const integer = (value: unknown, limit: number): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= limit;
export function normalizeTextReaderPosition(
  value: unknown,
  length: number,
): TextReaderPosition {
  const item = (
    value && typeof value === "object" ? value : {}
  ) as Partial<TextReaderPosition>;
  const point = (value: unknown) => (integer(value, length) ? value : 0);
  return {
    offset: point(item.offset),
    left:
      typeof item.left === "number" && Number.isFinite(item.left)
        ? Math.max(0, Math.min(100000, item.left))
        : 0,
    from: point(item.from),
    to: point(item.to),
    folds: Array.isArray(item.folds)
      ? item.folds
          .slice(0, 128)
          .filter(
            (range) =>
              range &&
              integer(range.from, length) &&
              integer(range.to, length) &&
              range.from < range.to,
          )
          .map(({ from, to }) => ({ from, to }))
      : [],
    bookmarks: Array.isArray(item.bookmarks)
      ? item.bookmarks
          .slice(0, 100)
          .filter(
            (mark) =>
              mark &&
              typeof mark.id === "string" &&
              mark.id.length <= 128 &&
              integer(mark.position, length) &&
              typeof mark.label === "string" &&
              typeof mark.preview === "string",
          )
          .map((mark) => ({
            id: mark.id,
            position: mark.position,
            label: mark.label.slice(0, 120),
            preview: mark.preview.slice(0, 120),
          }))
      : [],
  };
}
function readRecords(
  store: BrowserSettingsStore,
): Array<{ identity: string; fingerprint: string; position: unknown }> {
  const raw = store.getItem(TEXT_READER_STATE_KEY);
  if (!raw || raw.length > 512 * 1024) return [];
  try {
    const items = JSON.parse(raw);
    return Array.isArray(items)
      ? items
          .slice(0, 16)
          .filter(
            (item) =>
              item &&
              typeof item.identity === "string" &&
              item.identity.length <= 8192 &&
              typeof item.fingerprint === "string" &&
              item.fingerprint.length <= 128,
          )
      : [];
  } catch {
    return [];
  }
}
export function readTextReaderPosition(
  store: BrowserSettingsStore,
  identity: string,
  source: string,
) {
  try {
    const item = readRecords(store).find(
      (item) =>
        item.identity === identity &&
        item.fingerprint === markdownContentFingerprint(source),
    );
    return normalizeTextReaderPosition(item?.position, source.length);
  } catch {
    return normalizeTextReaderPosition(null, source.length);
  }
}
export function saveTextReaderPosition(
  store: BrowserSettingsStore,
  identity: string,
  source: string,
  position: TextReaderPosition,
) {
  const record = {
    identity,
    fingerprint: markdownContentFingerprint(source),
    position: normalizeTextReaderPosition(position, source.length),
  };
  const items = [
    record,
    ...readRecords(store).filter((item) => item.identity !== identity),
  ].slice(0, 16);
  const json = JSON.stringify(items);
  if (identity.length > 8192 || json.length > 512 * 1024)
    throw new Error("阅读状态已达存储预算");
  store.setItem(TEXT_READER_STATE_KEY, json);
}
export function readTextReaderOptions(
  store: BrowserSettingsStore,
): TextReaderOptions {
  let value: Partial<TextReaderOptions> = {};
  try {
    value = JSON.parse(store.getItem(TEXT_READER_OPTIONS_KEY) ?? "{}") ?? {};
  } catch {
    /* Defaults keep browsing available. */
  }
  const symbol = (value: unknown, fallback: string) =>
    typeof value === "string" && value.trim() && [...value].length <= 8
      ? value
      : fallback;
  return {
    ...DEFAULT_EDITOR_FOLD_ICONS,
    fontSize:
      typeof value.fontSize === "number" && Number.isFinite(value.fontSize)
        ? Math.max(12, Math.min(32, Math.round(value.fontSize)))
        : 16,
    editor_show_line_numbers: value.editor_show_line_numbers !== false,
    editor_fold_icon_style: ["chevron", "triangle", "custom"].includes(
      value.editor_fold_icon_style ?? "",
    )
      ? value.editor_fold_icon_style!
      : "chevron",
    editor_fold_icon_collapsed: symbol(
      value.editor_fold_icon_collapsed,
      DEFAULT_EDITOR_FOLD_ICONS.editor_fold_icon_collapsed,
    ),
    editor_fold_icon_expanded: symbol(
      value.editor_fold_icon_expanded,
      DEFAULT_EDITOR_FOLD_ICONS.editor_fold_icon_expanded,
    ),
  };
}

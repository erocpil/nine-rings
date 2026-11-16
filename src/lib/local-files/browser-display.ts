import type { BrowserColumn } from "./browser-preferences";
export interface BrowserDisplay {
  fontSize: number;
  rowHeight: number;
  type: boolean;
  size: boolean;
  modified: boolean;
  dateFormat: "local" | "iso" | "date";
}
export interface BrowserDisplaySettings { defaults: BrowserDisplay; panes: [BrowserDisplay | null, BrowserDisplay | null] }
export const BROWSER_DISPLAY_KEY = "nr:file-browser-display";
export const BROWSER_DISPLAY_EVENT = "nr:file-browser-display-change";
export const DEFAULT_BROWSER_DISPLAY: BrowserDisplay = { fontSize: 13, rowHeight: 32, type: true, size: true, modified: true, dateFormat: "local" };
function normalize(value: Partial<BrowserDisplay> | null | undefined): BrowserDisplay {
  const bounded = (input: unknown, fallback: number, low: number, high: number) => typeof input === "number" && Number.isFinite(input) ? Math.round(Math.max(low, Math.min(high, input))) : fallback;
  const fontSize = bounded(value?.fontSize, 13, 12, 20);
  return { fontSize, rowHeight: Math.max(fontSize + 12, bounded(value?.rowHeight, 32, 28, 48)), type: value?.type !== false, size: value?.size !== false, modified: value?.modified !== false, dateFormat: value?.dateFormat === "iso" || value?.dateFormat === "date" ? value.dateFormat : "local" };
}
export function parseBrowserDisplay(raw: string | null): BrowserDisplaySettings {
  try {
    const value = JSON.parse(raw ?? "{}");
    return { defaults: normalize(value?.defaults), panes: [0, 1].map(side => value?.panes?.[side] && typeof value.panes[side] === "object" ? normalize(value.panes[side]) : null) as BrowserDisplaySettings["panes"] };
  } catch { return { defaults: { ...DEFAULT_BROWSER_DISPLAY }, panes: [null, null] }; }
}
export function browserDisplayColumns(display: BrowserDisplay, typeSupported: boolean): BrowserColumn[] {
  return ["name", ...(typeSupported && display.type ? ["type"] : []), ...(display.size ? ["size"] : []), ...(display.modified ? ["modified"] : [])] as BrowserColumn[];
}
const localDateFormatter = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
export function browserDateText(value: number | undefined, format: BrowserDisplay["dateFormat"] = "local") {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  if (format === "local") return localDateFormatter.format(date);
  const pad = (number: number) => String(number).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return format === "date" ? day : `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

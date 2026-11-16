import type { BrowserSettingsStore } from "./browser-workspace-contract";
export interface ReaderLocation {
  page: number;
  top: number;
  label?: string;
}
export interface ReaderExtras {
  fingerprint: string;
  bookmarks: ReaderLocation[];
  chapters: Record<string, number>;
  rotation: number;
  continuous: boolean;
  fitPage: boolean;
  lineHeight: number;
  margin: number;
  theme: "light" | "sepia" | "dark";
}
const KEY = "nr:file-browser-reader-extras";
const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
function records(store: BrowserSettingsStore): Record<string, ReaderExtras> {
  try {
    const raw = store.getItem(KEY);
    if (!raw || raw.length > 256 * 1024) return {};
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}
export function readReaderExtras(
  store: BrowserSettingsStore,
  id: string,
  fingerprint: string,
): ReaderExtras {
  const saved = records(store)[id];
  const value = saved?.fingerprint === fingerprint ? saved : undefined;
  return {
    fingerprint,
    bookmarks: Array.isArray(value?.bookmarks)
      ? value.bookmarks
          .slice(0, 100)
          .filter(
            (item) =>
              item &&
              Number.isInteger(item.page) &&
              item.page > 0 &&
              item.page <= 100000 &&
              typeof item.top === "number" &&
              Number.isFinite(item.top),
          )
          .map((item) => ({
            page: item.page,
            top: number(item.top, 0, -1e7, 1e7),
            label:
              typeof item.label === "string" ? item.label.slice(0, 120) : "",
          }))
      : [],
    chapters: Object.fromEntries(
      Object.entries(
        value?.chapters && typeof value.chapters === "object"
          ? value.chapters
          : {},
      )
        .slice(-1000)
        .filter(
          ([key, value]) =>
            /^\d+$/.test(key) &&
            typeof value === "number" &&
            Number.isFinite(value),
        )
        .map(([key, value]) => [key, number(value, 0, 0, 1e7)]),
    ),
    rotation: [0, 90, 180, 270].includes(value?.rotation ?? -1)
      ? value!.rotation
      : 0,
    continuous: value?.continuous === true,
    fitPage: value?.fitPage === true,
    lineHeight: number(value?.lineHeight, 1.75, 1.2, 2.4),
    margin: number(value?.margin, 5, 1, 12),
    theme:
      value?.theme === "dark" || value?.theme === "sepia"
        ? value.theme
        : "light",
  };
}
export function saveReaderExtras(
  store: BrowserSettingsStore,
  id: string,
  value: ReaderExtras,
) {
  const entries = Object.entries(records(store))
    .filter(([key]) => key !== id)
    .slice(-31);
  const json = JSON.stringify(Object.fromEntries([...entries, [id, value]]));
  if (id.length > 8192 || json.length > 256 * 1024)
    throw Error("阅读设置超过存储预算");
  store.setItem(KEY, json);
}

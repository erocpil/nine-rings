import type { BrowserSettingsStore } from "./browser-workspace-contract";
const KEY = "nr:file-browser-reading";
export interface ReaderPreviewState {
  fingerprint: string;
  page: number;
  zoom: number;
  top: number;
  left: number;
  font: number;
}
const finite = (v: unknown, fallback: number, max: number) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.max(0, Math.min(max, v))
    : fallback;
function records(
  store: BrowserSettingsStore,
): Record<string, ReaderPreviewState> {
  try {
    const raw = store.getItem(KEY);
    if (!raw || raw.length > 64 * 1024) return {};
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}
export function readReaderPreviewState(
  store: BrowserSettingsStore,
  identity: string,
  fingerprint: string,
): ReaderPreviewState {
  const value = records(store)[identity];
  const source = value?.fingerprint === fingerprint ? value : undefined;
  return {
    fingerprint,
    page: Math.max(1, Math.floor(finite(source?.page, 1, 100000))),
    zoom: finite(source?.zoom, 0, 2),
    top: finite(source?.top, 0, 10000000),
    left: finite(source?.left, 0, 100000),
    font: Math.max(75, finite(source?.font, 100, 200)),
  };
}
export function saveReaderPreviewState(
  store: BrowserSettingsStore,
  identity: string,
  value: ReaderPreviewState,
) {
  if (identity.length > 8192) throw Error("阅读路径过长");
  const entries = Object.entries(records(store))
    .filter(([key]) => key !== identity)
    .slice(-31);
  const json = JSON.stringify(
    Object.fromEntries([...entries, [identity, value]]),
  );
  if (json.length > 64 * 1024) throw Error("阅读状态超过预算");
  store.setItem(KEY, json);
}

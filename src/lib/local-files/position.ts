export interface LocalFilePosition {
  offset: number;
  scrollTop: number;
  scrollLeft: number;
  anchor?: number;
  topOffset?: number;
}

const KEY = "nr:local-file-positions";
const LIMIT = 64;

function readAll(): Record<string, LocalFilePosition> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, LocalFilePosition] => {
      const item = entry[1] as Partial<LocalFilePosition> | null;
      return !!item && Number.isFinite(item.offset) && Number.isFinite(item.scrollTop) && Number.isFinite(item.scrollLeft);
    }).slice(0, LIMIT));
  } catch {
    return {};
  }
}

export function readLocalFilePosition(identity: string): LocalFilePosition | null {
  return readAll()[identity] ?? null;
}

export function saveLocalFilePosition(identity: string, position: LocalFilePosition) {
  try {
    const current = readAll();
    delete current[identity];
    const next = { [identity]: position, ...current };
    const entries = Object.entries(next).slice(0, LIMIT);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Position restoration is best-effort; it must not interrupt reading.
  }
}

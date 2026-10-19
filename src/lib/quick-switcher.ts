import type { Note } from "../types/models";

export const RECENT_NOTES_KEY = "nr:recentNotes";
export const RECENT_NOTES_LIMIT = 64;
export const RECENT_NOTE_EDITS_KEY = "nr:recentNoteEdits";
export const RECENT_NOTES_CHANGED_EVENT = "nr:recentNotesChanged";
export const NOTE_ACCESS_TIMES_KEY = "nr:noteAccessTimes";

interface RecentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readRecentNoteIds(storage: RecentStorage = localStorage): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(RECENT_NOTES_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))]
      .slice(0, RECENT_NOTES_LIMIT);
  } catch {
    return [];
  }
}

export function rememberRecentNote(id: string, storage: RecentStorage = localStorage): void {
  if (!id) return;
  const next = [id, ...readRecentNoteIds(storage).filter((candidate) => candidate !== id)]
    .slice(0, RECENT_NOTES_LIMIT);
  storage.setItem(RECENT_NOTES_KEY, JSON.stringify(next));
  try {
    storage.setItem(RECENT_NOTE_EDITS_KEY, JSON.stringify(readRecentEditedNoteIds(storage).filter(candidate => next.includes(candidate))));
  } catch { /* Optional presentation metadata must not block navigation. */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RECENT_NOTES_CHANGED_EVENT));
}

type RecentAccessStorage = Pick<RecentStorage, "getItem" | "setItem">;

function readNoteAccessTimes(storage: RecentAccessStorage): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(NOTE_ACCESS_TIMES_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] =>
      typeof entry[0] === "string" && typeof entry[1] === "string" && Number.isFinite(Date.parse(entry[1]))));
  } catch {
    return {};
  }
}

/** Store per-device access time without changing synced document data. */
export function markRecentNoteAccessed(id: string, accessedAt = new Date().toISOString(), storage: RecentAccessStorage = localStorage): string {
  if (!id) return accessedAt;
  try {
    const times = readNoteAccessTimes(storage);
    times[id] = accessedAt;
    const retained = Object.entries(times)
      .sort((left, right) => right[1].localeCompare(left[1]))
      .slice(0, 4096);
    storage.setItem(NOTE_ACCESS_TIMES_KEY, JSON.stringify(Object.fromEntries(retained)));
  } catch { /* Access history is optional local presentation metadata. */ }
  return accessedAt;
}

export function readRecentNoteAccessedAt(id: string, storage: RecentAccessStorage = localStorage): string | null {
  return readNoteAccessTimes(storage)[id] ?? null;
}

/** Observed successful edits, not inferred from import or filesystem timestamps. */
export function readRecentEditedNoteIds(storage: RecentStorage = localStorage): string[] {
  try {
    const raw: unknown = JSON.parse(storage.getItem(RECENT_NOTE_EDITS_KEY) ?? "[]");
    return Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, RECENT_NOTES_LIMIT) : [];
  } catch { return []; }
}

export function markRecentNoteEdited(id: string, storage: RecentStorage = localStorage): void {
  if (!id) return;
  try {
    const retained = new Set([id, ...readRecentNoteIds(storage)]);
    const edited = [id, ...readRecentEditedNoteIds(storage).filter(candidate => candidate !== id && retained.has(candidate))].slice(0, RECENT_NOTES_LIMIT);
    storage.setItem(RECENT_NOTE_EDITS_KEY, JSON.stringify(edited));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(RECENT_NOTES_CHANGED_EVENT));
  } catch { /* Saving content succeeded even when this optional preference fails. */ }
}

function searchableText(note: Note): string {
  return [
    note.title ?? "",
    note.storagePath ?? "",
    note.date,
    ...note.tags,
    ...(note.concepts ?? []),
  ].join(" ").toLocaleLowerCase();
}

/** Recent visits first, then recently edited notes. */
export function rankQuickSwitcherNotes(notes: Note[], recentIds: string[]): Note[] {
  const recentRank = new Map(recentIds.map((id, index) => [id, index]));
  return [...notes].sort((a, b) => {
    const aRank = recentRank.get(a.id);
    const bRank = recentRank.get(b.id);
    if (aRank !== undefined || bRank !== undefined) {
      if (aRank === undefined) return 1;
      if (bRank === undefined) return -1;
      return aRank - bRank;
    }
    return b.updated_at.localeCompare(a.updated_at) || b.date.localeCompare(a.date);
  });
}

export function filterQuickSwitcherNotes(notes: Note[], query: string): Note[] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return notes;
  return notes.filter((note) => {
    const haystack = searchableText(note);
    return tokens.every((token) => haystack.includes(token));
  });
}

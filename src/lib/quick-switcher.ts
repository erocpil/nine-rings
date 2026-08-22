import type { Note } from "../types/models";

export const RECENT_NOTES_KEY = "nr:recentNotes";
export const RECENT_NOTES_LIMIT = 20;

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

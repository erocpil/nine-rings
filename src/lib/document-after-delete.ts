import type { Note } from "../types/models";

/** Resolve a replacement before deletion, so the store can change selection atomically. */
export async function documentAfterDelete(
  deleted: string[],
  recent: string[],
  get: (id: string) => Promise<Note | null>,
  summaries: () => Promise<{ id: string; updated_at: string }[]>,
): Promise<Note | null> {
  const ignored = new Set(deleted);
  for (const id of recent) {
    if (ignored.has(id)) continue;
    ignored.add(id);
    const note = await get(id);
    if (note) return note;
  }
  const candidates = (await summaries())
    .filter((note) => !ignored.has(note.id))
    .sort(
      (a, b) =>
        (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0) ||
        a.id.localeCompare(b.id),
    );
  for (const summary of candidates) {
    const note = await get(summary.id);
    if (note) return note;
  }
  return null;
}

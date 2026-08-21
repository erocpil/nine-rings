import type { Note } from "../types/models";
import { extractPlainText } from "./storage/core";

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

interface IndexedNote {
  note: Note;
  title: string;
  text: string;
}

/** In-memory index shared by the Web Worker and unit tests. Raw notes remain in IndexedDB. */
export class NoteSearchIndex {
  private readonly notes = new Map<string, IndexedNote>();

  rebuild(notes: Note[]): void {
    this.notes.clear();
    notes.forEach((note) => this.upsert(note));
  }

  upsert(note: Note): void {
    const title = normalize(note.title ?? "");
    const text = normalize([
      note.title ?? "",
      extractPlainText(note.content),
      ...(note.tags ?? []),
      ...(note.concepts ?? []),
      note.storagePath ?? "",
    ].join("\n"));
    this.notes.set(note.id, { note, title, text });
  }

  remove(id: string): void {
    this.notes.delete(id);
  }

  search(query: string): Note[] {
    const normalized = normalize(query);
    if (!normalized) return [];
    const terms = normalized.split(" ").filter(Boolean);
    return [...this.notes.values()]
      .filter(({ text }) => terms.every((term) => text.includes(term)))
      .sort((a, b) => {
        const rank = (entry: IndexedNote) => entry.title === normalized ? 3 : entry.title.startsWith(normalized) ? 2 : entry.title.includes(normalized) ? 1 : 0;
        return rank(b) - rank(a)
          || Number(b.note.pinned) - Number(a.note.pinned)
          || b.note.updated_at.localeCompare(a.note.updated_at);
      })
      .map(({ note }) => note);
  }

  get size(): number {
    return this.notes.size;
  }
}

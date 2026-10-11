import type { Note } from "../types/models";
import { extractPlainText } from "./storage/core";
import { snippetParts } from "./storage/idb-snippet";
import { isEncrypted } from "./document-crypto";
import { findTextMatches, type SearchOptions } from "./search-matching";
import type { SnippetPart } from "./storage/idb-snippet";

/** Increment when extractPlainText semantics change; worker state is rebuilt each launch/import. */
export const SEARCH_TEXT_FORMAT_VERSION = 1;

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

interface IndexedNote {
  note: SearchNote;
  title: string;
  text: string;
}

export type SearchNote = Omit<Note, "content"> & { search_text: string; search_parts?: SnippetPart[] };
export function toSearchNote(note: Note | SearchNote): SearchNote {
  const { content, ...metadata } = note as Note;
  if (isEncrypted(content)) return { ...metadata, tags: [], concepts: [], search_text: "" };
  return { ...metadata, search_text: content !== undefined ? extractPlainText(content) : (note as SearchNote).search_text ?? "" };
}

/** Shared cross-platform in-memory index. Raw notes remain in the storage adapter. */
export class NoteSearchIndex {
  private readonly notes = new Map<string, IndexedNote>();

  rebuild(notes: (Note | SearchNote)[]): void {
    this.notes.clear();
    notes.forEach((note) => this.upsert(note));
  }

  upsert(input: Note | SearchNote): void {
    const note = toSearchNote(input);
    const title = normalize(note.title ?? "");
    const text = normalize([
      note.title ?? "",
      note.search_text,
      ...(note.tags ?? []),
      ...(note.concepts ?? []),
      note.storagePath ?? "",
    ].join("\n"));
    this.notes.set(note.id, { note, title, text });
  }

  remove(id: string): void {
    this.notes.delete(id);
  }

  search(query: string, options: SearchOptions = {}): SearchNote[] {
    const normalized = normalize(query);
    if (options.regex ? !query : !normalized) return [];
    const terms = normalized.split(" ").filter(Boolean);
    const advanced = options.regex || options.wholeWord || options.caseSensitive;
    const rawTerms = options.regex ? [query] : query.trim().split(/\s+/).filter(Boolean);
    return [...this.notes.values()]
      .filter(({ text, note }) => advanced
        ? rawTerms.every(term => [note.title ?? "", note.search_text, ...(note.tags ?? []), ...(note.concepts ?? []), note.storagePath ?? ""]
          .some(field => findTextMatches(field, term, options).length > 0))
        : terms.every((term) => text.includes(term)))
      .sort((a, b) => {
        const rank = (entry: IndexedNote) => entry.title === normalized ? 3 : entry.title.startsWith(normalized) ? 2 : entry.title.includes(normalized) ? 1 : 0;
        return rank(b) - rank(a)
          || Number(b.note.pinned) - Number(a.note.pinned)
          || compareText(b.note.updated_at, a.note.updated_at)
          || compareText(a.note.id, b.note.id);
      })
      .map(({ note }) => {
        const parts = snippetParts(note.search_text, query, options);
        return { ...note, search_text: parts.map(part => part.text).join(""), ...(advanced ? { search_parts: parts } : {}) };
      });
  }

  get size(): number {
    return this.notes.size;
  }
}

// A deterministic tie-breaker independent of OS locale and database row order.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

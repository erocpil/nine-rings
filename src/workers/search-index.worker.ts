import type { Note } from "../types/models";
import { NoteSearchIndex } from "../lib/search-index-core";

type Request =
  | { id: number; type: "rebuild"; notes: Note[] }
  | { id: number; type: "upsert"; note: Note }
  | { id: number; type: "remove"; noteId: string }
  | { id: number; type: "search"; query: string };

const index = new NoteSearchIndex();

self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    if (request.type === "rebuild") {
      index.rebuild(request.notes);
      self.postMessage({ id: request.id, result: index.size });
    } else if (request.type === "upsert") {
      index.upsert(request.note);
      self.postMessage({ id: request.id, result: index.size });
    } else if (request.type === "remove") {
      index.remove(request.noteId);
      self.postMessage({ id: request.id, result: index.size });
    } else {
      self.postMessage({ id: request.id, result: index.search(request.query) });
    }
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
  }
};

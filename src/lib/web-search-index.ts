import type { Note } from "../types/models";
import type { StorageAdapter, DocSearchQuery } from "./storage/types";
import { isPathUnder } from "./storage/core";
import { isTauriRuntime } from "./runtime";
import { subscribeToDataChanges } from "./tab-coordination";
import { getAdapter } from "./storage";
import { NoteSearchIndex, toSearchNote, type SearchNote } from "./search-index-core";

type WorkerRequest =
  | { type: "rebuild"; notes: SearchNote[] }
  | { type: "upsert"; note: SearchNote }
  | { type: "remove"; noteId: string }
  | { type: "search"; query: string };

interface WorkerResponse {
  id: number;
  result?: unknown;
  error?: string;
}

let worker: Worker | null = null;
let requestId = 0;
let ready: Promise<number> | null = null;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function resetWorker(error?: Error): void {
  worker?.terminate();
  worker = null;
  ready = null;
  for (const request of pending.values()) request.reject(error ?? new Error("搜索索引已重置"));
  pending.clear();
}

function getWorker(): Worker | null {
  if (worker || typeof Worker === "undefined") return worker;
  worker = new Worker(new URL("../workers/search-index.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (event.data.error) request.reject(new Error(event.data.error));
    else request.resolve(event.data.result);
  };
  worker.onerror = () => resetWorker(new Error("搜索索引 Worker 异常"));
  return worker;
}

function send<T>(message: WorkerRequest): Promise<T> {
  const target = getWorker();
  if (!target) return Promise.reject(new Error("搜索索引 Worker 不可用"));
  const id = ++requestId;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: (value) => resolve(value as T), reject });
    target.postMessage({ id, ...message });
  });
}

async function ensureReady(adapter: StorageAdapter): Promise<number> {
  if (!ready) {
    ready = loadSearchNotes(adapter)
      .then((notes) => send<number>({ type: "rebuild", notes: notes.map(toSearchNote) }))
      .catch((error) => {
        resetWorker();
        throw error;
      });
  }
  return ready;
}

export async function searchWebNotes(adapter: StorageAdapter, query: string): Promise<Note[]> {
  const summaries = await searchWebNoteSummaries(adapter, query);
  const notes: Note[] = [];
  // Compatibility for consumers that need full documents, with bounded reads.
  for (let start = 0; start < summaries.length; start += 32) {
    const batch = await Promise.all(summaries.slice(start, start + 32).map((item) => adapter.getNote(item.id)));
    notes.push(...batch.filter((note): note is Note => note !== null));
  }
  return notes;
}

export async function searchWebNoteSummaries(adapter: StorageAdapter, query: string): Promise<SearchNote[]> {
  query = query.trim();
  // In particular, native LIKE '%%' must not turn a cleared query into results.
  if (!query) return [];
  if (typeof Worker === "undefined") return searchLocally(adapter, query);
  try {
    await ensureReady(adapter);
    return await send<SearchNote[]>({ type: "search", query });
  } catch (error) {
    console.warn("[search-index] Worker 不可用，使用相同规则的本地搜索:", error);
    return searchLocally(adapter, query);
  }
}

/** Filters narrow the shared ranked results; they never change text matching.
 * Filter-only queries load fresh documents and keep updated-time ordering. */
export async function searchDocumentSummaries(adapter: StorageAdapter, query: DocSearchQuery): Promise<SearchNote[]> {
  const text = query.text?.trim();
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const candidates = text
    ? await searchWebNoteSummaries(adapter, text)
    : (await adapter.searchDocs({})).map(toSearchNote).sort((a, b) =>
      compare(b.updated_at, a.updated_at) || compare(a.id, b.id));
  const before = query.staleBefore ? Date.parse(query.staleBefore) : null;
  return candidates.filter(note => {
    if (!note.storagePath || note.deleted_at) return false;
    if (query.storagePath && !isPathUnder(note.storagePath, query.storagePath)) return false;
    if (query.docType && note.docType !== query.docType) return false;
    if (query.concept && !note.concepts?.includes(query.concept)) return false;
    if (before !== null && !(Date.parse(note.updated_at) < before)) return false;
    return true;
  });
}

/** A degraded browser must preserve matching, ranking and redaction semantics.
 * Do not cache this fallback: writes in another tab must be visible even when
 * workers are unavailable. Yield between batches to keep the UI responsive. */
async function searchLocally(adapter: StorageAdapter, query: string): Promise<SearchNote[]> {
  const notes = await loadSearchNotes(adapter);
  const index = new NoteSearchIndex();
  for (let offset = 0; offset < notes.length; offset += 250) {
    for (const note of notes.slice(offset, offset + 250)) index.upsert(note);
    if (offset + 250 < notes.length) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return index.search(query);
}

// getAllNotes intentionally contains essays only. Documents must be loaded
// without a text predicate so backend matching/limits cannot discard candidates.
async function loadSearchNotes(adapter: StorageAdapter): Promise<Note[]> {
  const [essays, documents] = await Promise.all([adapter.getAllNotes(), adapter.searchDocs({})]);
  return [...new Map([...essays, ...documents].map(note => [note.id, note])).values()];
}

export function updateWebSearchIndex(note: Note): void {
  if (!ready) return;
  void ready.then(() => send<number>({ type: "upsert", note: toSearchNote(note) })).catch(() => resetWorker());
}

export function removeFromWebSearchIndex(noteId: string): void {
  if (!ready) return;
  void ready.then(() => send<number>({ type: "remove", noteId })).catch(() => resetWorker());
}

export function invalidateWebSearchIndex(): void {
  resetWorker();
}

export async function rebuildWebSearchIndex(): Promise<number> {
  const adapter = await getAdapter();
  resetWorker();
  return ensureReady(adapter);
}

if (typeof window !== "undefined" && !isTauriRuntime()) {
  subscribeToDataChanges(() => invalidateWebSearchIndex());
}

// Native auxiliary windows do not use the browser BroadcastChannel. Recheck
// persisted data when the main window regains focus after external writes.
if (typeof window !== "undefined" && isTauriRuntime()) {
  window.addEventListener("focus", invalidateWebSearchIndex);
}

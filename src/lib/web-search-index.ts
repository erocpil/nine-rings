import type { Note } from "../types/models";
import type { StorageAdapter } from "./storage/types";
import { isTauriRuntime } from "./runtime";
import { subscribeToDataChanges } from "./tab-coordination";
import { getAdapter } from "./storage";

type WorkerRequest =
  | { type: "rebuild"; notes: Note[] }
  | { type: "upsert"; note: Note }
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
  if (worker || typeof Worker === "undefined" || isTauriRuntime()) return worker;
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
    ready = adapter.getAllNotes()
      .then((notes) => send<number>({ type: "rebuild", notes }))
      .catch((error) => {
        resetWorker();
        throw error;
      });
  }
  return ready;
}

export async function searchWebNotes(adapter: StorageAdapter, query: string): Promise<Note[]> {
  if (isTauriRuntime() || typeof Worker === "undefined") return adapter.searchNotes(query);
  try {
    await ensureReady(adapter);
    return await send<Note[]>({ type: "search", query });
  } catch (error) {
    console.warn("[search-index] 索引不可用，回退到存储搜索:", error);
    return adapter.searchNotes(query);
  }
}

export function updateWebSearchIndex(note: Note): void {
  if (!ready) return;
  void ready.then(() => send<number>({ type: "upsert", note })).catch(() => resetWorker());
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

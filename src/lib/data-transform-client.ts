import type { CreateNoteInput } from "../types/models";
import type { MarkdownImportOptions } from "./markdown-import";
import { buildMarkdownImportInput } from "./markdown-import";
import { isTauriRuntime } from "./runtime";

type WorkerTask = "parse-json" | "stringify-json" | "markdown-batch";

interface MarkdownSource {
  fileName: string;
  source: string;
}

export interface MarkdownTransformResult {
  fileName: string;
  input?: CreateNoteInput;
  error?: string;
}

interface WorkerResponse {
  id: number;
  result?: unknown;
  error?: string;
}

let worker: Worker | null = null;
let requestId = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function getWorker(): Worker | null {
  if (worker || typeof Worker === "undefined" || isTauriRuntime()) return worker;
  worker = new Worker(new URL("../workers/data-transform.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (event.data.error) request.reject(new Error(event.data.error));
    else request.resolve(event.data.result);
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "数据转换 Worker 失败");
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function runWorkerTask<T>(task: WorkerTask, payload: unknown, fallback: () => T): Promise<T> {
  const target = getWorker();
  if (!target) return Promise.resolve().then(fallback);
  const id = ++requestId;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: (value) => resolve(value as T), reject });
    target.postMessage({ id, task, payload });
  });
}

export function parseJsonAsync<T>(json: string): Promise<T> {
  return runWorkerTask<T>("parse-json", json, () => JSON.parse(json) as T);
}

export function stringifyJsonAsync(value: unknown, space?: number): Promise<string> {
  return runWorkerTask<string>("stringify-json", { value, space }, () => JSON.stringify(value, null, space));
}

export function transformMarkdownBatch(
  sources: MarkdownSource[],
  options: MarkdownImportOptions,
): Promise<MarkdownTransformResult[]> {
  return runWorkerTask<MarkdownTransformResult[]>("markdown-batch", { sources, options }, () => (
    sources.map(({ fileName, source }) => {
      try {
        return { fileName, input: buildMarkdownImportInput(fileName, source, options) };
      } catch (error) {
        return { fileName, error: error instanceof Error ? error.message : String(error) };
      }
    })
  ));
}

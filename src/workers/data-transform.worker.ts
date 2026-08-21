/// <reference lib="webworker" />

import { buildMarkdownImportInput, type MarkdownImportOptions } from "../lib/markdown-import";

interface WorkerRequest {
  id: number;
  task: "parse-json" | "stringify-json" | "markdown-batch";
  payload: unknown;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, task, payload } = event.data;
  try {
    let result: unknown;
    if (task === "parse-json") {
      result = JSON.parse(payload as string);
    } else if (task === "stringify-json") {
      const request = payload as { value: unknown; space?: number };
      result = JSON.stringify(request.value, null, request.space);
    } else {
      const request = payload as {
        sources: Array<{ fileName: string; source: string }>;
        options: MarkdownImportOptions;
      };
      result = request.sources.map(({ fileName, source }) => {
        try {
          return { fileName, input: buildMarkdownImportInput(fileName, source, request.options) };
        } catch (error) {
          return { fileName, error: error instanceof Error ? error.message : String(error) };
        }
      });
    }
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};

export {};

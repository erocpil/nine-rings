/// <reference lib="webworker" />

import { buildMarkdownImportInput, type MarkdownImportOptions } from "../lib/markdown-import";
import { deltaToProseMirror } from "../lib/delta-converter";
import { extractTitle, mdToDelta } from "../lib/md-parser";

interface WorkerRequest {
  id: number;
  task: "parse-json" | "stringify-json" | "markdown-batch" | "markdown-source" | "delta-to-prosemirror";
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
    } else if (task === "delta-to-prosemirror") {
      result = deltaToProseMirror(payload);
    } else if (task === "markdown-source") {
      const request = payload as { fileName: string; source: string };
      result = {
        title: extractTitle(request.source, request.fileName.replace(/\.md(?:own|ark)?$/i, "")),
        content: mdToDelta(request.source),
      };
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

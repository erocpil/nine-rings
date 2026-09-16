/// <reference lib="webworker" />

import { buildTextImportInput, type MarkdownImportOptions, type TextImportSource } from "../lib/markdown-import";
import { deltaToProseMirror } from "../lib/delta-converter";
import { extractTitle, mdToDelta } from "../lib/md-parser";
import { deltaToMarkdown } from "../lib/markdown-serializer";

interface WorkerRequest {
  id: number;
  task: "parse-json" | "stringify-json" | "markdown-batch" | "markdown-source" | "delta-to-prosemirror" | "delta-to-markdown";
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
    } else if (task === "delta-to-markdown") {
      result = deltaToMarkdown(payload);
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
        sources: TextImportSource[];
        options: MarkdownImportOptions;
      };
      result = request.sources.map(file => {
        const { fileName } = file;
        try {
          return { fileName, input: buildTextImportInput(file, request.options) };
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

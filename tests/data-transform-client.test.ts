import assert from "node:assert/strict";
import { deltaToProseMirror } from "../src/lib/delta-converter";
import { deltaToProseMirrorAsync, deltaToMarkdownAsync, markdownToProseMirrorAsync } from "../src/lib/data-transform-client";
import { deltaToMarkdown } from "../src/lib/markdown-serializer";

import { mdToDelta } from "../src/lib/md-parser";

const delta = {
  ops: [
    { insert: "后台转换" },
    { insert: "\n", attributes: { header: 2 } },
    { insert: "正文\n" },
  ],
};

const previousWorker = globalThis.Worker;
const previousWindow = globalThis.window;
let workerCreated = 0;
let workerTasks = 0;
let failWorkerSend = false;
let failWorkerLoad = false;

class FakeDataTransformWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor() {
    workerCreated += 1;
  }

  postMessage(message: { id: number; task: string; payload: unknown }) {
    workerTasks += 1;
    if (failWorkerSend) throw new Error("Worker unavailable");
    if (failWorkerLoad) {
      queueMicrotask(() => this.onerror?.({ message: "Worker resource unavailable" } as ErrorEvent));
      return;
    }
    queueMicrotask(() => this.onmessage?.({
      data: {
        id: message.id,
        result: message.task === "delta-to-prosemirror"
          ? deltaToProseMirror(message.payload)
          : message.task === "markdown-to-prosemirror" ? deltaToProseMirror(mdToDelta(message.payload as string))
          : message.task === "delta-to-markdown" ? deltaToMarkdown(message.payload) : undefined,
      },
    } as MessageEvent));
  }

  terminate() { /* no-op */ }
}

Object.defineProperty(globalThis, "Worker", {
  configurable: true,
  value: FakeDataTransformWorker,
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { __TAURI_INTERNALS__: {} },
});

assert.deepEqual(
  await deltaToProseMirrorAsync(delta),
  deltaToProseMirror(delta),
  "异步转换与同步兼容路径必须产生相同的 ProseMirror JSON",
);
assert.equal(workerCreated, 1, "Tauri WebView 可用 Worker 时必须创建后台转换线程");
assert.equal(workerTasks, 1, "大文档转换必须发送到 Worker，而不是占用 WebKit UI 线程");
assert.equal(await deltaToMarkdownAsync(delta), deltaToMarkdown(delta));
assert.equal(workerTasks, 2, "源码序列化也必须发送到 Worker");

const markdown = "# 大文档\n\n" + "**正文**\n\n".repeat(1000);
assert.deepEqual(await markdownToProseMirrorAsync(markdown), deltaToProseMirror(mdToDelta(markdown)));
assert.equal(workerTasks, 3, "Markdown 的解析和转换必须一并进入 Worker");
failWorkerSend = true;
assert.deepEqual(await markdownToProseMirrorAsync(markdown), deltaToProseMirror(mdToDelta(markdown)),
  "Worker 发送失败时应使用兼容转换，不能丢失粘贴内容");
failWorkerSend = false;
failWorkerLoad = true;
assert.deepEqual(await markdownToProseMirrorAsync(markdown), deltaToProseMirror(mdToDelta(markdown)),
  "Worker 异步加载失败后仍能完成粘贴转换");
const tasksBeforeFallback = workerTasks;
assert.deepEqual(await markdownToProseMirrorAsync(markdown), deltaToProseMirror(mdToDelta(markdown)));
assert.equal(workerTasks, tasksBeforeFallback, "已不可用的 Worker 不应继续接收请求");

if (previousWorker === undefined) delete (globalThis as { Worker?: typeof Worker }).Worker;
else Object.defineProperty(globalThis, "Worker", { configurable: true, value: previousWorker });
if (previousWindow === undefined) delete (globalThis as { window?: Window }).window;
else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });

console.log("Data transform client passed");

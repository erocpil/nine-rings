import assert from "node:assert/strict";
import { deltaToProseMirror } from "../src/lib/delta-converter";
import { deltaToProseMirrorAsync } from "../src/lib/data-transform-client";

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

class FakeDataTransformWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor(_url: URL, _options: WorkerOptions) {
    workerCreated += 1;
  }

  postMessage(message: { id: number; task: string; payload: unknown }) {
    workerTasks += 1;
    queueMicrotask(() => this.onmessage?.({
      data: {
        id: message.id,
        result: message.task === "delta-to-prosemirror"
          ? deltaToProseMirror(message.payload)
          : undefined,
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

if (previousWorker === undefined) delete (globalThis as { Worker?: typeof Worker }).Worker;
else Object.defineProperty(globalThis, "Worker", { configurable: true, value: previousWorker });
if (previousWindow === undefined) delete (globalThis as { window?: Window }).window;
else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });

console.log("Data transform client passed");

import assert from "node:assert/strict";
import { materializeAutoSaveChanges } from "../src/hooks/useAutoSave";

let reads = 0;
const pending = {
  title: "延迟保存",
  content: () => {
    reads += 1;
    return { ops: [{ insert: "正文\n" }] };
  },
};

assert.equal(reads, 0, "登记正文变更时不应立即执行全文序列化");
const materialized = materializeAutoSaveChanges(pending);
assert.equal(reads, 1, "真正保存时只读取一次正文快照");
assert.deepEqual(materialized, {
  title: "延迟保存",
  content: { ops: [{ insert: "正文\n" }] },
});
assert.equal(typeof pending.content, "function", "物化不能破坏失败重试所需的延迟快照");

console.log("Auto-save deferred serialization passed");

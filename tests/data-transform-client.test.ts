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

assert.deepEqual(
  await deltaToProseMirrorAsync(delta),
  deltaToProseMirror(delta),
  "异步转换与同步兼容路径必须产生相同的 ProseMirror JSON",
);

console.log("Data transform client passed");

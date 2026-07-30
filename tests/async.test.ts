import { strict as assert } from "node:assert";
import { withTimeout } from "../src/lib/async";

async function main() {
  assert.equal(await withTimeout(Promise.resolve("ok"), 50, "test"), "ok");

  await assert.rejects(
    withTimeout(new Promise(() => {}), 10, "加载文档树"),
    /加载文档树 超时/,
  );

  console.log("async timeout tests passed");
}

void main();

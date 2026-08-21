import assert from "node:assert/strict";
import { inspectWebStorage, storagePressure } from "../src/hooks/useWebPlatform";

async function run() {
  const unsupported = await inspectWebStorage(undefined);
  assert.deepEqual(unsupported, {
    supported: false,
    persisted: null,
    usage: null,
    quota: null,
  });

  const storage = {
    persisted: async () => true,
    estimate: async () => ({ usage: 85, quota: 100 }),
  } as StorageManager;
  const status = await inspectWebStorage(storage);
  assert.equal(status.supported, true);
  assert.equal(status.persisted, true);
  assert.equal(storagePressure(status), 0.85);
  assert.equal(storagePressure({ ...status, quota: 0 }), null);

  const unavailableEstimate = {
    persisted: async () => false,
    estimate: async () => { throw new Error("unavailable"); },
  } as StorageManager;
  assert.deepEqual(await inspectWebStorage(unavailableEstimate), {
    supported: true,
    persisted: false,
    usage: null,
    quota: null,
  });

  console.log("web-platform.test.ts: all tests passed");
}

void run();

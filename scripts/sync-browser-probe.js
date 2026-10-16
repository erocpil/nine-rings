import { candidateEntities } from "../src/lib/sync/entity-projection";
import { withCandidateEvaluation } from "../src/lib/sync/candidate-write-policy";
import { CURRENT_SYNC_CAPABILITIES } from "../src/lib/sync/protocol-capabilities";

const { performance, crypto, TextEncoder, indexedDB } = globalThis;

// Built separately from the app. Runs only in a disposable browser context.
globalThis.syncBrowserProbe = async (source) => {
  if (CURRENT_SYNC_CAPABILITIES.read || CURRENT_SYNC_CAPABILITIES.write)
    throw Error("Probe requires production migration to remain disabled");
  const stages = [];
  const stage = async (name, operation) => {
    const start = performance.now();
    const value = await operation();
    const metrics = await globalThis.sampleSyncMemory();
    stages.push({
      name,
      ms: Math.round(performance.now() - start),
      ...metrics,
    });
    return value;
  };
  const sourceDigest = async (text) =>
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
      ),
    )
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  const digest = await sourceDigest(source);
  const entities = await stage("certify-and-project", () =>
    withCandidateEvaluation(undefined, (scope) =>
      candidateEntities(source, "web", scope),
    ),
  );
  const projectedCount = entities.length;
  // Release the graph before testing source persistence; this is not full planning.
  entities.length = 0;
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("isolated-sync-memory-probe", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("source");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(Error("Probe database open failed"));
  });
  try {
    await stage(
      "indexeddb-write",
      () =>
        new Promise((resolve, reject) => {
          const transaction = database.transaction("source", "readwrite");
          transaction.objectStore("source").put(source, "snapshot");
          transaction.oncomplete = resolve;
          transaction.onabort = () => reject(Error("Probe write aborted"));
          transaction.onerror = () => {};
        }),
    );
    const restored = await stage(
      "indexeddb-read",
      () =>
        new Promise((resolve, reject) => {
          const transaction = database.transaction("source", "readonly");
          const request = transaction.objectStore("source").get("snapshot");
          transaction.oncomplete = () => resolve(request.result);
          transaction.onabort = () => reject(Error("Probe read aborted"));
          transaction.onerror = () => {};
        }),
    );
    if (
      typeof restored !== "string" ||
      (await sourceDigest(restored)) !== digest
    )
      throw Error("Probe source changed during persistence");
    return {
      projectedCount,
      sourceBytes: new TextEncoder().encode(source).length,
      stages,
    };
  } finally {
    database.close();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase("isolated-sync-memory-probe");
      request.onsuccess = resolve;
      request.onerror = () => reject(Error("Probe cleanup failed"));
      request.onblocked = () => reject(Error("Probe cleanup blocked"));
    });
  }
};

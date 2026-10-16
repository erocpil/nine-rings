import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  openSyncJournal,
  readAcceptedEntities,
} from "../../src/lib/sync/publication-store";
import {
  cancelPreparedPull,
  listPullSummaries,
  readPullAttempt,
  type PullAttempt,
} from "../../src/lib/sync/pull-store";

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("nine-rings-sync-state-v1");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        run: (lock: object | null) => unknown,
      ) => run({}),
    },
  });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  vi.stubGlobal("BroadcastChannel", undefined);
});
afterEach(() => vi.unstubAllGlobals());
async function seed(
  phase = "PREPARED",
  generationAfter: string | null = null,
  mode = "apply",
) {
  const record = {
    version: 1,
    id: "original",
    spaceId: "space",
    phase,
    generationAfter,
    mode,
    review: { spaceId: "space", space: { owner: "example", repo: "backup" } },
    source: "frozen content must survive",
    accepted: [],
    updatedAt: "original-time",
  } as unknown as PullAttempt;
  const db = await openSyncJournal();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["pulls", "pullSummaries"], "readwrite");
    tx.objectStore("pulls").put(record);
    tx.objectStore("pullSummaries").put({
      id: record.id,
      spaceId: record.spaceId,
      phase,
    });
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  db.close();
  return record;
}
it("cancels an unapplied intent without deleting evidence or accepting entities", async () => {
  const old = await seed();
  await cancelPreparedPull("space", "original");
  const next = await readPullAttempt("space");
  expect(next).toEqual({
    ...old,
    phase: "ABORTED",
    updatedAt: expect.any(String),
  });
  expect((await listPullSummaries())[0].phase).toBe("ABORTED");
  expect(await readAcceptedEntities("space")).toEqual([]);
  await expect(cancelPreparedPull("space", "original")).rejects.toThrow();
});
it.each(["APPLYING", "CONFIRMING", "NEEDS_REVIEW", "COMPLETE"])(
  "refuses %s without changing evidence",
  async (phase) => {
    const old = await seed(phase);
    await expect(cancelPreparedPull("space", "original")).rejects.toThrow();
    expect(await readPullAttempt("space")).toEqual(old);
  },
);
it("rejects stale UI identity and intents whose application generation exists", async () => {
  const old = await seed();
  await expect(cancelPreparedPull("space", "stale")).rejects.toThrow();
  expect(await readPullAttempt("space")).toEqual(old);
  await seed("PREPARED", "already-started");
  await expect(cancelPreparedPull("space", "original")).rejects.toThrow();
});
it("does not cancel an equal acceptance or an active restore", async () => {
  await seed("PREPARED", null, "equal");
  await expect(cancelPreparedPull("space", "original")).rejects.toThrow();
  const old = await seed();
  vi.stubGlobal("navigator", {
    locks: {
      request: async (_n: string, _o: unknown, run: (lock: null) => unknown) =>
        run(null),
    },
  });
  await expect(cancelPreparedPull("space", "original")).rejects.toThrow(
    "正在进行",
  );
  expect(await readPullAttempt("space")).toEqual(old);
});

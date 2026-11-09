import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import {
  createLocalDraftStore,
  type LocalFileDraft,
} from "../../src/lib/local-files/recovery";
const draft = (source: string): LocalFileDraft => ({
  identity: "root:a.c",
  source,
  baseSource: "base",
  baseRevision: "r1",
  bom: false,
  lineEnding: "lf",
  savedAt: Date.now(),
});
it("isolates app drafts even when both apps use the same file identity", async () => {
  const a = createLocalDraftStore("test-drafts-a", vi.fn()),
    b = createLocalDraftStore("test-drafts-b", vi.fn());
  await a.write(draft("Nine Rings"));
  await b.write(draft("Workbench"));
  expect((await a.read("root:a.c"))?.source).toBe("Nine Rings");
  await b.remove("root:a.c");
  expect(await b.read("root:a.c")).toBeNull();
  expect((await a.list()).map((item) => item.source)).toEqual(["Nine Rings"]);
});
it("shares one ordered lane for two instances of the same store, including remove after write", async () => {
  const changed = vi.fn(),
    a = createLocalDraftStore("test-drafts-lane", changed),
    b = createLocalDraftStore("test-drafts-lane", changed);
  const one = a.write(draft("first")),
    remove = b.remove("root:a.c"),
    latest = a.write(draft("latest"));
  await Promise.all([one, remove, latest]);
  expect((await b.read("root:a.c"))?.source).toBe("latest");
  expect(changed).toHaveBeenCalledTimes(3);
});
it("retains the newest bounded drafts and rejects invalid database names", async () => {
  const store = createLocalDraftStore("test-drafts-bound", vi.fn());
  for (let index = 0; index < 7; index++)
    await store.write({
      ...draft(String(index)),
      identity: `r:${index}`,
      savedAt: Date.now() + index,
    });
  expect((await store.list()).map((item) => item.source)).toEqual([
    "6",
    "5",
    "4",
    "3",
    "2",
  ]);
  expect(() => createLocalDraftStore("../invalid", vi.fn())).toThrow("名称");
});

it("expires an old draft without deleting a newer value published before cleanup", async () => {
  const name = "test-drafts-expiry",
    store = createLocalDraftStore(name, vi.fn());
  await store.write({ ...draft("expired"), savedAt: 0 });
  const original = IDBDatabase.prototype.transaction;
  const spy = vi
    .spyOn(IDBDatabase.prototype, "transaction")
    .mockImplementation(function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase["transaction"]>
    ) {
      const transaction = original.apply(this, args);
      if (this.name === name && args[1] === "readwrite")
        transaction.objectStore("drafts").put(draft("newer"));
      return transaction;
    });
  try {
    expect(await store.read("root:a.c")).toBeNull();
  } finally {
    spy.mockRestore();
  }
  expect((await store.read("root:a.c"))?.source).toBe("newer");
});

it("rejects an aborted draft transaction instead of reporting a durable checkpoint", async () => {
  const name = "test-drafts-abort",
    store = createLocalDraftStore(name, vi.fn());
  const original = IDBDatabase.prototype.transaction;
  const spy = vi
    .spyOn(IDBDatabase.prototype, "transaction")
    .mockImplementation(function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase["transaction"]>
    ) {
      const transaction = original.apply(this, args);
      if (this.name === name && args[1] === "readwrite")
        queueMicrotask(() => transaction.abort());
      return transaction;
    });
  try {
    await expect(store.write(draft("never committed"))).rejects.toBeInstanceOf(
      Error,
    );
  } finally {
    spy.mockRestore();
  }
  expect(await store.read("root:a.c")).toBeNull();
});

it("retains unresolved drafts without expiry and refuses overflow instead of evicting existing content", async () => {
  const store = createLocalDraftStore("test-drafts-unresolved", vi.fn(), {
    retainUntilResolved: true,
  });
  for (let index = 0; index < 5; index++)
    await store.write({
      ...draft(String(index)),
      identity: `r:${index}`,
      savedAt: 0,
    });
  expect((await store.read("r:0"))?.source).toBe("0");
  await expect(
    store.write({ ...draft("sixth"), identity: "r:5" }),
  ).rejects.toThrow("最多保留 5");
  expect((await store.list()).map((item) => item.source).sort()).toEqual([
    "0",
    "1",
    "2",
    "3",
    "4",
  ]);
  await store.write({ ...draft("updated"), identity: "r:0" });
  await store.remove("r:1");
  await store.write({ ...draft("sixth"), identity: "r:5" });
  expect((await store.read("r:5"))?.source).toBe("sixth");
});

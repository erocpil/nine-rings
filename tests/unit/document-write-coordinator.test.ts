import { expect, it } from "vitest";
import { AutoSaveQueue } from "../../src/lib/auto-save-queue";
import {
  coordinateDocumentUpdate,
  coordinateStorageReplacement,
  registerDocumentWriteCoordinator,
} from "../../src/lib/document-write-coordinator";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
it("property batches are frozen, ordered, confirmed once and cover failed older fields only after success", async () => {
  const gate = deferred();
  const writes: unknown[] = [];
  const queue = new AutoSaveQueue(async (_id, data) => {
    writes.push(data);
    await gate.promise;
  });
  const dispose = registerDocumentWriteCoordinator(queue);
  try {
    queue.mark("a", "title", "old");
    const first = queue.flushNote("a");
    const input = { title: "new", concepts: ["one"] };
    const property = coordinateDocumentUpdate("a", input, async (snapshot) => {
      writes.push(snapshot);
      return snapshot;
    });
    input.concepts.push("two");
    expect(queue.revisionState("a").contentRevision).toBe(2);
    const waiting = queue.whenSaved("a", queue.captureRevision("a"));
    gate.resolve();
    await first;
    expect(await property).toEqual({ title: "new", concepts: ["one"] });
    await waiting;
    expect(writes).toEqual([
      { title: "old" },
      { title: "new", concepts: ["one"] },
    ]);
    expect(queue.revisionState("a").confirmedRevision).toBe(2);
  } finally {
    dispose();
  }
});
it("auto-save storage routing does not enqueue itself or count the batch twice", async () => {
  const queue = new AutoSaveQueue((id, data) =>
    coordinateDocumentUpdate(id, data, async () => {}),
  );
  const dispose = registerDocumentWriteCoordinator(queue);
  try {
    queue.mark("a", "content", { ops: [] });
    await queue.flushAll();
    expect(queue.revisionState("a")).toMatchObject({
      contentRevision: 1,
      confirmedRevision: 1,
    });
  } finally {
    dispose();
  }
});
it("newer property changes supersede dirty fields and failed snapshots never replace newer edits", async () => {
  const queue = new AutoSaveQueue(async () => {});
  queue.mark("a", "title", "old unsaved");
  await queue.writeThrough("a", { title: "new" }, async () => {});
  expect(queue.pending("a")).toBeNull();
  await expect(
    queue.writeThrough("a", { concepts: ["retry"] }, async () => {
      throw new Error("disk");
    }),
  ).rejects.toThrow("disk");
  expect(queue.pending("a")).toEqual({ concepts: ["retry"] });
  await queue.whenSaved("a", queue.captureRevision("a"));
});
it("replacement drains in-flight writes, blocks new edits and invalidates every old document token", async () => {
  const gate = deferred();
  const order: string[] = [];
  const queue = new AutoSaveQueue(async () => {
    await gate.promise;
    order.push("saved");
  });
  const dispose = registerDocumentWriteCoordinator(queue);
  try {
    queue.mark("a", "title", "latest");
    const token = queue.captureRevision("a");
    const write = queue.flushNote("a");
    const replacement = coordinateStorageReplacement(async () => {
      order.push("restore");
    });
    expect(() => queue.mark("a", "title", "late")).toThrow("正在恢复");
    await expect(
      queue.writeThrough("a", { readonly: true }, async () => {}),
    ).rejects.toThrow("正在恢复");
    expect(order).toEqual([]);
    gate.resolve();
    await write;
    await replacement;
    expect(order).toEqual(["saved", "restore"]);
    await expect(queue.whenSaved("a", token)).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
    queue.mark("a", "title", "next");
  } finally {
    dispose();
  }
});
it("save failure prevents replacement and retains retry data; replacement failure releases its guard", async () => {
  let failing = true;
  const queue = new AutoSaveQueue(async () => {
    if (failing) throw new Error("disk");
  });
  queue.mark("a", "title", "latest");
  let replaced = false;
  await expect(
    queue.withReplacement(async () => {
      replaced = true;
    }),
  ).rejects.toThrow("disk");
  expect(replaced).toBe(false);
  expect(queue.pending("a")).toEqual({ title: "latest" });
  failing = false;
  await expect(
    queue.withReplacement(async () => {
      throw new Error("invalid backup");
    }),
  ).rejects.toThrow("invalid backup");
  queue.mark("a", "title", "still editable");
  await queue.flushAll();
});

it("explicit discard waits for an already executing write before reading a replacement", async () => {
  const gate = deferred();
  let body = "external";
  const queue = new AutoSaveQueue(async () => {
    await gate.promise;
    body = "old local";
  });
  queue.mark("a", "title", "local");
  const token = queue.captureRevision("a");
  const old = queue.flushNote("a");
  await Promise.resolve();
  const reload = queue.discardAndDrain("a");
  let finished = false;
  void reload.then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  gate.resolve();
  await old;
  await reload;
  expect(body).toBe("old local");
  await expect(queue.whenSaved("a", token)).rejects.toMatchObject({
    code: "STALE_REVISION",
  });
  expect(queue.status("a")).toBe("clean");
});

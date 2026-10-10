import { afterEach, expect, it, vi } from "vitest";
import { AutoSaveQueue } from "../../src/lib/auto-save-queue";
import { DocumentEditSessions } from "../../src/lib/document-edit-sessions";
import {
  advanceDocumentStorageGeneration,
  readDocumentStorageGeneration,
} from "../../src/lib/document-storage-generation";
afterEach(() => vi.unstubAllGlobals());
function storage() {
  const entries = new Map<string, string>();
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  });
}
it("an external replacement rejects old edits and save acknowledgements while retaining retry data", async () => {
  storage();
  const write = vi.fn(async () => {});
  const queue = new AutoSaveQueue(write);
  queue.captureRevision("a");
  advanceDocumentStorageGeneration("remote-restore");
  queue.mark("a", "title", "local draft");
  await expect(queue.flushAll()).rejects.toMatchObject({
    code: "STALE_REVISION",
  });
  expect(write).not.toHaveBeenCalled();
  expect(queue.pending("a")).toEqual({ title: "local draft" });
  expect(queue.revisionState("a").confirmedRevision).toBe(0);
  await expect(
    queue.whenSaved("a", queue.captureRevision("a")),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  queue.discard("a");
  queue.mark("a", "title", "newly loaded");
  await queue.flushAll();
  expect(write).toHaveBeenCalledOnce();
});
it("generation changes during a save do not confirm its old snapshot", async () => {
  storage();
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const queue = new AutoSaveQueue(async () => {
    await gate;
  });
  queue.mark("a", "title", "draft");
  const saved = queue.flushNote("a");
  await Promise.resolve();
  advanceDocumentStorageGeneration("remote-restore");
  finish();
  await expect(saved).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(queue.revisionState("a").confirmedRevision).toBe(0);
  expect(queue.pending("a")).toEqual({ title: "draft" });
});
it("clean resident targets become stale; local restores also require an explicit reload before editing", async () => {
  storage();
  const queue = new AutoSaveQueue(async () => {});
  const sessions = new DocumentEditSessions(queue);
  const owner = {};
  sessions.retain("a");
  sessions.activate("a", owner, "rendered", true);
  sessions.select("a", owner, "rendered", { from: 1, to: 1 });
  const target = sessions.capture("a");
  advanceDocumentStorageGeneration("remote-restore");
  expect(() => sessions.validate(target)).toThrow("编辑目标已变化");
  await queue.withReplacement(async () =>
    advanceDocumentStorageGeneration("local-restore"),
  );
  expect(readDocumentStorageGeneration()).toBe("local-restore");
  expect(queue.isStorageCurrent("a")).toBe(false);
  queue.discard("a"); // explicit reload / remount of the replacement document
  queue.mark("a", "title", "after local restore");
  await queue.flushAll();
  expect(queue.revisionState("a").confirmedRevision).toBe(1);
});

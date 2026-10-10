import { expect, it, vi } from "vitest";
import { AutoSaveQueue } from "../../src/lib/auto-save-queue";
import { DocumentEditSessions } from "../../src/lib/document-edit-sessions";

it("selection, view, visibility and edits invalidate targets without counting navigation as content", async () => {
  const queue = new AutoSaveQueue(async () => {});
  const views = new DocumentEditSessions(queue);
  const owner = {};
  views.retain("a");
  views.activate("a", owner, "rendered", true);
  views.select("a", owner, "rendered", { from: 1, to: 3 });
  const first = views.capture("a");
  expect(views.validate(first)).toEqual({ from: 1, to: 3 });
  views.select("a", owner, "rendered", { from: 1, to: 3 });
  expect(views.validate(first)).toEqual({ from: 1, to: 3 });
  views.select("a", owner, "rendered", { from: 2, to: 2 });
  expect(() => views.validate(first)).toThrow("编辑目标已变化");
  const second = views.capture("a");
  queue.mark("a", "title", "new title");
  expect(() => views.validate(second)).toThrow();
  const revision = queue.revisionState("a");
  const third = views.capture("a");
  views.activate("a", owner, "rendered", false);
  expect(() => views.validate(third)).toThrow();
  views.activate("a", owner, "rendered", true);
  expect(() => views.validate(third)).toThrow();
  const fourth = views.capture("a");
  views.activate("a", owner, "source", true);
  views.select("a", owner, "source", { from: 0, to: 4 });
  expect(() => views.validate(fourth)).toThrow();
  expect(queue.revisionState("a")).toEqual(revision);
  expect(() => views.validate({ ...views.capture("a") })).toThrow();
  await queue.flushAll();
});

it("retirement saves before invalidating, while StrictMode remount preserves the resident generation", async () => {
  const save = vi.fn(async () => {});
  const queue = new AutoSaveQueue(save);
  const views = new DocumentEditSessions(queue);
  const release = views.retain("a");
  const before = queue.captureRevision("a");
  release();
  const remount = views.retain("a");
  await queue.flushAll();
  expect(queue.captureRevision("a").documentGeneration).toBe(
    before.documentGeneration,
  );
  queue.mark("a", "title", "latest");
  remount();
  await queue.flushAll();
  await Promise.resolve();
  expect(save).toHaveBeenCalledWith("a", { title: "latest" });
  await vi.waitFor(() =>
    expect(queue.captureRevision("a").documentGeneration).not.toBe(
      before.documentGeneration,
    ),
  );
});

it("retirement failure preserves the pending document for retry", async () => {
  const queue = new AutoSaveQueue(async () => {
    throw new Error("disk full");
  });
  const views = new DocumentEditSessions(queue);
  const release = views.retain("a");
  queue.mark("a", "title", "unsaved");
  const before = queue.captureRevision("a");
  release();
  await expect(queue.flushAll()).rejects.toThrow("disk full");
  expect(queue.pending("a")).toEqual({ title: "unsaved" });
  expect(queue.captureRevision("a").documentGeneration).toBe(
    before.documentGeneration,
  );
});

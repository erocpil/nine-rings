import { describe, expect, it, vi } from "vitest";
import { AutoSaveQueue } from "../../src/lib/auto-save-queue";
import { SaveBarrierError } from "../../src/lib/document-save-revisions";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("document save revision barriers", () => {
  it("coalesces one editor batch but counts undo and independent metadata changes", async () => {
    const queue = new AutoSaveQueue(async () => {});
    const first = {},
      second = {};
    const value = { ops: [{ insert: "same text\n" }] };
    queue.mark("a", "content", value, first);
    queue.mark("a", "content", value, first);
    expect(queue.revisionState("a").contentRevision).toBe(1);
    queue.mark("a", "content", value, second);
    queue.mark("a", "content", value, first); // undo returns an older immutable doc
    expect(queue.revisionState("a").contentRevision).toBe(3);
    queue.mark("a", "content", value); // independent bookmark-only change
    queue.mark("a", "content", value);
    expect(queue.revisionState("a").contentRevision).toBe(5);
    await queue.flushAll();
    expect(queue.revisionState("a").confirmedRevision).toBe(5);
  });

  it("only acknowledges the frozen revision after a real successful write", async () => {
    const gate = deferred();
    const queue = new AutoSaveQueue(() => gate.promise);
    queue.mark("a", "title", "first");
    const revision = queue.captureRevision("a");
    const waiting = queue.whenSaved("a", revision);
    expect(queue.revisionState("a")).toMatchObject({
      contentRevision: 1,
      confirmedRevision: 0,
    });
    queue.mark("a", "title", "second");
    gate.resolve();
    await waiting;
    expect(queue.revisionState("a")).toMatchObject({
      contentRevision: 2,
      confirmedRevision: 1,
    });
    expect(queue.status("a")).toBe("dirty");
    await queue.whenSaved("a", queue.captureRevision("a"));
    expect(queue.revisionState("a").confirmedRevision).toBe(2);
  });

  it("returns SAVE_FAILED without advancing confirmation and supports explicit retry", async () => {
    const cause = new Error("quota");
    const save = vi
      .fn()
      .mockRejectedValueOnce(cause)
      .mockResolvedValue(undefined);
    const queue = new AutoSaveQueue(save);
    queue.mark("a", "title", "unsaved");
    const revision = queue.captureRevision("a");
    await expect(queue.whenSaved("a", revision)).rejects.toMatchObject({
      code: "SAVE_FAILED",
      cause,
    });
    expect(queue.revisionState("a").confirmedRevision).toBe(0);
    expect(save).toHaveBeenCalledTimes(1);
    await queue.whenSaved("a", revision);
    expect(queue.revisionState("a").confirmedRevision).toBe(1);
  });

  it("a successful content snapshot cannot acknowledge a failed title", async () => {
    const gate = deferred();
    const save = vi
      .fn()
      .mockImplementationOnce(() => gate.promise)
      .mockResolvedValue(undefined);
    const queue = new AutoSaveQueue(save);
    queue.mark("a", "title", "failed title");
    const title = queue.flushNote("a");
    const titleFailure = expect(title).rejects.toThrow("title failure");
    queue.mark("a", "content", { ops: [{ insert: "successful body\n" }] });
    const body = queue.flushNote("a");
    const bodyFailure = expect(body).rejects.toThrow("title failure");
    gate.reject(new Error("title failure"));
    await Promise.all([titleFailure, bodyFailure]);
    // The scheduler's recovered tail allows the body write to finish separately.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(save).toHaveBeenCalledTimes(2);
    expect(queue.revisionState("a")).toMatchObject({
      contentRevision: 2,
      confirmedRevision: 0,
    });
    await queue.whenSaved("a", queue.captureRevision("a"));
    expect(save.mock.calls[2]).toEqual(["a", { title: "failed title" }]);
    expect(queue.revisionState("a").confirmedRevision).toBe(2);
  });

  it("can cover an earlier revision using a later edited state", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const queue = new AutoSaveQueue(save);
    queue.mark("a", "title", "old");
    const old = queue.captureRevision("a");
    queue.mark("a", "title", "new");
    await queue.whenSaved("a", old);
    expect(save).toHaveBeenCalledWith("a", { title: "new" });
    expect(queue.revisionState("a").confirmedRevision).toBe(2);
  });

  it("undo back to identical text still has a new accepted revision", async () => {
    const queue = new AutoSaveQueue(async () => {});
    queue.mark("a", "title", "original");
    await queue.flushAll();
    queue.mark("a", "title", "changed");
    queue.mark("a", "title", "original");
    expect(queue.revisionState("a")).toMatchObject({
      contentRevision: 3,
      confirmedRevision: 1,
    });
    await queue.flushAll();
    expect(queue.revisionState("a").confirmedRevision).toBe(3);
  });

  it("waits for the original document while another document is being edited", async () => {
    const gate = deferred();
    const queue = new AutoSaveQueue(() => gate.promise);
    queue.mark("a", "title", "outgoing");
    const a = queue.captureRevision("a");
    const waiting = queue.whenSaved("a", a);
    queue.mark("b", "title", "active");
    gate.resolve();
    await waiting;
    expect(queue.revisionState("a").confirmedRevision).toBe(1);
    expect(queue.revisionState("b").confirmedRevision).toBe(0);
    expect(queue.status("b")).toBe("dirty");
  });

  it("rejects tokens from another document, queue, or reconstructed JSON", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const queue = new AutoSaveQueue(save);
    queue.mark("a", "title", "a");
    const token = queue.captureRevision("a");
    const other = new AutoSaveQueue(save);
    for (const request of [
      queue.whenSaved("b", token),
      other.whenSaved("a", token),
      queue.whenSaved("a", { ...token }),
    ])
      await expect(request).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(save).not.toHaveBeenCalled();
    expect(Object.isFrozen(token)).toBe(true);
  });

  it("discard immediately invalidates pending waits, before storage completes", async () => {
    const gate = deferred();
    const queue = new AutoSaveQueue(() => gate.promise);
    queue.mark("a", "title", "discard");
    const token = queue.captureRevision("a");
    const waiting = queue.whenSaved("a", token);
    await Promise.resolve();
    queue.discard("a");
    await expect(waiting).rejects.toMatchObject({ code: "STALE_REVISION" });
    const generation = queue.revisionState("a").documentGeneration;
    expect(generation).not.toBe(token.documentGeneration);
    gate.resolve();
    await queue.flushAll();
    await Promise.resolve();
    expect(queue.revisionState("a")).toMatchObject({
      contentRevision: 0,
      confirmedRevision: 0,
    });
  });

  it("discarding one document preserves another document's valid target", async () => {
    const queue = new AutoSaveQueue(async () => {});
    queue.mark("a", "title", "a");
    queue.mark("b", "title", "b");
    const a = queue.captureRevision("a"),
      b = queue.captureRevision("b");
    queue.discard("a");
    await expect(queue.whenSaved("a", a)).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
    await queue.whenSaved("b", b);
  });

  it("cancellation stops the wait while preserving the accepted write", async () => {
    const gate = deferred();
    const save = vi.fn(() => gate.promise);
    const queue = new AutoSaveQueue(save);
    queue.mark("a", "title", "keep");
    const token = queue.captureRevision("a");
    const controller = new AbortController();
    const waiting = queue.whenSaved("a", token, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ code: "CANCELLED" });
    gate.resolve();
    await queue.flushAll();
    expect(queue.revisionState("a").confirmedRevision).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("an already aborted wait does not start persistence", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const queue = new AutoSaveQueue(save);
    queue.mark("a", "title", "keep dirty");
    const controller = new AbortController();
    controller.abort();
    await expect(
      queue.whenSaved("a", queue.captureRevision("a"), controller.signal),
    ).rejects.toBeInstanceOf(SaveBarrierError);
    expect(save).not.toHaveBeenCalled();
    expect(queue.status("a")).toBe("dirty");
  });

  it("an already confirmed target does not wait for newer failed edits", async () => {
    const gate = deferred();
    const save = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => gate.promise);
    const queue = new AutoSaveQueue(save);
    queue.mark("a", "title", "saved");
    const old = queue.captureRevision("a");
    await queue.whenSaved("a", old);
    queue.mark("a", "title", "later edit");
    const later = queue.flushNote("a");
    const failed = expect(later).rejects.toThrow("later failure");
    await queue.whenSaved("a", old);
    gate.reject(new Error("later failure"));
    await failed;
    expect(queue.revisionState("a").confirmedRevision).toBe(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  AutoSaveQueue,
  type AutoSaveChanges,
} from "../../src/lib/auto-save-queue";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const content = (text: string) => ({ ops: [{ insert: `${text}\n` }] });

describe("actual auto-save queue", () => {
  it("propagates an in-flight failure to repeated flush and exit barriers", async () => {
    const write = deferred();
    const save = vi.fn(() => write.promise);
    const queue = new AutoSaveQueue(save);
    queue.mark("a", "content", content("unsaved"));
    const first = queue.flushNote("a");
    const repeated = queue.flushNote("a");
    const exit = queue.flushAll();
    const checks = [first, repeated, exit].map((p) =>
      expect(p).rejects.toThrow("disk full"),
    );
    write.reject(new Error("disk full"));
    await Promise.all(checks);
    expect(queue.status("a")).toBe("error");
    expect(queue.pending("a")).toEqual({ content: content("unsaved") });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("freezes lazy content and nested fields before a document switch", async () => {
    const gate = deferred();
    const writes: Array<[string, AutoSaveChanges]> = [];
    const queue = new AutoSaveQueue(async (id, snapshot) => {
      if (id === "blocker") await gate.promise;
      writes.push([id, snapshot]);
    });
    queue.mark("blocker", "title", "blocking");
    const blocking = queue.flushNote("blocker");
    let editor = content("original");
    const original = editor;
    const tags = ["original"];
    const read = vi.fn(() => editor);
    queue.mark("a", "content", read);
    queue.mark("a", "tags", tags);
    expect(read).not.toHaveBeenCalled();
    const outgoing = queue.flushNote("a");
    editor = content("other document");
    original.ops[0].insert = "mutated";
    tags.push("later");
    gate.resolve();
    await Promise.all([blocking, outgoing]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(writes[1]).toEqual([
      "a",
      { content: content("original"), tags: ["original"] },
    ]);
  });

  it("keeps later editing dirty when an earlier snapshot completes", async () => {
    const gate = deferred();
    const queue = new AutoSaveQueue(() => gate.promise);
    queue.mark("a", "content", content("first"));
    const first = queue.flushNote("a");
    await Promise.resolve();
    queue.mark("a", "content", content("second"));
    gate.resolve();
    await first;
    expect(queue.status("a")).toBe("dirty");
    expect(queue.pending("a")).toEqual({ content: content("second") });
  });

  it("retries failed fields without overwriting newer pending edits", async () => {
    const gate = deferred();
    const save = vi
      .fn()
      .mockImplementationOnce(() => gate.promise)
      .mockResolvedValue(undefined);
    const queue = new AutoSaveQueue(save);
    queue.mark("a", "content", content("old"));
    queue.mark("a", "title", "retained title");
    const first = queue.flushNote("a");
    const failed = expect(first).rejects.toThrow("failure");
    queue.mark("a", "content", content("new"));
    gate.reject(new Error("failure"));
    await failed;
    expect(queue.pending("a")).toEqual({
      content: content("new"),
      title: "retained title",
    });
    await queue.flushAll();
    expect(save.mock.calls[1]).toEqual([
      "a",
      { content: content("new"), title: "retained title" },
    ]);
    expect(queue.status("a")).toBe("saved");
  });

  it("serializes writes across documents and saves failed background edits on retry", async () => {
    const gate = deferred();
    const save = vi
      .fn()
      .mockImplementationOnce(() => gate.promise)
      .mockResolvedValue(undefined);
    const queue = new AutoSaveQueue(save);
    queue.mark("a", "title", "first");
    const a = queue.flushNote("a");
    const failure = expect(a).rejects.toThrow("background failure");
    queue.mark("b", "title", "second");
    const b = queue.flushNote("b");
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    gate.reject(new Error("background failure"));
    await failure;
    await b;
    expect(queue.status("b")).toBe("saved");
    expect(queue.status("a")).toBe("error");
    await queue.flushAll();
    expect(save.mock.calls).toEqual([
      ["a", { title: "first" }],
      ["b", { title: "second" }],
      ["a", { title: "first" }],
    ]);
  });

  it("does not restore failed fields that already have a newer queued snapshot", async () => {
    const gate = deferred();
    const save = vi
      .fn()
      .mockImplementationOnce(() => gate.promise)
      .mockResolvedValue(undefined);
    const queue = new AutoSaveQueue(save);
    queue.mark("a", "title", "old");
    const first = queue.flushNote("a");
    queue.mark("a", "title", "new");
    const second = queue.flushNote("a");
    const checks = [first, second].map((p) =>
      expect(p).rejects.toThrow("old failure"),
    );
    gate.reject(new Error("old failure"));
    await Promise.all(checks);
    await queue.flushAll();
    expect(queue.pending("a")).toBeNull();
    expect(queue.status("a")).toBe("saved");
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("preserves dirty readers when snapshot materialization fails", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const queue = new AutoSaveQueue(save);
    queue.mark("a", "content", () => {
      throw new Error("editor unavailable");
    });
    await expect(queue.flushAll()).rejects.toThrow("editor unavailable");
    expect(save).not.toHaveBeenCalled();
    expect(queue.status("a")).toBe("error");
    queue.mark("a", "content", () => content("retry"));
    await queue.flushAll();
    expect(save).toHaveBeenCalledWith("a", { content: content("retry") });
  });

  it("discard skips queued writes and leaves newly edited content intact", async () => {
    const gate = deferred();
    const save = vi
      .fn()
      .mockImplementationOnce(() => gate.promise)
      .mockResolvedValue(undefined);
    const queue = new AutoSaveQueue(save);
    queue.mark("blocker", "title", "blocker");
    const blocker = queue.flushNote("blocker");
    queue.mark("a", "title", "discard me");
    const old = queue.flushNote("a");
    queue.discard("a");
    expect(queue.status("a")).toBe("clean");
    queue.mark("a", "title", "external version plus edit");
    const latest = queue.flushNote("a");
    gate.resolve();
    await Promise.all([blocker, old, latest]);
    expect(save.mock.calls).toEqual([
      ["blocker", { title: "blocker" }],
      ["a", { title: "external version plus edit" }],
    ]);
    expect(queue.status("a")).toBe("saved");
  });

  it("discard prevents an already running failure from resurrecting old dirty data", async () => {
    const gate = deferred();
    const queue = new AutoSaveQueue(() => gate.promise);
    queue.mark("a", "title", "discard");
    const old = queue.flushNote("a");
    await Promise.resolve();
    queue.discard("a");
    const failed = expect(old).rejects.toThrow("late failure");
    gate.reject(new Error("late failure"));
    await failed;
    expect(queue.status("a")).toBe("clean");
    expect(queue.pending("a")).toBeNull();
  });

  it("merges queued snapshots with the latest unsaved fields for emergency backup", async () => {
    const gate = deferred();
    const queue = new AutoSaveQueue(() => gate.promise);
    queue.mark("a", "title", "title");
    const first = queue.flushNote("a");
    queue.mark("a", "content", content("body"));
    const second = queue.flushNote("a");
    queue.mark("a", "tags", ["tag"]);
    expect(queue.pending("a")).toEqual({
      title: "title",
      content: content("body"),
      tags: ["tag"],
    });
    gate.resolve();
    await Promise.all([first, second]);
    expect(queue.status("a")).toBe("dirty");
  });
});

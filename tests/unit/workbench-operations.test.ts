import { expect, it, vi } from "vitest";
import { createWorkbenchOperations } from "../../src/apps/file-workbench/operations";
import { isLocalOperationLocked } from "../../src/lib/local-files/operation-lock";
import type { BrowserOperation } from "../../src/lib/local-files/browser-operation-contract";
import type { LocalDraftStore } from "../../src/lib/local-files/recovery";

function setup() {
  const files = {
    transfer: vi.fn(async () => "dest/folder"),
    move: vi.fn(async () => "renamed"),
    create: vi.fn(async () => "created"),
    trash: vi.fn(async () => {}),
  };
  const drafts: LocalDraftStore = {
    list: vi.fn(async () => []),
    read: vi.fn(async () => null),
    write: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
  const notify = vi.fn(),
    assertActive = vi.fn();
  const operations = createWorkbenchOperations(
    { files, notify, assertActive },
    drafts,
  );
  const operation: BrowserOperation = {
    kind: "copy",
    rootId: "root",
    rootName: "Root",
    parent: "",
    nodes: ["folder"],
    targetRootId: "other",
    targetRootName: "Other",
    targetParent: "dest",
  };
  return { ...operations, files, drafts, notify, assertActive, operation };
}
it.each([
  "copy",
  "move",
  "rename",
  "batch-rename",
  "trash",
  "file",
  "directory",
] as const)(
  "standalone %s uses the shared executor, publishes mutation and releases both path locks",
  async (kind) => {
    const host = setup();
    const operation = {
      ...host.operation,
      kind,
      ...(["file", "directory"].includes(kind) ? { nodes: [] } : {}),
      ...(kind === "batch-rename" ? { names: { folder: "renamed" } } : {}),
    };
    host.queue.enqueue(operation, "renamed");
    expect(host.busy()).toBe(true);
    expect(() => host.assertIdle()).toThrow("目录操作");
    await vi.waitFor(() =>
      expect(host.queue.getSnapshot()[0].status).toBe("completed"),
    );
    expect(host.notify).toHaveBeenCalledOnce();
    expect(isLocalOperationLocked("root", "folder")).toBe(false);
    expect(isLocalOperationLocked("other", "dest/folder")).toBe(false);
    expect(host.busy()).toBe(false);
    expect(() => host.assertIdle()).not.toThrow();
    if (kind === "copy" || kind === "move")
      expect(host.files.transfer).toHaveBeenCalledWith(
        "root",
        "folder",
        "other",
        "dest",
        "folder",
        kind === "move",
      );
    host.dispose();
    expect(() => host.queue.enqueue(operation, "name")).toThrow();
  },
);
it("unresolved drafts or unavailable draft storage block filesystem mutations", async () => {
  for (const unavailable of [false, true]) {
    const host = setup();
    if (unavailable)
      vi.mocked(host.drafts.list).mockRejectedValue(
        new Error("draft storage failed"),
      );
    else
      vi.mocked(host.drafts.list).mockResolvedValue([
        { identity: "old-root:unsaved.c" } as Awaited<
          ReturnType<LocalDraftStore["list"]>
        >[number],
      ]);
    host.queue.enqueue(host.operation, "folder");
    await vi.waitFor(() =>
      expect(host.queue.getSnapshot()[0].status).toBe("failed"),
    );
    expect(host.files.transfer).not.toHaveBeenCalled();
    expect(host.notify).not.toHaveBeenCalled();
    host.dispose();
  }
});
it("a draft appearing after preflight is checked again before writing the destination", async () => {
  const host = setup();
  vi.mocked(host.drafts.list)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValue([
      { identity: "other:dest/folder/file.c" } as Awaited<
        ReturnType<LocalDraftStore["list"]>
      >[number],
    ]);
  host.queue.enqueue(host.operation, "folder");
  await vi.waitFor(() =>
    expect(host.queue.getSnapshot()[0].status).toBe("failed"),
  );
  expect(host.files.transfer).not.toHaveBeenCalled();
  expect(isLocalOperationLocked("root", "folder")).toBe(false);
  expect(isLocalOperationLocked("other", "dest/folder")).toBe(false);
  host.dispose();
});
it("a running native call stays busy after stop until it finishes; a queued job never starts", async () => {
  const host = setup();
  let finish: (() => void) | undefined;
  host.files.transfer.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = () => resolve("dest/folder");
      }),
  );
  host.queue.enqueue(host.operation, "folder");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  host.queue.enqueue({ ...host.operation, nodes: ["second"] }, "second");
  host.queue.stopAll();
  expect(host.busy()).toBe(true);
  expect(() => host.assertIdle()).toThrow();
  finish!();
  await vi.waitFor(() => expect(host.busy()).toBe(false));
  expect(host.files.transfer).toHaveBeenCalledTimes(1);
  expect(host.notify).toHaveBeenCalledOnce();
  host.dispose();
});

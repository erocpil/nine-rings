import { expect, it, vi } from "vitest";
import { BrowserOperationQueueCore } from "../../src/lib/local-files/browser-queue-core";
import { createBrowserOperationRunner } from "../../src/lib/local-files/browser-operation-core";
import type {
  BrowserOperation,
  BrowserOperationHost,
  BrowserOperationLease,
} from "../../src/lib/local-files/browser-operation-contract";

const operation: BrowserOperation = {
  kind: "copy",
  rootId: "left",
  rootName: "Left",
  parent: "src",
  nodes: ["src/a.c"],
  targetRootId: "right",
  targetRootName: "Right",
  targetParent: "dest",
};
function fixture() {
  let active = true;
  const assertActive = () => {
    if (!active) throw new Error("revoked");
  };
  const release = vi.fn();
  const files = {
    transfer: vi.fn(
      async (
        _root: string,
        node: string,
        _target: string,
        parent: string,
        name: string,
      ) => `${parent}/${name || node}`,
    ),
    move: vi.fn(async () => "src/new.c"),
    trash: vi.fn(async () => {}),
    create: vi.fn(async () => "src/new.c"),
  };
  const host: BrowserOperationHost<BrowserOperationLease> = {
    assertActive,
    assertPathClean: async () => {},
    lock: () => ({ release }),
    files,
    reconcileMove: async () => {},
    reconcileTrash: async () => {},
    notify: () => {},
  };
  const persistence = {
    key: "isolated",
    issue: "",
    capture: vi.fn(),
    dispose: vi.fn(),
  };
  const queue = new BrowserOperationQueueCore(
    { assertActive, execute: createBrowserOperationRunner(host) },
    persistence,
  );
  return {
    queue,
    files,
    persistence,
    release,
    revoke: () => {
      active = false;
    },
  };
}
const done = (queue: BrowserOperationQueueCore, index = 0) =>
  vi.waitFor(() =>
    expect(["completed", "failed", "stopped"]).toContain(
      queue.getSnapshot()[index]?.status,
    ),
  );

it("runs two isolated queues through the same executor with independent authorization and history", async () => {
  const a = fixture(),
    b = fixture();
  try {
    a.queue.enqueue(operation, "");
    b.queue.enqueue(operation, "");
    await Promise.all([done(a.queue), done(b.queue)]);
    a.revoke();
    expect(() => a.queue.enqueue(operation, "")).toThrow("revoked");
    b.queue.enqueue(operation, "");
    await done(b.queue, 1);
    expect(a.files.transfer).toHaveBeenCalledOnce();
    expect(b.files.transfer).toHaveBeenCalledTimes(2);
    expect(a.persistence.capture).toHaveBeenLastCalledWith(
      a.queue.getSnapshot(),
    );
    expect(a.queue.historyKey()).toBe("isolated");
    expect(a.queue.historyIssue()).toBe("");
  } finally {
    a.queue.dispose();
    b.queue.dispose();
  }
  expect(a.persistence.dispose).toHaveBeenCalledOnce();
});

it("freezes reviewed inputs and settles committed work on disposal without starting queued work", async () => {
  const { queue, files, release, persistence } = fixture();
  let finish!: () => void;
  files.transfer.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return "dest/a.c";
  });
  const input = { ...operation, nodes: [...operation.nodes] };
  queue.enqueue(input, "");
  queue.enqueue({ ...operation, nodes: ["src/b.c"] }, "");
  input.nodes[0] = "src/forged.c";
  await vi.waitFor(() => expect(files.transfer).toHaveBeenCalledOnce());
  expect(queue.getSnapshot()[0].operation.nodes).toEqual(["src/a.c"]);
  queue.dispose();
  finish();
  await done(queue);
  expect(queue.getSnapshot().map((job) => job.status)).toEqual([
    "stopped",
    "stopped",
  ]);
  expect(queue.getSnapshot()[0].items[0].status).toBe("completed");
  expect(files.transfer).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
  expect(persistence.capture).toHaveBeenLastCalledWith(queue.getSnapshot());
  expect(() => queue.enqueue(operation, "")).toThrow("已关闭");
});

it("requires explicit conflict decisions and excludes uncertain writes from retries", async () => {
  const { queue, files } = fixture();
  try {
    files.transfer.mockRejectedValueOnce(new Error("TARGET_EXISTS"));
    const id = queue.enqueue(operation, "");
    await vi.waitFor(() =>
      expect(queue.getSnapshot()[0].status).toBe("waiting"),
    );
    queue.decide(id, { action: "rename", name: "new.c" });
    await done(queue);
    expect(files.transfer.mock.calls[1][4]).toBe("new.c");
    files.transfer.mockRejectedValueOnce(
      new Error("uncertain filesystem state"),
    );
    const failed = queue.enqueue(operation, "");
    await done(queue, 1);
    expect(queue.isPaused()).toBe(true);
    expect(queue.getSnapshot()[1].items[0].status).toBe("uncertain");
    expect(() => queue.retry(failed)).toThrow("需核对项不能直接重试");
  } finally {
    queue.dispose();
  }
});

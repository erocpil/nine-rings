import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  BrowserOperationQueue,
  getBrowserOperationQueue,
  browserQueueReport,
} from "../../src/lib/local-files/browser-operation-queue";
import { pluginRuntime } from "../../src/lib/plugin-system/runtime";
import { workspacePanels } from "../../src/lib/plugin-system/panel-registry";
import * as environment from "../../src/lib/runtime";
import { localFileService } from "../../src/lib/local-files/service";
import {
  clearLocalFileSessions,
  setLocalFileDirty,
} from "../../src/lib/local-files/session";
import { assertLocalPathClean } from "../../src/lib/local-files/operations";
import {
  lockLocalOperation,
  isLocalOperationLocked,
  subscribeLocalOperationLocks,
} from "../../src/lib/local-files/operation-lock";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import {
  runBrowserOperation,
  type BrowserOperation,
} from "../../src/lib/local-files/browser-operations";

const operation = (nodes = ["src/a.c", "src/b.c"]): BrowserOperation => ({
  kind: "copy",
  rootId: "left",
  rootName: "Left",
  parent: "src",
  nodes,
  targetRootId: "right",
  targetRootName: "Right",
  targetParent: "dest",
});
const owner = () => {
  pluginRuntime.setEnabled(true);
  return pluginRuntime.activate("test.queue", [
    "filesystem.files.read",
    "filesystem.files.write",
  ]);
};
const queues: BrowserOperationQueue[] = [];
const create = () => {
  const queue = new BrowserOperationQueue(owner());
  queues.push(queue);
  return queue;
};
const done = (queue: BrowserOperationQueue, index = 0) =>
  vi.waitFor(() =>
    expect(["completed", "failed", "stopped"]).toContain(
      queue.getSnapshot()[index]?.status,
    ),
  );
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
});
afterEach(() => {
  queues.splice(0).forEach((queue) => queue.dispose());
  pluginRuntime.setEnabled(false);
  clearLocalFileSessions();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("freezes confirmed inputs and executes jobs serially with stable snapshots", async () => {
  const queue = create();
  let finish!: () => void;
  const transfer = vi
    .spyOn(localFileService, "transfer")
    .mockImplementation(async (_root, node) => {
      if (node === "src/a.c")
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      return `dest/${node.split("/").pop()}`;
    });
  const input = operation(["src/a.c"]);
  queue.enqueue(input, "");
  queue.enqueue(operation(["src/b.c"]), "");
  input.nodes[0] = "src/forged.c";
  input.targetRootId = "elsewhere";
  await vi.waitFor(() => expect(transfer).toHaveBeenCalledTimes(1));
  expect(queue.getSnapshot()[1].status).toBe("queued");
  expect(queue.getSnapshot()).toBe(queue.getSnapshot());
  finish();
  await done(queue, 1);
  expect(transfer.mock.calls.map((call) => [call[1], call[2]])).toEqual([
    ["src/a.c", "right"],
    ["src/b.c", "right"],
  ]);
  expect(
    queue.getSnapshot().every((job) => job.items[0].status === "completed"),
  ).toBe(true);
  expect(browserQueueReport(queue.getSnapshot())).toContain("Left/src");
  expect(browserQueueReport(queue.getSnapshot())).toContain("Right/dest");
});
it("stops at item boundaries and retries only unfinished items", async () => {
  const queue = create();
  let finish!: () => void;
  const transfer = vi
    .spyOn(localFileService, "transfer")
    .mockImplementation(async (_root, node) => {
      if (node === "src/a.c")
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      return `dest/${node.split("/").pop()}`;
    });
  const first = queue.enqueue(operation(), ""),
    second = queue.enqueue(operation(["src/c.c"]), "");
  await vi.waitFor(() => expect(transfer).toHaveBeenCalledTimes(1));
  queue.stop(first);
  queue.stop(second);
  finish();
  await done(queue);
  expect(queue.getSnapshot()[0].progress.completed).toBe(1);
  expect(queue.getSnapshot()[1].status).toBe("stopped");
  queue.retry(first);
  expect(() => queue.retry(first)).toThrow("已加入");
  await done(queue, 2);
  expect(transfer.mock.calls.map((call) => call[1])).toEqual([
    "src/a.c",
    "src/b.c",
  ]);
  expect(isLocalOperationLocked("left", "src")).toBe(false);
});
it("pauses after uncertain writes and excludes them and completed items from retries", async () => {
  const queue = create();
  const transfer = vi
    .spyOn(localFileService, "transfer")
    .mockImplementation(async (_root, node) => {
      if (node === "src/b.c")
        throw new Error("disk failure after write started");
      return `dest/${node.split("/").pop()}`;
    });
  const id = queue.enqueue(operation(["src/a.c", "src/b.c", "src/c.c"]), "");
  queue.enqueue(operation(["src/d.c"]), "");
  await done(queue);
  expect(queue.isPaused()).toBe(true);
  expect(queue.getSnapshot()[1].status).toBe("queued");
  expect(queue.getSnapshot()[0].items.map((item) => item.status)).toEqual([
    "completed",
    "uncertain",
    "pending",
  ]);
  queue.retry(id);
  queue.resume();
  await done(queue, 2);
  expect(transfer.mock.calls.map((call) => call[1])).toEqual([
    "src/a.c",
    "src/b.c",
    "src/d.c",
    "src/c.c",
  ]);
  expect(browserQueueReport(queue.getSnapshot())).toContain("disk failure");
  expect(() => queue.retry(queue.getSnapshot()[1].id)).toThrow("没有可重试");
  queue.clearFinished();
  expect(queue.getSnapshot()).toHaveLength(0);
});
it("rechecks dirty sources at execution time and can retry after drafts are resolved", async () => {
  const queue = create();
  const transfer = vi
    .spyOn(localFileService, "transfer")
    .mockImplementation(async (_root, node) => {
      if (node === "src/a.c") setLocalFileDirty("left:src/b.c", true);
      return `dest/${node.split("/").pop()}`;
    });
  const id = queue.enqueue(operation(), "");
  await done(queue);
  expect(transfer).toHaveBeenCalledTimes(1);
  expect(queue.getSnapshot()[0].items[1].status).toBe("failed");
  expect(queue.getSnapshot()[0].error).toContain("恢复草稿");
  setLocalFileDirty("left:src/b.c", false);
  queue.retry(id);
  queue.resume();
  await done(queue, 1);
  expect(transfer.mock.calls.map((call) => call[1])).toEqual([
    "src/a.c",
    "src/b.c",
  ]);
});
it("keeps conflicts in the queue for explicit skip or renamed retry", async () => {
  const queue = create();
  const transfer = vi
    .spyOn(localFileService, "transfer")
    .mockImplementation(async (_root, _node, _target, _parent, name) => {
      if (name !== "new.c") throw new Error("TARGET_EXISTS");
      return "dest/new.c";
    });
  const id = queue.enqueue(operation(), "");
  await vi.waitFor(() => expect(queue.getSnapshot()[0].conflict).toBe("a.c"));
  queue.decide(-1, { action: "stop" });
  expect(queue.getSnapshot()[0].status).toBe("waiting");
  queue.decide(id, { action: "skip" });
  await vi.waitFor(() => expect(queue.getSnapshot()[0].conflict).toBe("b.c"));
  queue.decide(id, { action: "rename", name: "new.c" });
  await done(queue);
  expect(queue.getSnapshot()[0].items.map((item) => item.status)).toEqual([
    "skipped",
    "completed",
  ]);
  expect(queue.getSnapshot()[0].progress).toMatchObject({
    completed: 1,
    skipped: 1,
  });
  expect(transfer).toHaveBeenCalledTimes(3);
});
it("bounds queued work and never evicts pending jobs", async () => {
  const queue = create();
  setLocalFileDirty("left:src/a.c", true);
  queue.enqueue(operation(["src/a.c"]), "");
  await done(queue);
  for (let index = 0; index < 20; index++)
    queue.enqueue(operation([`src/${index}.c`]), "");
  expect(queue.getSnapshot()).toHaveLength(20);
  expect(queue.getSnapshot().every((job) => job.status === "queued")).toBe(
    true,
  );
  expect(() => queue.enqueue(operation(["src/overflow.c"]), "")).toThrow(
    "已满",
  );
  expect(() =>
    queue.enqueue(
      operation(Array.from({ length: 2001 }, (_, i) => `src/${i}.c`)),
      "",
    ),
  ).toThrow("2000");
  queue.stopAll();
  expect(queue.getSnapshot().every((job) => job.status === "stopped")).toBe(
    true,
  );
});
it("shares an activation queue, disposes on revocation and releases an awaiting conflict", async () => {
  const activation = owner(),
    queue = getBrowserOperationQueue(activation);
  expect(getBrowserOperationQueue(activation)).toBe(queue);
  vi.spyOn(localFileService, "transfer").mockRejectedValue(
    new Error("TARGET_EXISTS"),
  );
  queue.enqueue(operation(), "");
  await vi.waitFor(() => expect(queue.getSnapshot()[0].status).toBe("waiting"));
  pluginRuntime.deactivate(activation.pluginId);
  await done(queue);
  expect(isLocalOperationLocked("left", "src/a.c")).toBe(false);
  expect(() => queue.enqueue(operation(), "")).toThrow("已关闭");
});
it("locks affected editors transiently without changing read-only preferences", async () => {
  const listener = vi.fn(),
    unsubscribe = subscribeLocalOperationLocks(listener);
  const lease = lockLocalOperation("left", "src");
  expect(isLocalOperationLocked("left", "src/a.c")).toBe(true);
  expect(isLocalOperationLocked("left", "src2/a.c")).toBe(false);
  expect(isLocalOperationLocked("right", "src/a.c")).toBe(false);
  expect(() => lockLocalOperation("left", "src/a.c")).toThrow("正在执行");
  await expect(assertLocalPathClean("left", "src/a.c")).rejects.toThrow(
    "正在执行",
  );
  await assertLocalPathClean("left", "src/a.c", lease);
  await expect(
    localFileService.write("left", "src/a.c", "text", {} as never),
  ).rejects.toThrow("正在执行");
  expect(localStorage.getItem("nr:local-file-readonly-rules")).toBeNull();
  lease.release();
  lease.release();
  unsubscribe();
  expect(listener).toHaveBeenCalledTimes(2);
});
it("result observer failures do not turn completed filesystem operations into failures", async () => {
  const activation = owner();
  vi.spyOn(localFileService, "transfer").mockResolvedValue("dest/a.c");
  const result = await runBrowserOperation(
    activation,
    operation(["src/a.c"]),
    "",
    new AbortController().signal,
    () => {},
    async () => ({ action: "stop" }),
    () => {
      throw new Error("observer");
    },
  );
  expect(result.completed).toBe(1);
});

it("isolates queue observers and clears only finished jobs", async () => {
  const queue = create(),
    observer = vi.fn();
  const stopThrowing = queue.subscribe(() => {
    throw new Error("observer");
  });
  const unsubscribe = queue.subscribe(observer);
  vi.spyOn(localFileService, "create").mockResolvedValue("src/new.txt");
  const id = queue.enqueue({ ...operation([]), kind: "file" }, "new.txt");
  expect(() => queue.retry(id)).toThrow("尚未结束");
  queue.clearFinished();
  expect(queue.getSnapshot()).toHaveLength(1);
  await done(queue);
  expect(queue.getSnapshot()[0].items[0]).toMatchObject({
    node: "",
    targetName: "new.txt",
    status: "completed",
  });
  expect(browserQueueReport(queue.getSnapshot())).toContain("new.txt");
  expect(observer).toHaveBeenCalled();
  unsubscribe();
  stopThrowing();
  const calls = observer.mock.calls.length;
  queue.clearFinished();
  expect(observer).toHaveBeenCalledTimes(calls);
  queue.stop(id);
  queue.stop(-1);
  queue.decide(id, { action: "stop" });
  queue.dispose();
  queue.dispose();
  queue.resume();
});
it("bounds total retained item rows even with few large queued jobs", async () => {
  const queue = create();
  setLocalFileDirty("left:src/a.c", true);
  queue.enqueue(operation(["src/a.c"]), "");
  await done(queue);
  for (let group = 0; group < 4; group++)
    queue.enqueue(
      operation(
        Array.from({ length: 1000 }, (_, index) => `src/${group}-${index}.c`),
      ),
      "",
    );
  expect(
    queue.getSnapshot().reduce((sum, job) => sum + job.items.length, 0),
  ).toBe(4000);
  expect(() => queue.enqueue(operation(["src/extra.c"]), "")).toThrow("已满");
});
it("batch retry retains the reviewed names and does not retry an uncertain single item", async () => {
  const queue = create();
  setLocalFileDirty("left:src/a.c", true);
  const move = vi
    .spyOn(localFileService, "move")
    .mockImplementation(
      async (_root, _node, parent, name) => `${parent}/${name}`,
    );
  const id = queue.enqueue(
    {
      ...operation(),
      kind: "batch-rename",
      names: { "src/a.c": "1-a.c", "src/b.c": "2-b.c" },
    },
    "",
  );
  await done(queue);
  setLocalFileDirty("left:src/a.c", false);
  queue.retry(id);
  queue.resume();
  await done(queue, 1);
  expect(move.mock.calls.map((call) => call[3])).toEqual(["1-a.c", "2-b.c"]);
  vi.spyOn(localFileService, "transfer").mockRejectedValue(
    new Error("unknown"),
  );
  const uncertain = queue.enqueue(operation(["src/unknown.c"]), "");
  await done(queue, 2);
  expect(() => queue.retry(uncertain)).toThrow("需核对项不能直接重试");
});

it("blocks a path mutation during an in-flight save and releases the save guard on success or failure", async () => {
  pluginRuntime.setEnabled(true);
  const activation = pluginRuntime.activate("test.save", [
    "panels.present",
    "filesystem.files.read",
    "filesystem.files.write",
  ]);
  workspacePanels.register(activation, {
    id: "browser",
    label: "双栏",
    icon: "compare",
    renderer: "file-browser",
  });
  vi.spyOn(environment, "isTauriRuntime").mockReturnValue(true);
  const base = {
    source: "old",
    revision: "r1",
    bom: false,
    lineEnding: "lf" as const,
    modifiedMs: 1,
    size: 3,
  };
  let finish!: (value: typeof base) => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = localFileService.write("left", "src/a.c", "new", base);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(isLocalOperationLocked("left", "src/a.c")).toBe(false);
  expect(() => lockLocalOperation("left", "src")).toThrow("正在保存");
  await expect(assertLocalPathClean("left", "src/a.c")).rejects.toThrow(
    "正在保存",
  );
  finish({ ...base, source: "new" });
  await pending;
  lockLocalOperation("left", "src").release();
  invoke.mockRejectedValueOnce(new Error("write failed"));
  await expect(
    localFileService.write("left", "src/a.c", "new", base),
  ).rejects.toThrow("write failed");
  lockLocalOperation("left", "src").release();
  await expect(
    localFileService.write("left", "src/a.c", "new", {
      ...base,
      lineEnding: "mixed",
    }),
  ).rejects.toThrow("混合换行");
  lockLocalOperation("left", "src").release();
});

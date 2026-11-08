import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pluginRuntime } from "../../src/lib/plugin-system/runtime";
import { EditorState } from "@codemirror/state";
import {
  readLocalFocusTabs,
  saveLocalFocusTabs,
} from "../../src/lib/focus-tabs";
import { localFileService } from "../../src/lib/local-files/service";
import {
  runBrowserOperation,
  type BrowserOperation,
  type BrowserProgress,
} from "../../src/lib/local-files/browser-operations";
import {
  clearLocalFileSessions,
  localFileSessions,
  setLocalFileDirty,
} from "../../src/lib/local-files/session";
import { readRecentLocalFiles } from "../../src/lib/local-files/recent";
import {
  emptyBrowserState,
  navigateBrowserPane,
  reconcileBrowserMutation,
} from "../../src/lib/local-files/browser-state";

let values: Map<string, string>;
const operation: BrowserOperation = {
  kind: "copy",
  rootId: "left",
  rootName: "Left",
  parent: "src",
  nodes: ["src/a.c", "src/b.c"],
  targetRootId: "right",
  targetRootName: "Right",
  targetParent: "dest",
};
const activate = () => {
  pluginRuntime.setEnabled(true);
  return pluginRuntime.activate("test.browser.ops", [
    "filesystem.files.read",
    "filesystem.files.write",
  ]);
};
beforeEach(() => {
  values = new Map();
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
  setLocalFileDirty("left:src/a.c", false);
  clearLocalFileSessions();
  pluginRuntime.setEnabled(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("retries a same-name conflict with a new name without replacing other targets", async () => {
  const owner = activate(),
    progress: BrowserProgress[] = [];
  const transfer = vi
    .spyOn(localFileService, "transfer")
    .mockRejectedValueOnce(new Error("TARGET_EXISTS"))
    .mockResolvedValueOnce("dest/other.c")
    .mockResolvedValueOnce("dest/b.c");
  const decide = vi.fn(async () => ({
    action: "rename" as const,
    name: "other.c",
  }));
  const result = await runBrowserOperation(
    owner,
    operation,
    "",
    new AbortController().signal,
    (value) => progress.push(value),
    decide,
  );
  expect(result).toMatchObject({ completed: 2, skipped: 0, cancelled: false });
  expect(transfer.mock.calls.map((args) => args[4])).toEqual([
    "a.c",
    "other.c",
    "b.c",
  ]);
  expect(transfer.mock.calls[0]).toEqual([
    "left",
    "src/a.c",
    "right",
    "dest",
    "a.c",
    false,
  ]);
  expect(progress.at(-1)?.completed).toBe(2);
});
it("skip and stop decisions preserve completed writes and never overwrite", async () => {
  const owner = activate();
  const transfer = vi
    .spyOn(localFileService, "transfer")
    .mockRejectedValue(new Error("TARGET_EXISTS"));
  const skip = await runBrowserOperation(
    owner,
    operation,
    "",
    new AbortController().signal,
    () => {},
    async () => ({ action: "skip" }),
  );
  expect(skip).toMatchObject({ completed: 0, skipped: 2 });
  transfer.mockClear();
  const stop = await runBrowserOperation(
    owner,
    operation,
    "",
    new AbortController().signal,
    () => {},
    async () => ({ action: "stop" }),
  );
  expect(stop.cancelled).toBe(true);
  expect(transfer).toHaveBeenCalledTimes(1);
});
it("cancellation during a write accepts its completion then starts no next item", async () => {
  const owner = activate(),
    controller = new AbortController();
  const transfer = vi
    .spyOn(localFileService, "transfer")
    .mockImplementation(async () => {
      controller.abort();
      return "dest/a.c";
    });
  const result = await runBrowserOperation(
    owner,
    operation,
    "",
    controller.signal,
    () => {},
    async () => ({ action: "stop" }),
  );
  expect(result).toMatchObject({ completed: 1, cancelled: true });
  expect(transfer).toHaveBeenCalledTimes(1);
});
it("refuses dirty sources and forged selections before touching the filesystem", async () => {
  const owner = activate(),
    transfer = vi.spyOn(localFileService, "transfer");
  setLocalFileDirty("left:src/a.c", true);
  await expect(
    runBrowserOperation(
      owner,
      operation,
      "",
      new AbortController().signal,
      () => {},
      async () => ({ action: "stop" }),
    ),
  ).rejects.toThrow("恢复草稿");
  setLocalFileDirty("left:src/a.c", false);
  await expect(
    runBrowserOperation(
      owner,
      { ...operation, nodes: ["elsewhere/a.c"] },
      "",
      new AbortController().signal,
      () => {},
      async () => ({ action: "stop" }),
    ),
  ).rejects.toThrow("不属于");
  expect(transfer).not.toHaveBeenCalled();
});
it("revocation between completed items prevents subsequent filesystem work", async () => {
  const owner = activate(),
    transfer = vi
      .spyOn(localFileService, "transfer")
      .mockImplementation(async () => {
        pluginRuntime.deactivate(owner.pluginId);
        return "dest/a.c";
      });
  await expect(
    runBrowserOperation(
      owner,
      operation,
      "",
      new AbortController().signal,
      () => {},
      async () => ({ action: "stop" }),
    ),
  ).rejects.toThrow();
  expect(transfer).toHaveBeenCalledTimes(1);
});
it("moves positions, bookmarks, recents and tabs across root identities", async () => {
  saveLocalFocusTabs({ order: ["left:src/a.c", "left:src2/a.c"], closed: [] });
  const session = {
    state: EditorState.create({ doc: "A" }),
    source: "A",
    scrollTop: 420,
    scrollLeft: 0,
  };
  localFileSessions.set("left:src/a.c", session);
  values.set("nr:local-file-bookmarks:left:src/a.c", "bookmarks");
  values.set(
    "nr:local-file-positions",
    JSON.stringify({
      "left:src/a.c": { top: 420 },
      "left:src2/a.c": { top: 12 },
    }),
  );
  values.set(
    "nr:local-file-recent",
    JSON.stringify([
      {
        rootId: "left",
        rootName: "Left",
        nodeId: "src/a.c",
        name: "a.c",
        openedAt: 20,
      },
    ]),
  );
  const owner = activate();
  vi.spyOn(localFileService, "transfer").mockResolvedValue("dest/a.c");
  await runBrowserOperation(
    owner,
    { ...operation, kind: "move", nodes: ["src/a.c"] },
    "",
    new AbortController().signal,
    () => {},
    async () => ({ action: "stop" }),
  );
  expect(values.get("nr:local-file-bookmarks:right:dest/a.c")).toBe(
    "bookmarks",
  );
  expect(values.has("nr:local-file-bookmarks:left:src/a.c")).toBe(false);
  expect(JSON.parse(values.get("nr:local-file-positions")!)).toEqual({
    "right:dest/a.c": { top: 420 },
    "left:src2/a.c": { top: 12 },
  });
  expect(readRecentLocalFiles()[0]).toMatchObject({
    rootId: "right",
    rootName: "Right",
    nodeId: "dest/a.c",
  });
  expect(readLocalFocusTabs().order).toEqual([
    "right:dest/a.c",
    "left:src2/a.c",
  ]);
  expect(localFileSessions.get("right:dest/a.c")).toBe(session);
  expect(localFileSessions.has("left:src/a.c")).toBe(false);
});
it("a later transfer error preserves earlier progress and never retries completed work", async () => {
  const owner = activate(),
    progress: BrowserProgress[] = [];
  const transfer = vi
    .spyOn(localFileService, "transfer")
    .mockResolvedValueOnce("dest/a.c")
    .mockRejectedValueOnce(new Error("disk full"));
  await expect(
    runBrowserOperation(
      owner,
      operation,
      "",
      new AbortController().signal,
      (value) => progress.push(value),
      async () => ({ action: "stop" }),
    ),
  ).rejects.toThrow("disk full");
  expect(transfer).toHaveBeenCalledTimes(2);
  expect(progress.at(-1)?.completed).toBe(1);
});

it("a published cross-device copy cannot be mistaken for a retryable name conflict", async () => {
  const activation = activate();
  const transfer = vi
    .spyOn(localFileService, "transfer")
    .mockRejectedValue(
      new Error(
        "MOVE_COPY_PUBLISHED: 目标副本已发布；TARGET_EXISTS: 来源未确认移至回收站",
      ),
    );
  const conflict = vi.fn(async () => ({
    action: "rename" as const,
    name: "another.c",
  }));
  const items: Array<{ status: string }> = [];
  await expect(
    runBrowserOperation(
      activation,
      { ...operation, kind: "move" },
      "",
      new AbortController().signal,
      () => {},
      conflict,
      (value) => items.push(value),
    ),
  ).rejects.toThrow("MOVE_COPY_PUBLISHED");
  expect(transfer).toHaveBeenCalledTimes(1);
  expect(conflict).not.toHaveBeenCalled();
  expect(items.at(-1)?.status).toBe("uncertain");
  expect(readRecentLocalFiles()).toHaveLength(0);
});
it("batch rename uses the reviewed targets and refuses name swaps before any mutation", async () => {
  const owner = activate(),
    move = vi
      .spyOn(localFileService, "move")
      .mockImplementation(
        async (_root, _node, parent, name) => `${parent}/${name}`,
      );
  const plan = {
    ...operation,
    kind: "batch-rename" as const,
    names: { "src/a.c": "1-a.c", "src/b.c": "2-b.c" },
  };
  const result = await runBrowserOperation(
    owner,
    plan,
    "",
    new AbortController().signal,
    () => {},
    async () => ({ action: "stop" }),
  );
  expect(result.completed).toBe(2);
  expect(move.mock.calls.map((args) => args[3])).toEqual(["1-a.c", "2-b.c"]);
  move.mockClear();
  await expect(
    runBrowserOperation(
      owner,
      { ...plan, names: { "src/a.c": "b.c", "src/b.c": "a.c" } },
      "",
      new AbortController().signal,
      () => {},
      async () => ({ action: "stop" }),
    ),
  ).rejects.toThrow("占用");
  expect(move).not.toHaveBeenCalled();
});
it("updates the other pane inside a moved directory and removes deleted history", () => {
  let state = emptyBrowserState();
  state.panes[1] = navigateBrowserPane(state.panes[1], "left", "src/nested");
  state = reconcileBrowserMutation(state, {
    kind: "move",
    rootId: "left",
    node: "src",
    targetRootId: "right",
    targetNode: "dest",
  });
  expect(state.panes[1].history[0]).toMatchObject({
    rootId: "right",
    node: "dest/nested",
  });
  state = reconcileBrowserMutation(state, {
    kind: "trash",
    rootId: "right",
    node: "dest",
  });
  expect(state.panes[1].history).toEqual([]);
});
it("uses the existing create, rename and system trash services", async () => {
  const owner = activate();
  const create = vi
    .spyOn(localFileService, "create")
    .mockResolvedValue("src/new.c");
  const move = vi
    .spyOn(localFileService, "move")
    .mockResolvedValue("src/new.c");
  const trash = vi.spyOn(localFileService, "trash").mockResolvedValue();
  await runBrowserOperation(
    owner,
    { ...operation, kind: "file", nodes: [] },
    "new.c",
    new AbortController().signal,
    () => {},
    async () => ({ action: "stop" }),
  );
  expect(create).toHaveBeenCalledWith("left", "src", "new.c", false);
  await runBrowserOperation(
    owner,
    { ...operation, kind: "rename", nodes: ["src/a.c"] },
    "new.c",
    new AbortController().signal,
    () => {},
    async () => ({ action: "stop" }),
  );
  expect(move).toHaveBeenCalledWith("left", "src/a.c", "src", "new.c");
  await runBrowserOperation(
    owner,
    { ...operation, kind: "trash" },
    "",
    new AbortController().signal,
    () => {},
    async () => ({ action: "stop" }),
  );
  expect(trash).toHaveBeenCalledTimes(2);
});

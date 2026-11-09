import { afterEach, expect, it, vi } from "vitest";
import {
  createWorkbenchHost,
  WORKBENCH_ID,
} from "../../src/apps/file-workbench/host";
import { browserSettings } from "../../src/lib/local-files/browser-settings";
import {
  readBrowserFavorites,
  saveBrowserFavorites,
} from "../../src/lib/local-files/browser-preferences";
import { localFileService } from "../../src/lib/local-files/service";
import { pluginRuntime } from "../../src/lib/plugin-system/runtime";
import type { BrowserOperation } from "../../src/lib/local-files/browser-operation-contract";

function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  return values;
}
afterEach(() => {
  pluginRuntime.deactivate(WORKBENCH_ID);
  pluginRuntime.setEnabled(false);
  localFileService.release();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("separates workspace state, columns, favorites and theme from Nine Rings keys", () => {
  const values = storage();
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  const nr = browserSettings(),
    workbench = browserSettings("file-workbench:");
  for (const key of [
    "nr:local-file-browser",
    "nr:file-browser-columns:0",
    "dark",
  ]) {
    nr.setItem(key, "original");
    workbench.setItem(key, "independent");
    expect(nr.getItem(key)).toBe("original");
    expect(workbench.getItem(key)).toBe("independent");
  }
  saveBrowserFavorites([{ rootId: "original", node: "docs" }]);
  saveBrowserFavorites([{ rootId: "separate", node: "src" }], workbench);
  expect(readBrowserFavorites()).toEqual([
    { rootId: "original", node: "docs" },
  ]);
  expect(readBrowserFavorites(workbench)).toEqual([
    { rootId: "separate", node: "src" },
  ]);
  expect(values.has("nr:file-browser-favorites")).toBe(true);
});

it("delegates authorized reads to the shared provider and rejects direct write calls", async () => {
  storage();
  const opened = vi.fn(),
    { workspace, dispose } = createWorkbenchHost(opened);
  const stat = vi
    .spyOn(localFileService, "stat")
    .mockResolvedValue({ size: 3, modifiedMs: 1 });
  const controller = new AbortController();
  try {
    expect(
      await workspace.provider.properties("root", "a.c", controller.signal),
    ).toEqual({ size: 3, modifiedMs: 1 });
    expect(stat).toHaveBeenCalledWith("root", "a.c");
    const node = { id: "a.c", name: "a.c", directory: false, size: 3 };
    await workspace.provider.open("root", "Root", node, controller.signal);
    expect(opened).toHaveBeenCalledWith({
      rootId: "root",
      rootName: "Root",
      node,
    });
    expect(workspace.canWrite("root")).toBe(false);
    expect(workspace.canTrash()).toBe(false);
    expect(workspace.canTransfer()).toBe(false);
    const operation: BrowserOperation = {
      kind: "file",
      nodes: [],
      parent: "",
      rootId: "root",
      rootName: "Root",
      targetRootId: "root",
      targetRootName: "Root",
      targetParent: "",
    };
    expect(() => workspace.queue.enqueue(operation, "new.c")).toThrow("只读");
    const owner = pluginRuntime
      .getStatus()
      .activations.find((value) => value.pluginId === WORKBENCH_ID);
    expect(owner?.permissions).not.toContain("filesystem.files.write");
  } finally {
    dispose();
  }
  await expect(
    workspace.provider.properties("root", "a.c", controller.signal),
  ).rejects.toThrow();
  expect(stat).toHaveBeenCalledOnce();
  dispose();
});

it("rejects an aborted open before presenting anything", async () => {
  const opened = vi.fn(),
    { workspace, dispose } = createWorkbenchHost(opened),
    controller = new AbortController();
  controller.abort();
  try {
    await expect(
      workspace.provider.open(
        "root",
        "Root",
        { id: "a.c", name: "a.c", directory: false, size: 0 },
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(opened).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});

it("opens a real read-only snapshot with the existing grant service, then revokes it on shutdown", async () => {
  storage();
  const { workspace, dispose } = createWorkbenchHost(() => {});
  const file = new File(["hello"], "guide.md", { type: "text/markdown" });
  Object.defineProperty(file, "webkitRelativePath", {
    value: "Docs/sub/guide.md",
  });
  const root = workspace.addFiles([file]);
  expect(root?.name).toBe("Docs");
  try {
    expect(await workspace.roots()).toEqual([root]);
    const page = await workspace.provider.page(
      root!.id,
      "sub",
      0,
      { sort: "name", showHidden: false, query: "" },
      new AbortController().signal,
    );
    expect(page.nodes.map((node) => node.id)).toEqual(["sub/guide.md"]);
    expect(await workspace.displayPath(root!.id, "sub/guide.md")).toBe(
      "Docs/sub/guide.md",
    );
    expect(workspace.supportsDirectoryChanges(root!.id)).toBe(false);
    expect(workspace.canWrite(root!.id)).toBe(false);
    const target = new EventTarget();
    vi.stubGlobal(
      "window",
      Object.assign(target, {
        showDirectoryPicker: async () => {
          throw new DOMException("cancelled", "AbortError");
        },
      }),
    );
    expect(workspace.supportsDirectoryPicker()).toBe(true);
    expect(await workspace.choose()).toBeNull();
    expect(await workspace.roots()).toEqual([root]);
    const listener = vi.fn(),
      unsubscribe = workspace.subscribeMutations(listener);
    target.dispatchEvent(new Event("nr:file-browser-mutation"));
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    await expect(
      localFileService.create(root!.id, "", "forbidden", false),
    ).rejects.toThrow();
  } finally {
    dispose();
  }
  await expect(workspace.roots()).rejects.toThrow();
});

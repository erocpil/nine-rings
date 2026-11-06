import { expect, it, vi } from "vitest";
import {
  addBrowserTab,
  activeBrowserPanes,
  parseBrowserWorkspace,
  updateBrowserTab,
  selectBrowserTab,
  reconcileBrowserTabs,
} from "../../src/lib/local-files/browser-tabs";
import {
  browserLocation,
  emptyBrowserState,
  navigateBrowserPane,
  updateBrowserLocation,
} from "../../src/lib/local-files/browser-state";
import {
  compareBrowserDirectories,
  planBrowserRename,
} from "../../src/lib/local-files/browser-tools";
import type { FileNode } from "../../src/lib/local-files/service";

it("migrates legacy panes, keeps independent tab histories and closes without losing the remaining tab", () => {
  const old = emptyBrowserState();
  old.panes[0] = updateBrowserLocation(
    navigateBrowserPane(old.panes[0], "r", "src"),
    { scrollTop: 350, selected: ["src/a.c"] },
  );
  let state = parseBrowserWorkspace(JSON.stringify(old));
  expect(browserLocation(activeBrowserPanes(state)[0])?.scrollTop).toBe(350);
  state = addBrowserTab(state, 0);
  expect(browserLocation(activeBrowserPanes(state)[0])?.selected).toEqual([]);
  state = updateBrowserTab(state, 0, (tab) =>
    navigateBrowserPane(tab, "r", "docs"),
  );
  state = selectBrowserTab(state, 0, 0);
  expect(browserLocation(activeBrowserPanes(state)[0])).toMatchObject({
    node: "src",
    scrollTop: 350,
    selected: ["src/a.c"],
  });
  state = parseBrowserWorkspace(JSON.stringify(state));
  state = selectBrowserTab(state, 0, 1);
  expect(browserLocation(activeBrowserPanes(state)[0])?.node).toBe("docs");
  state = selectBrowserTab(state, 0, 0, true);
  expect(browserLocation(activeBrowserPanes(state)[0])?.node).toBe("docs");
  expect(selectBrowserTab(state, 0, 0, true)).toBe(state);
});
it("bounds tab state and migrates inactive tabs on directory moves", () => {
  let state = updateBrowserTab(parseBrowserWorkspace(null), 0, (tab) =>
    navigateBrowserPane(tab, "r", "src/nested"),
  );
  state = addBrowserTab(state, 0);
  state = reconcileBrowserTabs(state, {
    kind: "move",
    rootId: "r",
    node: "src",
    targetRootId: "s",
    targetNode: "lib",
  });
  expect(state.groups[0].tabs.map((tab) => browserLocation(tab))).toEqual([
    expect.objectContaining({ rootId: "s", node: "lib/nested" }),
    expect.objectContaining({ rootId: "s", node: "lib/nested" }),
  ]);
  for (let index = 0; index < 40; index++) state = addBrowserTab(state, 0);
  expect(state.groups[0].tabs).toHaveLength(16);
  expect(parseBrowserWorkspace("x".repeat(600000)).groups[0].tabs).toHaveLength(
    1,
  );
  expect(parseBrowserWorkspace("{").groups[0].tabs).toHaveLength(1);
  expect(
    parseBrowserWorkspace(
      JSON.stringify({ version: 2, groups: [{ tabs: [] }, { tabs: [] }] }),
    ).groups[0].tabs,
  ).toHaveLength(1);
  state.groups[0].tabs[0].history[0].node = "../escape";
  expect(
    browserLocation(
      parseBrowserWorkspace(JSON.stringify(state)).groups[0].tabs[0],
    ),
  ).toBeUndefined();
});
it("deleting an earlier directory history entry does not activate a forward entry", () => {
  let state = parseBrowserWorkspace(null);
  state = updateBrowserTab(state, 0, (tab) => {
    for (const path of ["", "old", "current", "future"])
      tab = navigateBrowserPane(tab, "r", path);
    return { ...tab, index: 2 };
  });
  state = reconcileBrowserTabs(state, {
    kind: "trash",
    rootId: "r",
    node: "old",
  });
  expect(browserLocation(activeBrowserPanes(state)[0])?.node).toBe("current");
});
it("previews numbered rename templates while preserving extensions and rejecting collisions", () => {
  expect(
    planBrowserRename(
      ["src/a.c", "src/b.hpp", "src/.gitignore"],
      "{n}-{name}{ext}",
      7,
    ).map((item) => item.next),
  ).toEqual(["7-a.c", "8-b.hpp", "9-.gitignore"]);
  expect(planBrowserRename(["a.c"], "{name}{ext}", 1)[0].changed).toBe(false);
  for (const template of [
    "same",
    "../{name}",
    "{unknown}",
    "{name",
    "{name}/child",
  ])
    expect(() => planBrowserRename(["a.c", "b.c"], template, 1)).toThrow();
  expect(() => planBrowserRename(["1", "2"], "{n}", 2)).toThrow("占用");
  expect(() => planBrowserRename(["a.c", "a.C"], "{name}{ext}", 1)).toThrow(
    "重复",
  );
  expect(() => planBrowserRename(["a.c"], "{n}", NaN)).toThrow();
});
const file = (name: string, directory = false): FileNode => ({
  id: name,
  name,
  directory,
  size: 2,
});
const provider = () => ({
  page: vi.fn(),
  properties: vi.fn(),
  preview: vi.fn(),
  open: vi.fn(),
});
it("compares complete pages and reports only metadata equality, directories and unknown reads separately", async () => {
  const adapter = provider();
  adapter.page.mockImplementation(
    async (root: string, _node: string, offset: number) =>
      root === "l"
        ? {
            nodes:
              offset === 0
                ? [file("equal"), file("only-left"), file("folder", true)]
                : [file("unknown"), file("type", true), file("changed")],
            next: offset === 0 ? 3 : null,
          }
        : {
            nodes: [
              file("equal"),
              file("only-right"),
              file("folder", true),
              file("unknown"),
              file("type"),
              file("changed"),
            ],
            next: null,
          },
  );
  adapter.properties.mockImplementation(async (root: string, node: string) => {
    if (node === "unknown") throw new Error("denied");
    return {
      size: node === "changed" && root === "r" ? 10 : 2,
      modifiedMs: 50,
    };
  });
  const rows = await compareBrowserDirectories(
    adapter,
    [
      { rootId: "l", node: "" },
      { rootId: "r", node: "" },
    ],
    new AbortController().signal,
    () => {},
  );
  expect(Object.fromEntries(rows.map((row) => [row.name, row.status]))).toEqual(
    {
      equal: "metadata",
      "only-left": "left",
      "only-right": "right",
      folder: "directory",
      unknown: "unknown",
      type: "type",
      changed: "different",
    },
  );
  expect(adapter.page).toHaveBeenCalledTimes(3);
  expect(adapter.preview).not.toHaveBeenCalled();
});
it("cancels directory comparison and rejects repeated page cursors", async () => {
  const adapter = provider(),
    controller = new AbortController();
  adapter.page.mockImplementation(async () => {
    controller.abort();
    return { nodes: [], next: null };
  });
  await expect(
    compareBrowserDirectories(
      adapter,
      [
        { rootId: "l", node: "" },
        { rootId: "r", node: "" },
      ],
      controller.signal,
      () => {},
    ),
  ).rejects.toThrow();
  expect(adapter.properties).not.toHaveBeenCalled();
  adapter.page.mockResolvedValue({ nodes: [], next: 0 });
  await expect(
    compareBrowserDirectories(
      adapter,
      [
        { rootId: "l", node: "" },
        { rootId: "r", node: "" },
      ],
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow("重复");
});

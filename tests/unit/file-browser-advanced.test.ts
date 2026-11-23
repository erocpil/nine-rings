import { expect, it, vi } from "vitest";
import { compareBrowserDirectories } from "../../src/lib/local-files/browser-compare";
import { planBrowserDrop } from "../../src/lib/local-files/browser-drag";
import {
  addBrowserTab,
  browserSideRows,
  MAX_BROWSER_TABS,
  modifyBrowserTabs,
  parseBrowserWorkspace,
  reconcileBrowserTabs,
  reorderBrowserTab,
  selectBrowserTab,
  transferBrowserTab,
  updateBrowserTab,
} from "../../src/lib/local-files/browser-tabs";
import {
  browserLocation,
  navigateBrowserPane,
} from "../../src/lib/local-files/browser-state";

it("transfers a directory tab from an inactive row to the opposite active row", () => {
  const tab = (tabId: string) => ({
    tabId,
    history: [{ rootId: "root", node: tabId, selected: [], scrollTop: 0 }],
    index: 0,
  });
  const state = parseBrowserWorkspace(
    JSON.stringify({
      version: 2,
      groups: [
        { tabs: [tab("left")], active: 0 },
        { tabs: [tab("right")], active: 0 },
      ],
      extraGroups: [
        [{ tabs: [tab("other-left")], active: 0 }],
        [{ tabs: [tab("other-right")], active: 0 }],
      ],
      activeRows: [0, 1],
      visibleRows: [2, 2],
    }),
  );
  const copied = transferBrowserTab(state, 0, 1, "other-left", true);
  expect(copied.groups[1].tabs[1]).toMatchObject({
    history: browserSideRows(state, 0)[1].tabs[0].history,
  });
  expect(copied.groups[1].tabs[1].tabId).not.toBe("other-left");
  expect(copied.extraGroups).toBe(state.extraGroups);

  const moved = transferBrowserTab(copied, 0, 1, "other-left", false);
  expect(moved.active).toBe(1);
  expect(moved.activeRows).toEqual([0, 1]);
  expect(moved.groups[0]).toBe(state.groups[0]);
  expect(browserSideRows(moved, 0)[1].tabs[0].history).toEqual([]);
  expect(browserSideRows(moved, 0)[1].closed).toEqual([]);
  expect(browserSideRows(moved, 1)[0]).toBe(browserSideRows(state, 1)[0]);
  expect(moved.groups[1].tabs[2].tabId).toBe("other-left");
  expect(moved.groups[1].active).toBe(2);
  const restored = parseBrowserWorkspace(JSON.stringify(moved));
  expect(restored.groups[1].tabs[2].tabId).toBe("other-left");

  let full = moved;
  while (full.groups[1].tabs.length < MAX_BROWSER_TABS)
    full = addBrowserTab(full, 1);
  expect(transferBrowserTab(full, 0, 0, "left", false)).toBe(full);
  expect(transferBrowserTab(full, 0, 0, "left", true)).toBe(full);
});

const roots = [
  { rootId: "l", node: "" },
  { rootId: "r", node: "" },
] as [{ rootId: string; node: string }, { rootId: string; node: string }];
function adapter() {
  return {
    page: vi.fn(async (_root: string, node: string) => ({
      nodes: node
        ? [{ id: `${node}/a.txt`, name: "a.txt", size: 2, directory: false }]
        : [{ id: "src", name: "src", size: 0, directory: true }],
      next: null as number | null,
    })),
    properties: vi.fn(async () => ({ size: 2, modifiedMs: 50 })),
    contentDigest: vi.fn(async () => ({
      size: 2,
      modifiedMs: 50,
      digest: "same",
    })),
  };
}
it("recurses only to the selected depth and hashes even matching metadata without normalizing bytes", async () => {
  const provider = adapter(),
    signal = new AbortController().signal;
  const shallow = await compareBrowserDirectories(
    provider,
    roots,
    signal,
    () => {},
  );
  expect(shallow.map((row) => row.status)).toEqual(["directory"]);
  expect(provider.contentDigest).not.toHaveBeenCalled();
  provider.contentDigest.mockImplementation(async (root?: string) => ({
    size: 2,
    modifiedMs: 50,
    digest: root === "l" ? "bom-crlf" : "lf",
  }));
  const rows = await compareBrowserDirectories(
    provider,
    roots,
    signal,
    () => {},
    { depth: 1, content: true },
  );
  expect(rows.find((row) => row.name === "src/a.txt")).toMatchObject({
    status: "content-different",
    left: { id: "src/a.txt" },
  });
  provider.contentDigest.mockResolvedValue({
    size: 2,
    modifiedMs: 50,
    digest: "same",
  });
  expect(
    (
      await compareBrowserDirectories(provider, roots, signal, () => {}, {
        depth: 1,
        content: true,
      })
    )[1].status,
  ).toBe("content");
});
it("never reports content equality for errors, changed files or files exceeding the byte budget", async () => {
  const provider = adapter(),
    signal = new AbortController().signal;
  provider.contentDigest.mockRejectedValue(
    new Error("binary UTF-8 unsupported"),
  );
  let rows = await compareBrowserDirectories(
    provider,
    roots,
    signal,
    () => {},
    { depth: 1, content: true },
  );
  expect(rows[1]).toMatchObject({
    status: "unknown",
    issue: expect.stringContaining("unsupported"),
  });
  provider.contentDigest.mockResolvedValue({
    size: 3,
    modifiedMs: 50,
    digest: "same",
  });
  rows = await compareBrowserDirectories(provider, roots, signal, () => {}, {
    depth: 1,
    content: true,
  });
  expect(rows[1]).toMatchObject({
    status: "unknown",
    issue: expect.stringContaining("变化"),
  });
  provider.contentDigest.mockClear();
  provider.properties.mockResolvedValue({
    size: 5 * 1024 * 1024,
    modifiedMs: 50,
  });
  rows = await compareBrowserDirectories(provider, roots, signal, () => {}, {
    depth: 1,
    content: true,
  });
  expect(rows[1].status).toBe("unknown");
  expect(provider.contentDigest).not.toHaveBeenCalled();
});
it("limits total content reads and rejects incomplete, out-of-scope or oversized directory traversals", async () => {
  const provider = adapter(),
    signal = new AbortController().signal;
  provider.page.mockResolvedValue({
    nodes: Array.from({ length: 5 }, (_, i) => ({
      id: `${i}`,
      name: `${i}`,
      size: 4 * 1024 * 1024,
      directory: false,
    })),
    next: null,
  });
  provider.properties.mockResolvedValue({
    size: 4 * 1024 * 1024,
    modifiedMs: 50,
  });
  provider.contentDigest.mockResolvedValue({
    size: 4 * 1024 * 1024,
    modifiedMs: 50,
    digest: "same",
  });
  const rows = await compareBrowserDirectories(
    provider,
    roots,
    signal,
    () => {},
    { depth: 0, content: true },
  );
  expect(rows.map((row) => row.status)).toEqual([
    "content",
    "content",
    "content",
    "content",
    "unknown",
  ]);
  expect(provider.contentDigest).toHaveBeenCalledTimes(8);
  provider.page.mockRejectedValue(new Error("unreadable directory"));
  await expect(
    compareBrowserDirectories(provider, roots, signal, () => {}, {
      depth: 1,
      content: false,
    }),
  ).rejects.toThrow("unreadable");
  provider.page.mockResolvedValue({
    nodes: [{ id: "../escape", name: "escape", size: 0, directory: false }],
    next: null,
  });
  await expect(
    compareBrowserDirectories(provider, roots, signal, () => {}),
  ).rejects.toThrow("范围外");
  provider.page.mockResolvedValue({
    nodes: Array.from({ length: 10001 }, (_, i) => ({
      id: `${i}`,
      name: `${i}`,
      size: 0,
      directory: false,
    })),
    next: null,
  });
  await expect(
    compareBrowserDirectories(provider, roots, signal, () => {}),
  ).rejects.toThrow("10000");
  await expect(
    compareBrowserDirectories(provider, roots, signal, () => {}, {
      depth: 9,
      content: false,
    }),
  ).rejects.toThrow("0–8");
});
it("cancels after an in-flight content read and does not read the other side", async () => {
  const provider = adapter(),
    controller = new AbortController();
  provider.contentDigest.mockImplementation(async () => {
    controller.abort();
    return { size: 2, modifiedMs: 50, digest: "same" };
  });
  await expect(
    compareBrowserDirectories(provider, roots, controller.signal, () => {}, {
      depth: 1,
      content: true,
    }),
  ).rejects.toThrow();
  expect(provider.contentDigest).toHaveBeenCalledTimes(1);
});

it("keeps raw-byte mode separate, applies provider limits and forwards the explicit binary request", async () => {
  const provider = { ...adapter(), digestByteLimit: () => 16 * 1024 * 1024 };
  provider.properties.mockResolvedValue({
    size: 5 * 1024 * 1024,
    modifiedMs: 50,
  });
  provider.contentDigest.mockResolvedValue({
    size: 5 * 1024 * 1024,
    modifiedMs: 50,
    digest: "binary-sha",
  });
  const result = await compareBrowserDirectories(
    provider,
    roots,
    new AbortController().signal,
    () => {},
    { depth: 1, content: true, binary: true },
  );
  expect(result[1].status).toBe("content");
  expect(provider.contentDigest.mock.calls[0]).toEqual([
    "l",
    "src/a.txt",
    expect.any(AbortSignal),
    true,
  ]);
  await expect(
    compareBrowserDirectories(
      { ...provider, digestByteLimit: () => Infinity },
      roots,
      new AbortController().signal,
      () => {},
      { depth: 0, content: true, binary: true },
    ),
  ).rejects.toThrow("预算");
});
it("preserves active identity across tab reorder, protects pins, and restores independent history after persistence", () => {
  let state = parseBrowserWorkspace(null);
  for (const name of ["first", "second", "third"]) {
    if (name !== "first") state = addBrowserTab(state, 0);
    state = updateBrowserTab(state, 0, (pane) =>
      navigateBrowserPane(pane, "l", name),
    );
  }
  const ids = state.groups[0].tabs.map((tab) => tab.tabId);
  state = modifyBrowserTabs(state, 0, ids[0], "pin");
  expect(selectBrowserTab(state, 0, 0, true)).toBe(state);
  state = reorderBrowserTab(state, 0, ids[2], ids[0]);
  expect(state.groups[0].tabs[state.groups[0].active].tabId).toBe(ids[2]);
  state = modifyBrowserTabs(state, 0, ids[2], "others");
  expect(state.groups[0].tabs.map((tab) => tab.tabId)).toEqual([
    ids[2],
    ids[0],
  ]);
  state = reconcileBrowserTabs(state, {
    kind: "move",
    rootId: "l",
    node: "second",
    targetRootId: "r",
    targetNode: "renamed",
  });
  state = parseBrowserWorkspace(JSON.stringify(state));
  state = modifyBrowserTabs(state, 0, state.groups[0].tabs[0].tabId, "restore");
  expect(
    browserLocation(state.groups[0].tabs[state.groups[0].active]),
  ).toMatchObject({ rootId: "r", node: "renamed" });
  state = modifyBrowserTabs(state, 0, state.groups[0].tabs[0].tabId, "right");
  expect(state.groups[0].tabs).toHaveLength(2);
  expect(state.groups[0].tabs[1].pinned).toBe(true);
});
it("drag proposals freeze multi-selection and reject self, descendant and foreign path targets", () => {
  const source = {
    rootId: "l",
    rootName: "Left",
    parent: "src",
    nodes: ["src/a", "src/b"],
  };
  const proposal = planBrowserDrop(
    source,
    { rootId: "r", rootName: "Right", parent: "dest" },
    false,
  );
  source.nodes.push("src/c");
  expect(proposal).toMatchObject({
    kind: "copy",
    nodes: ["src/a", "src/b"],
    targetParent: "dest",
  });
  expect(
    planBrowserDrop(
      source,
      { rootId: "r", rootName: "Right", parent: "" },
      true,
    ).kind,
  ).toBe("move");
  for (const parent of ["src", "src/a", "src/a/nested", "../escape"])
    expect(() =>
      planBrowserDrop(source, { rootId: "l", rootName: "Left", parent }, true),
    ).toThrow();
  expect(() =>
    planBrowserDrop(
      { ...source, nodes: ["other/a"] },
      { rootId: "r", rootName: "Right", parent: "" },
      false,
    ),
  ).toThrow();
});

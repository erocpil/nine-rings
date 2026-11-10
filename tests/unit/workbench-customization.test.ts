import { expect, it } from "vitest";
import {
  activateBrowserRow,
  activeBrowserPanes,
  addBrowserTab,
  browserSideRows,
  exchangeBrowserPanes,
  mirrorBrowserPath,
  parseBrowserWorkspace,
  reconcileBrowserTabs,
  setBrowserRowCount,
  updateBrowserRow,
} from "../../src/lib/local-files/browser-tabs";
import {
  browserLocation,
  navigateBrowserPane,
} from "../../src/lib/local-files/browser-state";
import {
  displayToolCommand,
  parseWorkbenchTools,
  serializeWorkbenchTools,
  validateWorkbenchTool,
  type WorkbenchTool,
} from "../../src/apps/file-workbench/custom-tools";
import { nextWorkbenchPreview } from "../../src/apps/file-workbench/preview-navigation";

it("stacked rows keep distinct tabs, active source/target and parked rows across serialization", () => {
  let state = parseBrowserWorkspace(null);
  state = updateBrowserRow(state, 0, 0, (pane) =>
    navigateBrowserPane(pane, "root", "one"),
  );
  state = setBrowserRowCount(state, 0, 3);
  state = updateBrowserRow(state, 0, 1, (pane) =>
    navigateBrowserPane(pane, "root", "two"),
  );
  expect(browserLocation(activeBrowserPanes(state)[0])?.node).toBe("one");
  state = activateBrowserRow(state, 0, 1);
  state = addBrowserTab(state, 0);
  expect(browserSideRows(state, 0).map((group) => group.tabs.length)).toEqual([
    1, 2, 1,
  ]);
  state = setBrowserRowCount(state, 0, 1);
  expect(browserLocation(activeBrowserPanes(state)[0])?.node).toBe("one");
  state = setBrowserRowCount(
    parseBrowserWorkspace(JSON.stringify(state)),
    0,
    3,
  );
  expect(browserLocation(browserSideRows(state, 0)[1].tabs[1])?.node).toBe(
    "two",
  );
  expect(browserSideRows(state, 0)[1].tabs.length).toBe(2);
  expect(
    new Set(
      browserSideRows(state, 0).flatMap((group) =>
        group.tabs.map((tab) => tab.tabId),
      ),
    ).size,
  ).toBe(4);
  expect(setBrowserRowCount(state, 0, 5)).toBe(state);
  expect(
    updateBrowserRow(state, 0, 9, (pane) =>
      navigateBrowserPane(pane, "wrong", "path"),
    ),
  ).toBe(state);
  const corrupt = JSON.parse(JSON.stringify(state));
  corrupt.extraGroups[0][0].tabs[0].tabId = corrupt.groups[0].tabs[0].tabId;
  const repaired = browserSideRows(
    parseBrowserWorkspace(JSON.stringify(corrupt)),
    0,
  ).flatMap((group) => group.tabs.map((tab) => tab.tabId));
  expect(new Set(repaired).size).toBe(repaired.length);
});
it("directory mutations reconcile every row, while exchange and mirror retain active-row semantics", () => {
  let state = setBrowserRowCount(parseBrowserWorkspace(null), 0, 2);
  state = updateBrowserRow(state, 0, 1, (pane) =>
    navigateBrowserPane(pane, "root", "old/sub"),
  );
  state = reconcileBrowserTabs(state, {
    kind: "move",
    rootId: "root",
    node: "old",
    targetRootId: "root",
    targetNode: "new",
  });
  state = activateBrowserRow(state, 0, 1);
  expect(browserLocation(activeBrowserPanes(state)[0])?.node).toBe("new/sub");
  state = mirrorBrowserPath(state);
  expect(browserLocation(activeBrowserPanes(state)[1])?.node).toBe("new/sub");
  state = exchangeBrowserPanes(state);
  expect(state.activeRows?.[1]).toBe(1);
  expect(state.visibleRows?.[1]).toBe(2);
  expect(browserLocation(activeBrowserPanes(state)[1])?.node).toBe("new/sub");
  expect(parseBrowserWorkspace(JSON.stringify(state)).activeRows?.[1]).toBe(1);
});
it("tool definitions validate names, command/argument limits and safe imported image formats", () => {
  const tool: WorkbenchTool = {
    id: "one",
    name: "Editor",
    command: "/Applications/My Editor.app",
    arguments: "{files}\n--test",
    hint: "Open selected files",
    icon: { kind: "unicode", value: "🛠" },
  };
  expect(() => validateWorkbenchTool(tool)).not.toThrow();
  expect(
    parseWorkbenchTools(
      JSON.stringify([
        tool,
        tool,
        null,
        {
          ...tool,
          id: "bad",
          icon: { kind: "image", value: "https://example.com/icon.svg" },
        },
      ]),
    ),
  ).toEqual([tool]);
  for (const changes of [
    { name: "" },
    { command: "a\nb" },
    { arguments: "\0" },
    { arguments: "x\n".repeat(65) },
    { icon: { kind: "unicode", value: "x".repeat(17) } },
  ])
    expect(() =>
      validateWorkbenchTool({ ...tool, ...changes } as WorkbenchTool),
    ).toThrow();
  expect(parseWorkbenchTools("bad json")).toEqual([]);
  expect(serializeWorkbenchTools([tool])).toBe(JSON.stringify([tool]));
  expect(() =>
    serializeWorkbenchTools(Array.from({ length: 33 }, () => tool)),
  ).toThrow("32");
  const large = {
    ...tool,
    icon: {
      kind: "image" as const,
      value: "data:image/png;base64," + "a".repeat(170000),
    },
  };
  expect(() =>
    serializeWorkbenchTools(
      Array.from({ length: 32 }, (_, id) => ({ ...large, id: String(id) })),
    ),
  ).toThrow("配置过大");
});
it("full-view navigation follows sorted text/image siblings, skips directories/binaries and never wraps", () => {
  const nodes = ["a.c", "folder", "b.pdf", "c.png", "d.md", "large.txt"].map(
    (name, at) => ({
      id: name,
      name,
      directory: name === "folder",
      size: at === 5 ? 5 * 1024 * 1024 : 20,
    }),
  );
  expect(nextWorkbenchPreview(nodes, "a.c", 1)?.id).toBe("c.png");
  expect(nextWorkbenchPreview(nodes, "c.png", 1)?.id).toBe("d.md");
  expect(nextWorkbenchPreview(nodes, "c.png", -1)?.id).toBe("a.c");
  expect(nextWorkbenchPreview(nodes, "d.md", 1)).toBeUndefined();
  expect(nextWorkbenchPreview(nodes, "a.c", -1)).toBeUndefined();
  expect(nextWorkbenchPreview(nodes, "missing", 1)).toBeUndefined();
});

it("tool separators and capture modes round-trip without changing legacy launchers or argument boundaries", () => {
  const separator: WorkbenchTool = {
    id: "separator",
    kind: "separator",
    name: "分隔符",
    command: "",
    arguments: "",
    hint: "",
    icon: { kind: "preset", value: "plus" },
  };
  const capture: WorkbenchTool = {
    ...separator,
    id: "capture",
    kind: "command",
    execution: "capture",
    name: "test",
    command: "tool",
    arguments: "{files}",
  };
  expect(
    parseWorkbenchTools(serializeWorkbenchTools([separator, capture])),
  ).toEqual([separator, capture]);
  expect(() =>
    validateWorkbenchTool({
      ...capture,
      execution: "invalid",
    } as unknown as WorkbenchTool),
  ).toThrow();
  expect(
    displayToolCommand({
      program: "/my tool",
      arguments: ["a b", "$(echo x)", 'a"b'],
      directory: "/root",
    }),
  ).toBe('"/my tool" "a b" "$(echo x)" "a\\"b"');
});

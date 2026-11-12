import { expect, it, vi } from "vitest";
import {
  browserFullPath,
  clampBrowserColumn,
  DEFAULT_BROWSER_COLUMNS,
  parseBrowserColumns,
  parseBrowserFavorites,
  resolveBrowserDirectoryInput,
  readBrowserFavorites,
  saveBrowserFavorites,
  BROWSER_FAVORITES_KEY,
  BROWSER_FAVORITES_EVENT,
} from "../../src/lib/local-files/browser-preferences";
import { localFileTreeNodes } from "../../src/lib/local-files/tree";
it("persists favorites and notifies both panes without hiding storage failures", () => {
  const values = [{ rootId: "root", node: "src" }];
  const storage = new Map<string, string>();
  const dispatchEvent = vi.fn();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal("window", { dispatchEvent });
  try {
    saveBrowserFavorites(values);
    expect(JSON.parse(storage.get(BROWSER_FAVORITES_KEY)!)).toEqual(values);
    expect(readBrowserFavorites()).toEqual(values);
    expect(dispatchEvent.mock.calls[0][0].type).toBe(BROWSER_FAVORITES_EVENT);
    expect(() =>
      saveBrowserFavorites(Array.from({ length: 41 }, () => values[0])),
    ).toThrow("40");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("unavailable");
      },
      setItem: () => {
        throw new Error("full");
      },
    });
    expect(readBrowserFavorites()).toEqual([]);
    expect(() => saveBrowserFavorites(values)).toThrow("full");
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("bounds persisted column widths while retaining automatic name fill by default", () => {
  expect(parseBrowserColumns(null)).toEqual(DEFAULT_BROWSER_COLUMNS);
  expect(parseBrowserColumns("null")).toEqual(DEFAULT_BROWSER_COLUMNS);
  expect(parseBrowserColumns("broken")).toEqual(DEFAULT_BROWSER_COLUMNS);
  expect(
    parseBrowserColumns(
      JSON.stringify({
        name: -3,
        size: 9999,
        modified: 140.4,
        autoName: false,
      }),
    ),
  ).toEqual({
    name: 110,
    type: 90,
    size: 400,
    modified: 140,
    autoName: false,
    autoModified: false,
  });
  expect(clampBrowserColumn("name", Infinity)).toBe(110);
});
it("automatic date width upgrades old defaults but preserves explicitly resized widths", () => {
  expect(
    parseBrowserColumns(JSON.stringify({ modified: 145 })).autoModified,
  ).toBe(true);
  expect(
    parseBrowserColumns(JSON.stringify({ modified: 200 })).autoModified,
  ).toBe(false);
  expect(
    parseBrowserColumns(JSON.stringify({ modified: 145, autoModified: false }))
      .autoModified,
  ).toBe(false);
  expect(
    parseBrowserColumns(JSON.stringify({ modified: 200, autoModified: true }))
      .autoModified,
  ).toBe(true);
});
it("favorites are bounded root-relative data, deduplicated and never authorization", () => {
  expect(
    parseBrowserFavorites(
      JSON.stringify([
        { rootId: "r", node: "src" },
        { rootId: "r", node: "src" },
        { rootId: "r", node: "../escape" },
        { rootId: "", node: "" },
        { rootId: "r", node: "" },
      ]),
    ),
  ).toEqual([
    { rootId: "r", node: "src" },
    { rootId: "r", node: "" },
  ]);
  expect(parseBrowserFavorites("null")).toEqual([]);
  expect(parseBrowserFavorites("{")).toEqual([]);
  expect(parseBrowserFavorites("x".repeat(300000))).toEqual([]);
  expect(
    parseBrowserFavorites(
      JSON.stringify(
        Array.from({ length: 60 }, (_, i) => ({ rootId: "r", node: `d${i}` })),
      ),
    ),
  ).toHaveLength(40);
});
it("resolves pasted paths only within authorized roots and chooses the most specific root", () => {
  const roots = [
    { id: "work", path: "/work" },
    { id: "nested", path: "/work/project" },
  ];
  expect(resolveBrowserDirectoryInput("src\\include", "work", roots)).toEqual({
    rootId: "work",
    node: "src/include",
  });
  expect(
    resolveBrowserDirectoryInput("/work/project/src/", "work", roots),
  ).toEqual({ rootId: "nested", node: "src" });
  expect(resolveBrowserDirectoryInput("/work", "work", roots)).toEqual({
    rootId: "work",
    node: "",
  });
  expect(
    resolveBrowserDirectoryInput("/tmp", "all", [{ id: "all", path: "/" }]),
  ).toEqual({ rootId: "all", node: "tmp" });
  for (const value of [
    "/work2/src",
    "/work/../elsewhere",
    "../elsewhere",
    "~/work",
    "file:///work/src",
  ])
    expect(() => resolveBrowserDirectoryInput(value, "work", roots)).toThrow();
});
it("handles Windows drive and UNC roots without prefix or traversal escapes", () => {
  const roots = [
    { id: "w", path: "C:\\Work" },
    { id: "unc", path: "\\\\host\\share" },
  ];
  expect(resolveBrowserDirectoryInput("c:\\work\\src", "w", roots)).toEqual({
    rootId: "w",
    node: "src",
  });
  expect(
    resolveBrowserDirectoryInput("\\\\HOST\\SHARE\\folder", "w", roots),
  ).toEqual({ rootId: "unc", node: "folder" });
  expect(
    resolveBrowserDirectoryInput("c:\\", "w", [{ id: "disk", path: "C:\\" }]),
  ).toEqual({ rootId: "disk", node: "" });
  expect(() =>
    resolveBrowserDirectoryInput("C:\\Workshop\\src", "w", roots),
  ).toThrow();
  expect(() =>
    resolveBrowserDirectoryInput("C:\\Work\\..\\else", "w", roots),
  ).toThrow();
  expect(browserFullPath("C:\\Work", "a.c")).toBe("C:\\Work\\a.c");
  expect(browserFullPath("/", "a.c")).toBe("/a.c");
});
it("sorts full collections by metadata with folders first and stable name ties", () => {
  const nodes = [
    { id: "a", name: "a", directory: false, size: 2, modifiedMs: 30 },
    { id: "z", name: "z", directory: false, size: 9, modifiedMs: 10 },
    { id: "b", name: "b", directory: false, size: 2, modifiedMs: 20 },
    { id: "d", name: "d", directory: true, size: 0 },
  ];
  const ordered = (sort: "size" | "size-desc" | "modified" | "modified-desc") =>
    localFileTreeNodes(nodes, { sort, showHidden: true, query: "" }).map(
      (node) => node.name,
    );
  expect(ordered("size")).toEqual(["d", "a", "b", "z"]);
  expect(ordered("size-desc")).toEqual(["d", "z", "a", "b"]);
  expect(ordered("modified")).toEqual(["d", "z", "b", "a"]);
  expect(ordered("modified-desc")).toEqual(["d", "a", "b", "z"]);
});

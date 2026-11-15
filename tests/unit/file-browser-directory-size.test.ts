import { expect, it, vi } from "vitest";
import {
  BrowserDirectorySizeCache,
  measureBrowserDirectorySize,
} from "../../src/lib/local-files/browser-directory-size";
import type { BrowserDirectoryProvider } from "../../src/lib/local-files/browser-contract";

const file = (id: string, size = 3, directory = false) => ({
  id,
  name: id.split("/").pop()!,
  size,
  directory,
});
it("counts all pages, empty and hidden files, nested directories without reading content", async () => {
  const page = vi.fn<BrowserDirectoryProvider["page"]>(
    async (_root, node, offset, options) => {
      expect(options).toEqual({ sort: "size", showHidden: true, query: "" });
      if (node === "sub") return { nodes: [file("sub/empty", 0)], next: null };
      return offset === 0
        ? { nodes: [file(".hidden", 7), file("sub", 0, true)], next: 2 }
        : { nodes: [file("last", 9)], next: null };
    },
  );
  const progress = vi.fn();
  const result = await measureBrowserDirectorySize(
    { page },
    "root",
    "",
    new AbortController().signal,
    progress,
  );
  expect(result).toMatchObject({
    bytes: 16,
    files: 3,
    directories: 1,
    pages: 3,
  });
  expect(result.measuredAt).toBeGreaterThan(0);
  expect(progress).toHaveBeenCalledTimes(3);
});
it.each([
  "escape",
  "duplicate",
  "pagination",
  "unknown",
  "overflow",
  "failure",
  "budget",
  "depth",
])("rejects incomplete result: %s", async (kind) => {
  const page = vi.fn<BrowserDirectoryProvider["page"]>(async () => {
    if (kind === "failure") throw new Error("permission");
    return {
      nodes:
        kind === "escape"
          ? [file("../x")]
          : kind === "duplicate"
            ? [file("x"), file("x")]
            : kind === "unknown"
              ? [file("x", -1)]
              : kind === "overflow"
                ? [file("x", Number.MAX_SAFE_INTEGER), file("y", 1)]
                : kind === "depth"
                  ? [file("sub", 0, true)]
                  : [file("x"), file("y")],
      next: kind === "pagination" ? 0 : null,
    };
  });
  await expect(
    measureBrowserDirectorySize(
      { page },
      "root",
      "",
      new AbortController().signal,
      () => {},
      { entries: kind === "budget" ? 1 : 100, depth: 1, pages: 10 },
    ),
  ).rejects.toThrow();
});
it("cancels between a late page and counting, never requests another page", async () => {
  const controller = new AbortController();
  const page = vi.fn<BrowserDirectoryProvider["page"]>(async () => {
    controller.abort();
    return { nodes: [file("x")], next: 1 };
  });
  const progress = vi.fn();
  await expect(
    measureBrowserDirectorySize(
      { page },
      "root",
      "",
      controller.signal,
      progress,
    ),
  ).rejects.toThrow();
  expect(page).toHaveBeenCalledTimes(1);
  expect(progress).not.toHaveBeenCalled();
});
it("bounds pages even if a provider returns empty forward pages", async () => {
  const page = vi.fn<BrowserDirectoryProvider["page"]>(
    async (_root, _node, offset) => ({ nodes: [], next: offset + 1 }),
  );
  await expect(
    measureBrowserDirectorySize(
      { page },
      "root",
      "",
      new AbortController().signal,
      () => {},
      { entries: 10, depth: 1, pages: 2 },
    ),
  ).rejects.toThrow("页统计预算");
  expect(page).toHaveBeenCalledTimes(2);
});
it("expires and invalidates cached root scopes, copies snapshots and bounds retained results", () => {
  const cache = new BrowserDirectorySizeCache();
  const result = {
    bytes: 4,
    files: 1,
    directories: 0,
    pages: 1,
    elapsedMs: 2,
    measuredAt: Date.now(),
  };
  cache.put("a", "", result);
  cache.put("b", "", result);
  result.bytes = 9;
  expect(cache.get("a", "")?.bytes).toBe(4);
  cache.invalidate("a");
  expect(cache.get("a", "")).toBeUndefined();
  expect(cache.get("b", "")).toBeDefined();
  cache.put("b", "old", { ...result, measuredAt: Date.now() - 61000 });
  expect(cache.get("b", "old")).toBeUndefined();
  for (let i = 0; i < 65; i++) cache.put("root", String(i), result);
  expect(cache.get("root", "0")).toBeUndefined();
  expect(cache.get("root", "64")).toBeDefined();
  cache.invalidate();
  expect(cache.get("root", "64")).toBeUndefined();
});

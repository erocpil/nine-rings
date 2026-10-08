import { afterEach, expect, it, vi } from "vitest";
import {
  normalizeSidebarOrder,
  readDesktopSidebarState,
} from "../../src/lib/desktop-sidebar-state";
import { quickNoteName, quickNoteGroupPath } from "../../src/lib/quick-notes";

afterEach(() => vi.unstubAllGlobals());

it("inserts Notes after the existing document list and preserves deliberate order", () => {
  expect(normalizeSidebarOrder(["tree", "list", "reader"])).toEqual([
    "tree",
    "list",
    "notes",
    "reader",
  ]);
  expect(normalizeSidebarOrder(["reader", "list", "tree"])).toEqual([
    "reader",
    "list",
    "notes",
    "tree",
  ]);
  expect(
    normalizeSidebarOrder([
      "notes",
      "reader",
      "tree",
      "list",
      "notes",
      "unknown",
    ]),
  ).toEqual(["notes", "reader", "tree", "list"]);
  vi.stubGlobal("localStorage", {
    getItem: () =>
      JSON.stringify({ panel: "notes", hidden: false, pinned: true }),
  });
  expect(readDesktopSidebarState()).toEqual({
    panel: "notes",
    hidden: false,
    pinned: true,
  });
});

it("uses a local date and time and prevents group names from escaping Notes", () => {
  expect(quickNoteName(new Date(2026, 9, 8, 6, 7, 9))).toBe(
    "2026-10-08 06:07:09",
  );
  expect(quickNoteGroupPath(" 临时想法 ")).toBe("ideas/notes/临时想法");
  for (const invalid of [
    "",
    "..",
    ".",
    "../projects",
    "a/b",
    "a\\b",
    "a\n\u0000b",
  ]) {
    expect(() => quickNoteGroupPath(invalid)).toThrow();
  }
});

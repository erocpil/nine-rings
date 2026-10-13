import { expect, it } from "vitest";
import {
  sortedBookmarks,
  sortedPanelItems,
  bookmarkTooltip,
  panelDisplayStyle,
} from "../../src/lib/panel-display-view";
import { DEFAULT_BOOKMARK_DISPLAY } from "../../src/lib/plugin-system/builtin-bookmark-display";
import { DEFAULT_NOTES_DISPLAY } from "../../src/lib/plugin-system/builtin-notes-display";
import {
  validatePanelDisplay,
  PanelDisplayRegistry,
} from "../../src/lib/plugin-system/panel-display";
import { PluginRuntime } from "../../src/lib/plugin-system/runtime";
import { panelPresenter } from "../../src/lib/plugin-system/builtin-panel-presenters";
const bookmarks = Object.freeze([
  Object.freeze({
    id: "z",
    position: 1,
    preview: "first preview",
    label: "Zeta",
    createdAt: "2026-01-01",
  }),
  Object.freeze({
    id: "a",
    position: 6,
    preview: "second preview",
    label: "Alpha",
    createdAt: "2026-01-02",
  }),
]);
it("display sorting never reorders stored anchors and preserves their identity", () => {
  expect(sortedBookmarks(bookmarks, null)).toBe(bookmarks);
  expect(sortedBookmarks(bookmarks, DEFAULT_BOOKMARK_DISPLAY)).toBe(bookmarks);
  for (const order of ["name", "recent"] as const) {
    const view = sortedBookmarks(bookmarks, {
      ...DEFAULT_BOOKMARK_DISPLAY,
      order,
    });
    expect(view.map((item) => item.id)).toEqual(["a", "z"]);
    expect(view[0]).toBe(bookmarks[1]);
    expect(bookmarks.map((item) => item.position)).toEqual([1, 6]);
  }
});
it("equal names and dates have a stable ID tie-break without mutating notes", () => {
  const notes = [
    { id: "z", title: "same", date: "2026-01-01" },
    { id: "a", title: "same", date: "2026-01-01" },
  ];
  expect(
    sortedPanelItems(
      notes,
      { ...DEFAULT_NOTES_DISPLAY, order: "recent" },
      (item) => item.title,
      (item) => item.date,
      (item) => item.id,
    ).map((item) => item.id),
  ).toEqual(["a", "z"]);
  expect(notes[0].id).toBe("z");
});
it("bookmark hints use only existing metadata and styling uses theme tokens", () => {
  expect(bookmarkTooltip(bookmarks[0], DEFAULT_BOOKMARK_DISPLAY)).toBe(
    "Zeta\nfirst preview",
  );
  expect(
    bookmarkTooltip(bookmarks[0], {
      ...DEFAULT_BOOKMARK_DISPLAY,
      tooltip: "name",
    }),
  ).toBe("Zeta");
  expect(
    panelDisplayStyle({ ...DEFAULT_NOTES_DISPLAY, labelColor: "accent" })?.[
      "--list-display-color"
    ],
  ).toBe("var(--accent)");
  expect(panelDisplayStyle(null)).toBeUndefined();
  expect(panelPresenter("__proto__")).toBeNull();
});
it("sorting and tool commands are slot-bound, and disabling one presenter keeps others", () => {
  expect(() =>
    validatePanelDisplay({
      ...DEFAULT_BOOKMARK_DISPLAY,
      target: "document-tree",
    }),
  ).toThrow();
  expect(() =>
    validatePanelDisplay({
      ...DEFAULT_NOTES_DISPLAY,
      toolbar: ["bookmarks.reveal-current"],
    }),
  ).toThrow();
  const runtime = new PluginRuntime();
  runtime.setEnabled(true);
  const registry = new PanelDisplayRegistry(runtime);
  const owner = runtime.activate("test.bookmarks", []);
  registry.register(owner, DEFAULT_BOOKMARK_DISPLAY);
  registry.register(runtime.activate("test.notes", []), DEFAULT_NOTES_DISPLAY);
  const stale = registry.get("bookmarks")!;
  runtime.deactivate(owner.pluginId);
  expect(registry.get("notes")).not.toBeNull();
  expect(
    registry.run("bookmarks", stale, "bookmarks.reveal-current", {
      "bookmarks.reveal-current": () => {
        throw new Error("stale command");
      },
    }),
  ).toBe(false);
});

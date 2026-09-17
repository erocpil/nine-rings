import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  clearReadingState,
  patchReadingState,
  readReadingState,
  readRenderedScrollTop,
} from "../../src/lib/reading-state";
import { createSessionHeadingFoldStore } from "../../src/lib/heading-fold";
import {
  clearReadingBlockSessions,
  readingBlockSession,
} from "../../src/lib/reading-block-session";

let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  clearReadingBlockSessions();
});
afterEach(() => {
  clearReadingBlockSessions();
  vi.unstubAllGlobals();
});

test("view, source and rendered positions merge without overwriting folds", () => {
  patchReadingState("a", { headings: ["first"], rendered: { scrollTop: 500 } });
  patchReadingState("a", { view: "source", source: { scrollTop: 900 } });
  expect(readReadingState("a")).toEqual({
    version: 1,
    headings: ["first"],
    rendered: { scrollTop: 500 },
    source: { scrollTop: 900 },
    view: "source",
  });
  expect(readReadingState("b")).toEqual({ version: 1 });
});

test("malformed records and invalid fields fail safely", () => {
  for (const text of ["{", "null", '{"version":2,"headings":["stale"]}']) {
    values.set("nr:readingState:a", text);
    expect(readReadingState("a")).toEqual({ version: 1 });
  }
  values.set(
    "nr:readingState:a",
    JSON.stringify({
      version: 1,
      headings: [4],
      source: { scrollTop: -3 },
      rendered: { scrollTop: "4" },
      blocks: { revision: "1", entries: [[-1, { collapsed: true }]] },
      virtual: { revision: 4, position: 1, offset: 0 },
    }),
  );
  expect(readReadingState("a")).toEqual({ version: 1 });
});

test("legacy positions are read only when no current valid position exists", () => {
  values.set("scrollPos:a", "400");
  expect(readRenderedScrollTop("a")).toBe(400);
  patchReadingState("a", { rendered: { scrollTop: 0 } });
  expect(readRenderedScrollTop("a")).toBe(0);
  values.delete("nr:readingState:a");
  values.set("scrollPos:a", "not a number");
  expect(readRenderedScrollTop("a")).toBeNull();
});

test("explicit unfolding replaces a persisted collapse instead of reviving it", () => {
  const store = createSessionHeadingFoldStore(true);
  store.save("a", { version: 1, collapsedKeys: ["section"] });
  store.save("a", { version: 1, collapsedKeys: [] });
  expect(createSessionHeadingFoldStore(true).load("a")?.collapsedKeys).toEqual(
    [],
  );
  readingBlockSession("a", "1").set(12, { collapsed: true });
  readingBlockSession("a", "1").set(12, { collapsed: false });
  clearReadingBlockSessions();
  expect(readingBlockSession("a", "1").get(12)?.collapsed).toBe(false);
});

test("a new store/session restores folds; stale block revisions cannot overwrite current ones", () => {
  createSessionHeadingFoldStore(true).save("a", {
    version: 1,
    collapsedKeys: ["section"],
  });
  expect(createSessionHeadingFoldStore(true).load("a")?.collapsedKeys).toEqual([
    "section",
  ]);
  const old = readingBlockSession("a", "1");
  old.set(12, { collapsed: true, wrap: false });
  clearReadingBlockSessions();
  expect(readingBlockSession("a", "1").get(12)).toEqual({
    collapsed: true,
    wrap: false,
  });
  const current = readingBlockSession("a", "2");
  expect(current.size).toBe(0);
  current.set(20, { lineNumbers: false });
  old.set(12, { collapsed: false });
  expect(readReadingState("a").blocks).toEqual({
    revision: "2",
    entries: [[20, { lineNumbers: false }]],
  });
});

test("protection cleanup removes new and legacy positions without clearing another document", () => {
  patchReadingState("a", { headings: ["private title"] });
  patchReadingState("b", { headings: ["public title"] });
  values.set("scrollPos:a", "23");
  values.set("nr:readonlyAnchor:a", "{}");
  clearReadingState("a");
  expect([...values.keys()]).toEqual(["nr:readingState:b"]);
});

test("storage unavailable or full preserves an in-memory heading session", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw Error("disabled");
    },
    setItem: () => {
      throw Error("full");
    },
    removeItem: () => {
      throw Error("disabled");
    },
  });
  const store = createSessionHeadingFoldStore(true);
  expect(() => {
    store.save("a", { version: 1, collapsedKeys: ["section"] });
    clearReadingState("b");
  }).not.toThrow();
  expect(store.load("a")?.collapsedKeys).toEqual(["section"]);
});

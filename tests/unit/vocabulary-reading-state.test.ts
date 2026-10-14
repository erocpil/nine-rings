import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  readVocabularyReading,
  saveVocabularyReading,
  sortVocabulary,
  readVocabularySort,
  saveVocabularySort,
} from "../../src/lib/vocabulary-reading-state";
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());
it("restores UI state by document identity and invalidates it when source changes", () => {
  const initial = readVocabularyReading("first", "# word");
  saveVocabularyReading("first", {
    ...initial,
    scrollTop: 310,
    folds: { "fold:1": true, "fold:2": false },
  });
  expect(readVocabularyReading("first", "# word")).toMatchObject({
    scrollTop: 310,
    folds: { "fold:1": true, "fold:2": false },
  });
  expect(readVocabularyReading("second", "# word").scrollTop).toBe(0);
  expect(readVocabularyReading("first", "# changed")).toMatchObject({
    scrollTop: 0,
    folds: {},
  });
  expect(values.get("nr:vocabularyReading")).not.toContain("# word");
});
it("bounds the cache, rejects corrupt data and tolerates unavailable storage", () => {
  for (let i = 0; i < 60; i++)
    saveVocabularyReading(String(i), readVocabularyReading(String(i), "x"));
  expect(
    Object.keys(JSON.parse(values.get("nr:vocabularyReading")!)),
  ).toHaveLength(50);
  expect(readVocabularyReading("0", "x").touched).toBe(0);
  expect(readVocabularyReading("59", "x").touched).toBeGreaterThan(0);
  values.set("nr:vocabularyReading", '{"x":{"scrollTop":-2}}');
  expect(readVocabularyReading("x", "x").scrollTop).toBe(0);
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw Error("unavailable");
    },
    setItem: () => {
      throw Error("quota");
    },
  });
  expect(() =>
    saveVocabularyReading("x", readVocabularyReading("x", "x")),
  ).not.toThrow();
});
it("sorts case-insensitive alphabet or actual creation time, never mutating summaries", () => {
  const items = [
    {
      id: "a",
      title: "Zeta",
      created_at: "2026-01-03",
      updated_at: "2026-01-01",
    },
    {
      id: "b",
      title: "alpha",
      created_at: "2026-01-01",
      updated_at: "2026-01-09",
    },
  ];
  expect(sortVocabulary(items, "alphabet").map((n) => n.id)).toEqual([
    "b",
    "a",
  ]);
  expect(sortVocabulary(items, "added").map((n) => n.id)).toEqual(["a", "b"]);
  expect(items[0].id).toBe("a");
  saveVocabularySort("added");
  expect(readVocabularySort()).toBe("added");
});

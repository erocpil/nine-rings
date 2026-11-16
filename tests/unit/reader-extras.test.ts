import { expect, it } from "vitest";
import {
  readReaderExtras,
  saveReaderExtras,
} from "../../src/lib/local-files/reader-extras";
it("preserves file-specific bookmarks, chapter positions and reading preferences with fingerprint invalidation", () => {
  const values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const state = {
    ...readReaderExtras(store, "a", "hash"),
    rotation: 90,
    continuous: true,
    fitPage: true,
    lineHeight: 2.2,
    margin: 8,
    theme: "dark" as const,
    bookmarks: [{ page: 3, top: 200, label: "End" }],
    chapters: { 2: 200 },
  };
  saveReaderExtras(store, "a", state);
  expect(readReaderExtras(store, "a", "hash")).toEqual(state);
  expect(readReaderExtras(store, "a", "changed").bookmarks).toEqual([]);
  expect(readReaderExtras(store, "b", "hash").continuous).toBe(false);
  for (let i = 0; i < 40; i++) saveReaderExtras(store, String(i), state);
  expect(Object.keys(JSON.parse([...values.values()][0]))).toHaveLength(32);
});
it("bounds corrupt bookmarks, layout values and chapter offsets; read failure does not prevent opening", () => {
  const store = {
    getItem: () =>
      JSON.stringify({
        a: {
          fingerprint: "h",
          rotation: 42,
          lineHeight: 100,
          margin: -1,
          theme: "bad",
          bookmarks: [
            { page: -1, top: 0 },
            { page: 2, top: 10, label: "a".repeat(300) },
          ],
          chapters: { evil: 20, 0: -4, 2: 1e10 },
        },
      }),
    setItem: () => {
      throw Error("quota");
    },
  };
  const state = readReaderExtras(store, "a", "h");
  expect(state).toMatchObject({
    rotation: 0,
    lineHeight: 2.4,
    margin: 1,
    theme: "light",
    chapters: { 0: 0, 2: 10000000 },
  });
  expect(state.bookmarks).toEqual([
    { page: 2, top: 10, label: "a".repeat(120) },
  ]);
  expect(() => saveReaderExtras(store, "a", state)).toThrow("quota");
  expect(
    readReaderExtras(
      {
        ...store,
        getItem: () => {
          throw Error("denied");
        },
      },
      "a",
      "h",
    ).bookmarks,
  ).toEqual([]);
});

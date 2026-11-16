import { expect, it } from "vitest";
import {
  readReaderPreviewState,
  saveReaderPreviewState,
} from "../../src/lib/local-files/reader-preview-state";
it("isolates files and invalidates stale reading progress when content changes", () => {
  const values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const state = {
    fingerprint: "hash",
    page: 4,
    zoom: 1.5,
    top: 52,
    left: 10,
    font: 150,
  };
  saveReaderPreviewState(store, "root/a.pdf", state);
  expect(readReaderPreviewState(store, "root/a.pdf", "hash")).toEqual(state);
  expect(readReaderPreviewState(store, "root/a.pdf", "changed").page).toBe(1);
  expect(readReaderPreviewState(store, "root/b.pdf", "hash").page).toBe(1);
  for (let i = 0; i < 40; i++) saveReaderPreviewState(store, String(i), state);
  expect(Object.keys(JSON.parse([...values.values()][0]))).toHaveLength(32);
});
it("bounds malformed persisted values and tolerates read failure without hiding write failure", () => {
  const store = {
    getItem: () =>
      JSON.stringify({
        a: {
          fingerprint: "hash",
          page: -3,
          zoom: 99,
          font: 0,
          top: -1,
          left: "bad",
        },
      }),
    setItem: () => {
      throw Error("quota");
    },
  };
  const state = readReaderPreviewState(store, "a", "hash");
  expect(state).toMatchObject({ page: 1, zoom: 2, font: 75, top: 0, left: 0 });
  expect(() => saveReaderPreviewState(store, "a", state)).toThrow("quota");
  expect(
    readReaderPreviewState(
      {
        ...store,
        getItem: () => {
          throw Error("denied");
        },
      },
      "a",
      "hash",
    ).page,
  ).toBe(1);
});

it("preserves a signed page offset only for continuous PDF view anchors", () => {
  const values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const state = {
    fingerprint: "hash",
    page: 2,
    zoom: 0,
    top: -180,
    left: 0,
    font: 100,
    continuous: true,
  };
  saveReaderPreviewState(store, "pdf", state);
  expect(readReaderPreviewState(store, "pdf", "hash")).toEqual(state);
  saveReaderPreviewState(store, "pdf", { ...state, continuous: false });
  expect(readReaderPreviewState(store, "pdf", "hash").top).toBe(0);
});

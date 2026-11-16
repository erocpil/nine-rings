import { expect, it } from "vitest";
import {
  normalizeTextReaderPosition,
  readTextReaderOptions,
  readTextReaderPosition,
  saveTextReaderPosition,
  TEXT_READER_OPTIONS_KEY,
  TEXT_READER_STATE_KEY,
} from "../../src/lib/local-files/text-preview-state";
const storage = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};
it("retains independent file positions, selection, folds and bookmarks without storing source", () => {
  const store = storage(),
    source = "first\nsecond\nlast";
  const position = {
    offset: 6,
    left: 12,
    from: 6,
    to: 12,
    folds: [{ from: 5, to: 12 }],
    bookmarks: [{ id: "b", position: 6, label: "Second", preview: "second" }],
  };
  saveTextReaderPosition(store, "root/a", source, position);
  saveTextReaderPosition(store, "root/b", "other", {
    ...position,
    from: 0,
    to: 0,
  });
  expect(readTextReaderPosition(store, "root/a", source)).toEqual(position);
  expect(readTextReaderPosition(store, "root/a", source + "changed")).toEqual(
    normalizeTextReaderPosition(null, 0),
  );
  expect(store.values.get(TEXT_READER_STATE_KEY)).not.toContain(source);
  for (let i = 0; i < 20; i++)
    saveTextReaderPosition(
      store,
      String(i),
      "abc",
      normalizeTextReaderPosition(null, 3),
    );
  expect(JSON.parse(store.values.get(TEXT_READER_STATE_KEY)!)).toHaveLength(16);
});
it("rejects invalid ranges and strips unknown fields under bounded budgets", () => {
  const result = normalizeTextReaderPosition(
    {
      offset: Infinity,
      left: -20,
      from: -1,
      to: 999,
      folds: [{ from: 1, to: 4 }, { from: 4, to: 2 }, null],
      bookmarks: [
        {
          id: "b",
          position: 3,
          label: "a".repeat(200),
          preview: "b",
          secret: "discard",
        },
        { id: "bad", position: 999, label: "", preview: "" },
      ],
    },
    10,
  );
  expect(result).toMatchObject({
    offset: 0,
    left: 0,
    from: 0,
    to: 0,
    folds: [{ from: 1, to: 4 }],
  });
  expect(result.bookmarks).toEqual([
    { id: "b", position: 3, label: "a".repeat(120), preview: "b" },
  ]);
});
it("keeps reading possible with corrupt or unavailable settings and reports write failures", () => {
  const store = storage();
  for (const raw of ["null", "[]", "broken", "false"]) {
    store.setItem(TEXT_READER_STATE_KEY, raw);
    store.setItem(TEXT_READER_OPTIONS_KEY, raw);
    expect(readTextReaderPosition(store, "a", "abc").offset).toBe(0);
    expect(readTextReaderOptions(store).fontSize).toBe(16);
  }
  const broken = {
    getItem: () => {
      throw Error("unavailable");
    },
    setItem: () => {
      throw Error("quota");
    },
  };
  expect(readTextReaderOptions(broken).fontSize).toBe(16);
  expect(readTextReaderPosition(broken, "a", "abc").offset).toBe(0);
  expect(() =>
    saveTextReaderPosition(
      broken,
      "a",
      "abc",
      normalizeTextReaderPosition(null, 3),
    ),
  ).toThrow();
  store.setItem(
    TEXT_READER_OPTIONS_KEY,
    JSON.stringify({
      fontSize: 100,
      editor_show_line_numbers: false,
      editor_fold_icon_style: "bad",
    }),
  );
  expect(readTextReaderOptions(store)).toMatchObject({
    fontSize: 32,
    editor_show_line_numbers: false,
    editor_fold_icon_style: "chevron",
  });
});

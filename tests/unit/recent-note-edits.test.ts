import { expect, it } from "vitest";
import {
  markRecentNoteEdited,
  readRecentEditedNoteIds,
  readRecentNoteIds,
  rememberRecentNote,
  RECENT_NOTE_EDITS_KEY,
} from "../../src/lib/quick-switcher";
import {
  collectFrontendSettings,
  restoreFrontendSettings,
} from "../../src/lib/backup-user-settings";

function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
}

it("visiting is distinct from editing, and revisiting retains the observed edit flag without reordering visits", () => {
  const store = memory();
  rememberRecentNote("a", store);
  rememberRecentNote("b", store);
  expect(readRecentEditedNoteIds(store)).toEqual([]);
  markRecentNoteEdited("a", store);
  expect(readRecentNoteIds(store)).toEqual(["b", "a"]);
  expect(readRecentEditedNoteIds(store)).toEqual(["a"]);
  rememberRecentNote("a", store);
  expect(readRecentEditedNoteIds(store)).toEqual(["a"]);
  const restored = memory();
  restoreFrontendSettings(collectFrontendSettings(store), restored);
  expect(readRecentEditedNoteIds(restored)).toEqual(["a"]);
  expect(readRecentNoteIds(restored)).toEqual(["a", "b"]);
});

it("prunes flags when visits leave the retained history and tolerates malformed data", () => {
  const store = memory();
  rememberRecentNote("old", store);
  markRecentNoteEdited("old", store);
  for (let i = 0; i < 20; i++) rememberRecentNote(String(i), store);
  expect(readRecentEditedNoteIds(store)).toEqual([]);
  store.setItem(RECENT_NOTE_EDITS_KEY, '["a","a",null,{}]');
  expect(readRecentEditedNoteIds(store)).toEqual(["a"]);
  store.setItem(RECENT_NOTE_EDITS_KEY, "broken");
  expect(readRecentEditedNoteIds(store)).toEqual([]);
});

it("optional edit tracking failure never turns a successful document save into an error", () => {
  expect(() =>
    markRecentNoteEdited("a", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    }),
  ).not.toThrow();
});

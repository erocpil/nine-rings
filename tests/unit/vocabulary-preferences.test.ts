import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  readVocabularyPreference,
  saveVocabularyPreference,
  defaultVocabularyListAppearance,
} from "../../src/lib/plugin-system/builtin-vocabulary";
let value: string | null;
beforeEach(() => {
  value = null;
  vi.stubGlobal("localStorage", {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  });
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());
it("upgrades old preferences to a readable list without changing access or path", () => {
  value = JSON.stringify({
    enabled: true,
    path: "references/english",
    collapseExamples: false,
  });
  expect(readVocabularyPreference()).toEqual({
    ...defaultVocabularyListAppearance,
    enabled: true,
    path: "references/english",
    collapseExamples: false,
  });
});
it("persists appearance and restores it independently of document preferences", () => {
  saveVocabularyPreference({
    ...readVocabularyPreference(),
    enabled: true,
    listFont: "mono",
    listFontSize: 20,
    listLineHeight: 1.8,
    listRowHeight: 52,
  });
  expect(readVocabularyPreference()).toMatchObject({
    enabled: true,
    listFont: "mono",
    listFontSize: 20,
    listLineHeight: 1.8,
    listRowHeight: 52,
  });
  saveVocabularyPreference({
    ...readVocabularyPreference(),
    ...defaultVocabularyListAppearance,
  });
  expect(readVocabularyPreference()).toMatchObject({
    enabled: true,
    ...defaultVocabularyListAppearance,
  });
});
it("rejects unsafe appearance values without granting new access", () => {
  value = JSON.stringify({
    enabled: false,
    path: "references/english",
    collapseExamples: true,
    listFont: "__proto__",
    listFontSize: -1,
    listLineHeight: "2",
    listRowHeight: 500,
  });
  expect(readVocabularyPreference()).toEqual({
    enabled: false,
    path: "references/english",
    collapseExamples: true,
    ...defaultVocabularyListAppearance,
  });
  value = JSON.stringify({ listFontSize: 20 });
  expect(readVocabularyPreference().enabled).toBe(false);
});

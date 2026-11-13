import { expect, it } from "vitest";
import {
  readWorkbenchEditorSettings,
  saveWorkbenchEditorSettings,
  EDITOR_SETTINGS_KEY,
} from "../../src/apps/file-workbench/editor-settings";
import { browserSettings } from "../../src/lib/local-files/browser-settings";
import { vi, afterEach } from "vitest";
afterEach(() => vi.unstubAllGlobals());

it("persists numbering and fold style independently, ignores unrelated app fields", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const store = browserSettings("file-workbench:");
  const defaults = readWorkbenchEditorSettings(store);
  expect(defaults.editor_show_line_numbers).toBe(true);
  const next = saveWorkbenchEditorSettings(store, defaults, {
    editor_show_line_numbers: false,
    editor_fold_icon_style: "custom",
    editor_fold_icon_collapsed: "+",
    editor_fold_icon_expanded: "−",
    editor_font_size: 99,
  });
  expect(readWorkbenchEditorSettings(store)).toEqual(next);
  expect(next).not.toHaveProperty("editor_font_size");
  expect(values.has(EDITOR_SETTINGS_KEY)).toBe(false);
  expect(values.has(`file-workbench:${EDITOR_SETTINGS_KEY}`)).toBe(true);
});

it("recovers corrupt settings and propagates write failures without changing live state", () => {
  const store = {
    getItem: () => "invalid json",
    setItem: () => {
      throw new Error("quota");
    },
  };
  const current = readWorkbenchEditorSettings(store);
  expect(current.editor_fold_icon_style).toBe("chevron");
  expect(() =>
    saveWorkbenchEditorSettings(store, current, {
      editor_show_line_numbers: false,
    }),
  ).toThrow("quota");
  expect(current.editor_show_line_numbers).toBe(true);
  expect(
    readWorkbenchEditorSettings({
      ...store,
      getItem: () =>
        '{"editor_show_line_numbers":"false","editor_fold_icon_style":"unknown","editor_fold_icon_collapsed":{}}',
    }),
  ).toEqual(current);
});

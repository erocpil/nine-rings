import { afterEach, expect, test, vi } from "vitest";
import {
  applyInterfaceStyle,
  normalizeInterfaceStyle,
  resolveInterfaceConfig,
  normalizeInterfaceColorMode,
} from "../../src/lib/interface-style";
import { getConfig, setConfig } from "../../src/lib/storage/db-config";

afterEach(() => vi.unstubAllGlobals());
test("legacy and unknown styles use classic, known styles remain independent of theme", () => {
  expect(normalizeInterfaceStyle(undefined)).toBe("classic");
  expect(normalizeInterfaceStyle("unknown")).toBe("classic");
  const root = { dataset: {}, className: "theme-nord" };
  vi.stubGlobal("document", { documentElement: root });
  for (const style of ["classic", "calm", "calm-compact"]) {
    applyInterfaceStyle(style);
    expect(root.dataset).toEqual({ interfaceStyle: style });
    expect(root.className).toBe("theme-nord");
  }
});
test("persisted style changes preserve theme and explicit typography; legacy configuration migrates", async () => {
  let value = JSON.stringify({
    theme: "dracula",
    note_font_size: 21,
    editor_line_height: 1.9,
  });
  vi.stubGlobal("localStorage", {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  });
  expect((await getConfig()).interface_style).toBe("classic");
  await setConfig({ interface_style: "calm-compact" });
  expect(await getConfig()).toMatchObject({
    interface_style: "calm-compact",
    theme: "dracula",
    note_font_size: 21,
    editor_line_height: 1.9,
  });
  await setConfig({ theme: "light" });
  expect((await getConfig()).interface_style).toBe("calm-compact");
});

test("calm projection leaves stored appearance and editor behaviours intact", () => {
  const saved = {
    interface_style: "calm" as const,
    theme: "dracula",
    note_font_size: 23,
    editor_line_height: 2.2,
    navigation_outline_text_color: "#ff0000",
    editor_show_line_numbers: true,
    highlight_active_line: false,
  };
  const snapshot = JSON.stringify(saved);
  const display = resolveInterfaceConfig(saved);
  expect(display.note_font_size).toBe(15);
  expect(display.editor_line_height).toBe(1.9);
  expect(display.navigation_outline_text_color).toBe("#333333");
  expect(display.editor_show_line_numbers).toBe(true);
  expect(display.highlight_active_line).toBe(false);
  expect(JSON.stringify(saved)).toBe(snapshot);
  const classic = { ...saved, interface_style: "classic" as const };
  expect(resolveInterfaceConfig(classic)).toBe(classic);
  expect(
    resolveInterfaceConfig({ ...saved, interface_style: "calm-compact" })
      .note_font_size,
  ).toBe(14);
  expect(normalizeInterfaceColorMode("invalid")).toBe("system");
});

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
  for (const style of ["classic", "calm", "calm-compact", "paper", "minimal", "nine-rings", "mono-aware", "yugen", "wabi-sabi"]) {
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

test("paper and minimal project typography without rewriting saved preferences", () => {
  for (const style of ["paper", "minimal"] as const) {
    const original = {
      interface_style: style,
      note_font_size: 23,
      editor_font_family: "monospace" as const,
    };
    const display = resolveInterfaceConfig(original);
    expect(display.editor_font_family).toBe(
      style === "paper" ? "serif" : "system",
    );
    expect(display.note_font_size).toBe(style === "paper" ? 16 : 14);
    expect(original.note_font_size).toBe(23);
    expect(original.editor_font_family).toBe("monospace");
  }
});


test("workspace layout defaults safely and survives classic style changes", async () => {
  let value = "{}";
  vi.stubGlobal("localStorage", { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } });
  expect((await getConfig()).workspace_layout).toBe("standard");
  await setConfig({ workspace_layout: "exhibition", interface_style: "yugen" });
  await setConfig({ interface_style: "classic" });
  expect((await getConfig()).workspace_layout).toBe("exhibition");
  value = JSON.stringify({ workspace_layout: "unknown" });
  expect((await getConfig()).workspace_layout).toBe("standard");
});


test("exhibition display preferences migrate, persist and validate independently", async () => {
  let value = "{}";
  vi.stubGlobal("localStorage", { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } });
  expect(await getConfig()).toMatchObject({ exhibition_text_width: "standard", exhibition_density: null });
  await setConfig({ exhibition_text_width: "wide", exhibition_density: "compact" });
  await setConfig({ interface_style: "paper" });
  expect(await getConfig()).toMatchObject({ exhibition_text_width: "wide", exhibition_density: "compact", interface_style: "paper" });
  value = JSON.stringify({ exhibition_text_width: "invalid", exhibition_density: "invalid" });
  expect(await getConfig()).toMatchObject({ exhibition_text_width: "standard", exhibition_density: null });
});

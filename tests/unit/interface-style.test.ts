import { afterEach, expect, test, vi } from "vitest";
import {
  applyInterfaceStyle,
  normalizeInterfaceStyle,
  resolveInterfaceConfig,
  normalizeInterfaceColorMode,
} from "../../src/lib/interface-style";
import { getConfig, setConfig } from "../../src/lib/storage/db-config";
import { editorAppearanceVariables } from "../../src/lib/editor-appearance";
import { DEFAULT_CONFIG } from "../../src/lib/storage/types";

afterEach(() => vi.unstubAllGlobals());
test("legacy and unknown styles use classic, known styles remain independent of theme", () => {
  expect(normalizeInterfaceStyle(undefined)).toBe("classic");
  expect(normalizeInterfaceStyle("unknown")).toBe("classic");
  const root = { dataset: {}, className: "theme-nord" };
  vi.stubGlobal("document", { documentElement: root });
  for (const style of [
    "classic",
    "calm",
    "calm-compact",
    "paper",
    "minimal",
    "nine-rings",
    "mono-aware",
    "yugen",
    "wabi-sabi",
  ]) {
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
  expect(display.note_font_size).toBe(16);
  expect(display.editor_line_height).toBe(1.8);
  expect(display.navigation_outline_text_color).toBe("#333333");
  expect(display.editor_show_line_numbers).toBe(true);
  expect(display.highlight_active_line).toBe(false);
  expect(JSON.stringify(saved)).toBe(snapshot);
  const classic = { ...saved, interface_style: "classic" as const };
  expect(resolveInterfaceConfig(classic)).toBe(classic);
  expect(
    resolveInterfaceConfig({ ...saved, interface_style: "calm-compact" })
      .note_font_size,
  ).toBe(16);
  expect(normalizeInterfaceColorMode("invalid")).toBe("system");
});

test("all eight managed interface styles share the original wabi-sabi reading typography", () => {
  for (const style of [
    "calm",
    "calm-compact",
    "paper",
    "minimal",
    "nine-rings",
    "mono-aware",
    "yugen",
    "wabi-sabi",
  ] as const) {
    const original = {
      interface_style: style,
      note_font_size: 23,
      editor_font_family: "monospace" as const,
    };
    const display = resolveInterfaceConfig(original);
    expect(display.editor_font_family).toBe("system");
    expect(display.note_font_size).toBe(16);
    expect(display.editor_line_height).toBe(1.8);
    expect(display.editor_block_spacing).toBeCloseTo(1);
    expect(display.editor_heading_margin_top).toBeCloseTo(28 / 16);
    expect(display.editor_heading_margin_bottom).toBeCloseTo(12 / 16);
    expect(editorAppearanceVariables(display)["--editor-font-family"]).toBe(
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
    );
    expect(original.note_font_size).toBe(23);
    expect(original.editor_font_family).toBe("monospace");
  }
});

test("managed typography overrides preserve classic values and selected style colors", () => {
  const saved = {
    ...DEFAULT_CONFIG,
    interface_style: "mono-aware" as const,
    note_font_size: 23,
    editor_font_family: "monospace" as const,
    interface_font_family: "serif" as const,
    interface_font_size: 18,
    interface_line_height: 1.9,
    interface_block_spacing_px: 20,
    interface_heading_margin_top_px: 30,
    interface_heading_margin_bottom_px: 8,
    interface_content_width: 900,
    editor_block_number_gap: 18,
  };
  const display = resolveInterfaceConfig(saved);
  expect(display).toMatchObject({
    editor_font_family: "serif",
    note_font_size: 18,
    editor_line_height: 1.9,
  });
  expect(display.editor_block_spacing).toBeCloseTo(20 / 18);
  expect(display.editor_heading_margin_top).toBeCloseTo(30 / 18);
  expect(display.editor_heading_margin_bottom).toBeCloseTo(8 / 18);
  expect(editorAppearanceVariables(display)).toMatchObject({
    "--style-content-width": "900px",
    "--editor-block-number-gap": "18px",
  });
  expect(
    editorAppearanceVariables(
      resolveInterfaceConfig({ ...saved, interface_content_width: 0 }),
    )["--style-content-width"],
  ).toBeUndefined();
  const classic = resolveInterfaceConfig({
    ...saved,
    interface_style: "classic",
  });
  expect(classic.note_font_size).toBe(23);
  expect(classic.editor_font_family).toBe("monospace");
});

test("default hierarchy palette alternates through cool/warm hues and ends with brick red", () => {
  expect(DEFAULT_CONFIG.hierarchy_path_custom_colors).toEqual([
    "#247F7B",
    "#9A5B00",
    "#5266A8",
    "#5E7C36",
    "#8356A1",
    "#B0473C",
  ]);
  expect(DEFAULT_CONFIG.hierarchy_outline_custom_colors).toEqual(
    DEFAULT_CONFIG.hierarchy_path_custom_colors,
  );
  const variables = editorAppearanceVariables();
  expect(variables["--hierarchy-path-custom-1"]).toBe("#247F7B");
  expect(variables["--hierarchy-outline-custom-6"]).toBe("#B0473C");
});

test("workspace layout defaults safely and survives classic style changes", async () => {
  let value = "{}";
  vi.stubGlobal("localStorage", {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  });
  expect((await getConfig()).workspace_layout).toBe("standard");
  await setConfig({ workspace_layout: "exhibition", interface_style: "yugen" });
  await setConfig({ interface_style: "classic" });
  expect((await getConfig()).workspace_layout).toBe("exhibition");
  value = JSON.stringify({ workspace_layout: "unknown" });
  expect((await getConfig()).workspace_layout).toBe("standard");
});

test("exhibition display preferences migrate, persist and validate independently", async () => {
  let value = "{}";
  vi.stubGlobal("localStorage", {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  });
  expect(await getConfig()).toMatchObject({
    exhibition_text_width: "wide",
    exhibition_density: "comfortable",
  });
  await setConfig({
    exhibition_text_width: "wide",
    exhibition_density: "compact",
  });
  await setConfig({ interface_style: "paper" });
  expect(await getConfig()).toMatchObject({
    exhibition_text_width: "wide",
    exhibition_density: "compact",
    interface_style: "paper",
  });
  value = JSON.stringify({
    exhibition_text_width: "invalid",
    exhibition_density: "invalid",
  });
  expect(await getConfig()).toMatchObject({
    exhibition_text_width: "wide",
    exhibition_density: "comfortable",
  });
});

test("new workspaces default to light, wide and comfortable presentation", async () => {
  vi.stubGlobal("localStorage", { getItem: () => "{}", setItem: vi.fn() });
  expect(await getConfig()).toMatchObject({
    interface_color_mode: "light",
    exhibition_text_width: "wide",
    exhibition_density: "comfortable",
  });
});

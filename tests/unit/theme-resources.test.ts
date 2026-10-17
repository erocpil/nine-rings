import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  BUILTIN_THEME_RESOURCES,
  THEME_PLUGIN_ID,
} from "../../src/lib/plugin-system/builtin-theme-resources";
import {
  ThemeResourceRegistry,
  validateThemeResource,
  themeResources,
} from "../../src/lib/plugin-system/theme-resources";
import {
  PluginRuntime,
  pluginRuntime,
} from "../../src/lib/plugin-system/runtime";
import { pluginLifecycle } from "../../src/lib/plugin-system/lifecycle";
import { themeResourceVariables } from "../../src/lib/plugin-system/theme-application";
import { startBuiltinThemes } from "../../src/lib/plugin-system/builtin-theme";
import {
  DEFAULT_THEME_PREFERENCE,
  readThemePreference,
  saveThemePreference,
  THEME_SETTINGS_KEY,
} from "../../src/lib/plugin-system/theme-preferences";
import { editorAppearanceVariables } from "../../src/lib/editor-appearance";
import { READING_TYPOGRAPHY_WILL_CHANGE } from "../../src/lib/reading-position";

const paper = BUILTIN_THEME_RESOURCES[0];
describe("declarative theme contract", () => {
  it("keeps all seven base palettes aligned with their existing host CSS fallback", () => {
    const css = [
      "additional-interface-styles",
      "interface-style",
      "nine-rings-interface-style",
      "literary-interface-styles",
    ]
      .map((name) =>
        readFileSync(
          new URL(`../../src/styles/${name}.css`, import.meta.url),
          "utf8",
        ),
      )
      .join("\n");
    expect(BUILTIN_THEME_RESOURCES).toHaveLength(7);
    for (const theme of BUILTIN_THEME_RESOURCES)
      for (const dark of [false, true]) {
        const colors = dark ? theme.dark : theme.light;
        const body = [...css.matchAll(/\{([^{}]+)\}/g)].find((match) =>
          match[1].includes(`--bg: ${colors.bg};`),
        )?.[1];
        expect(body).toBeDefined();
        const vars = themeResourceVariables(theme, dark, false, false);
        for (const key of [
          "--bg",
          "--surface",
          "--border",
          "--text",
          "--text-secondary",
          "--accent",
          "--accent-hover",
          "--hover-bg",
          "--active-bg",
          "--code-bg",
        ])
          expect(body).toContain(`${key}: ${vars[key]};`);
      }
  });
  it("requires complete light/dark pairs, safe colors, contrast and bounded typography", () => {
    for (const patch of [
      { version: 2 },
      { css: "body{display:none}" },
      { name: "" },
      { id: "../theme" },
      { dark: undefined },
      { light: { ...paper.light, bg: "url(https://example.com)" } },
      { dark: { ...paper.dark, bg: "#ffffff" } },
      { light: { ...paper.light, text: paper.light.bg } },
      { light: { ...paper.light, external: "#ffffff" } },
      { typography: { ...paper.typography, codeFont: "serif" } },
      { typography: { ...paper.typography, quoteFont: "url(font)" } },
      {
        typography: {
          ...paper.typography,
          headingScale: [2, 2, 1.5, 1.3, 1.2, 1],
        },
      },
      {
        typography: {
          ...paper.typography,
          compactHeadingScale: [4, 1.5, 1.4, 1.3, 1.2, 1],
        },
      },
      { typography: { ...paper.typography, fontSize: 999 } },
    ])
      expect(() => validateThemeResource({ ...paper, ...patch })).toThrow(
        "主题资源无效",
      );
    const source = structuredClone(paper);
    const validated = validateThemeResource(source);
    expect(Object.isFrozen(validated.light)).toBe(true);
    expect(Object.isFrozen(validated.typography!.headingScale)).toBe(true);
    expect(validated.light).not.toBe(source.light);
    expect(validated.typography!.headingScale).not.toBe(
      source.typography!.headingScale,
    );
    expect(() => validateThemeResource(Object.create({ ...paper }))).toThrow();
    const accessor = { ...paper };
    Object.defineProperty(accessor, "name", {
      enumerable: true,
      get() {
        throw Error("must not invoke a resource getter");
      },
    });
    expect(() => validateThemeResource(accessor)).toThrow("主题资源无效");
  });

  it("validates a whole registration before publishing and rejects forged/foreign/duplicate resources", () => {
    const runtime = new PluginRuntime();
    runtime.setEnabled(true);
    const owner = runtime.activate(THEME_PLUGIN_ID, []);
    const registry = new ThemeResourceRegistry(runtime);
    expect(() => registry.register({ ...owner }, [paper])).toThrow();
    expect(() =>
      registry.register(owner, [
        paper,
        { ...paper, id: "other.provider/theme" },
      ]),
    ).toThrow();
    expect(registry.getSnapshot()).toHaveLength(0);
    expect(() => registry.register(owner, [paper, paper])).toThrow();
    expect(() => registry.register(owner, Array(9).fill(paper))).toThrow();
    registry.register(owner, BUILTIN_THEME_RESOURCES);
    expect(registry.getSnapshot()).toHaveLength(BUILTIN_THEME_RESOURCES.length);
    expect(() => registry.register(owner, [paper])).toThrow();
    expect(registry.get(paper.id)).toEqual(paper);
  });

  it("releases resources on stop/global disable and stale cleanup cannot revoke a new owner", () => {
    const runtime = new PluginRuntime();
    runtime.setEnabled(true);
    const registry = new ThemeResourceRegistry(runtime);
    registry.subscribe(() => {
      throw Error("observer failure");
    });
    const dispose = registry.register(runtime.activate(THEME_PLUGIN_ID, []), [
      paper,
    ]);
    runtime.deactivate(THEME_PLUGIN_ID);
    expect(registry.get(paper.id)).toBeNull();
    registry.register(runtime.activate(THEME_PLUGIN_ID, []), [paper]);
    dispose();
    expect(registry.get(paper.id)).not.toBeNull();
    runtime.setEnabled(false);
    expect(registry.getSnapshot()).toEqual([]);
  });

  it("enforces the total resource budget atomically and allows capacity to be reclaimed", () => {
    const runtime = new PluginRuntime();
    runtime.setEnabled(true);
    const registry = new ThemeResourceRegistry(runtime);
    for (let i = 0; i < 4; i++) {
      const owner = runtime.activate(`test.provider${i}`, []);
      registry.register(
        owner,
        Array.from({ length: 8 }, (_, index) => ({
          ...paper,
          id: `${owner.pluginId}/theme${index}`,
        })),
      );
    }
    const next = runtime.activate("test.next", []);
    expect(() =>
      registry.register(next, [{ ...paper, id: "test.next/theme" }]),
    ).toThrow();
    expect(registry.getSnapshot()).toHaveLength(32);
    runtime.deactivate("test.provider0");
    registry.register(next, [{ ...paper, id: "test.next/theme" }]);
    expect(registry.getSnapshot()).toHaveLength(25);
  });

  it("maps only host tokens and preserves explicit title/block settings over theme defaults", () => {
    const colors = themeResourceVariables(paper, false, false, false);
    expect(colors["--bg"]).toBe(paper.light.bg);
    expect(Object.keys(colors).some((key) => key.startsWith("--editor-"))).toBe(
      false,
    );
    const theme = themeResourceVariables(paper, true, true, true);
    expect(theme["--bg"]).toBe(paper.dark.bg);
    expect(theme["--editor-h1-scale"]).toBe("1.625");
    expect(theme["--editor-code-font-family"]).toContain("monospace");
    const overrides = editorAppearanceVariables({
      editor_h1_font_size: 31,
      editor_code_font_family: "serif",
      editor_code_font_size: 21,
    });
    expect({ ...theme, ...overrides }).toMatchObject({
      "--editor-h1-size": "31px",
      "--editor-code-font-family": overrides["--editor-code-font-family"],
      "--editor-code-font-size": "21px",
    });
    expect(Object.keys(theme)).not.toContain("--editor-font-size");
    expect(Object.keys(theme)).not.toContain("--editor-line-height");
  });
});

let stop: (() => void) | undefined;
afterEach(async () => {
  stop?.();
  stop = undefined;
  pluginRuntime.setEnabled(false);
  await pluginLifecycle.deactivate(THEME_PLUGIN_ID);
  vi.unstubAllGlobals();
});
function host() {
  const values = new Map<string, string>();
  const properties = new Map<string, { value: string; priority: string }>();
  const events = new EventTarget();
  const classes = new Set<string>();
  const media = Object.assign(new EventTarget(), { matches: false });
  let mutation = () => {};
  const root = {
    dataset: { interfaceStyle: "paper" } as Record<string, string>,
    classList: { contains: (name: string) => classes.has(name) },
    style: {
      getPropertyValue: (key: string) => properties.get(key)?.value ?? "",
      getPropertyPriority: (key: string) => properties.get(key)?.priority ?? "",
      setProperty: (key: string, value: string, priority = "") => {
        properties.set(key, { value, priority });
      },
      removeProperty: (key: string) => properties.delete(key),
    },
  };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("window", Object.assign(events, { matchMedia: () => media }));
  vi.stubGlobal("document", {
    documentElement: root,
    querySelectorAll: () => [],
  });
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback: () => void) {
        mutation = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  return { values, events, root, media, classes, mutation: () => mutation() };
}
it("keeps preferences device-local, bounds invalid data and retains unavailable theme identity", () => {
  const h = host();
  h.values.set(
    THEME_SETTINGS_KEY,
    JSON.stringify({
      ...DEFAULT_THEME_PREFERENCE,
      enabled: true,
      css: "unsafe",
    }),
  );
  expect(readThemePreference()).toEqual(DEFAULT_THEME_PREFERENCE);
  saveThemePreference({
    enabled: true,
    themeId: "absent.provider/theme",
    typography: false,
  });
  expect(readThemePreference().themeId).toBe("absent.provider/theme");
  expect(() =>
    saveThemePreference({ ...DEFAULT_THEME_PREFERENCE, themeId: "url(x)" }),
  ).toThrow();
});

it("switches palettes without reactivating resources; follows system mode/mobile scales, then restores host inline values", async () => {
  const h = host();
  h.root.style.setProperty("--bg", "#123456", "important");
  let typographyChanges = 0;
  h.events.addEventListener(
    READING_TYPOGRAPHY_WILL_CHANGE,
    () => typographyChanges++,
  );
  pluginRuntime.setEnabled(true);
  stop = startBuiltinThemes();
  saveThemePreference({
    ...DEFAULT_THEME_PREFERENCE,
    enabled: true,
    typography: true,
  });
  await vi.waitFor(() => expect(h.root.dataset.pluginTheme).toBe(paper.id));
  const generation = pluginRuntime
    .getStatus()
    .activations.find(
      (entry) => entry.pluginId === THEME_PLUGIN_ID,
    )!.generation;
  expect(h.root.style.getPropertyValue("--bg")).toBe(paper.light.bg);
  h.classes.add("theme-dark");
  h.mutation();
  expect(h.root.style.getPropertyValue("--bg")).toBe(paper.dark.bg);
  expect(typographyChanges).toBe(1); // Color mode alone doesn't invalidate layout.
  h.media.matches = true;
  h.media.dispatchEvent(new Event("change"));
  expect(h.root.style.getPropertyValue("--editor-h1-scale")).toBe("1.625");
  expect(typographyChanges).toBe(2);
  saveThemePreference({
    ...readThemePreference(),
    themeId: BUILTIN_THEME_RESOURCES[1].id,
    typography: false,
  });
  expect(h.root.style.getPropertyValue("--bg")).toBe(
    BUILTIN_THEME_RESOURCES[1].dark.bg,
  );
  expect(h.root.style.getPropertyValue("--editor-h1-scale")).toBe("");
  await Promise.resolve();
  expect(
    pluginRuntime
      .getStatus()
      .activations.find((entry) => entry.pluginId === THEME_PLUGIN_ID)!
      .generation,
  ).toBe(generation);
  pluginRuntime.setEnabled(false);
  expect(h.root.style.getPropertyValue("--bg")).toBe("#123456");
  expect(h.root.style.getPropertyPriority("--bg")).toBe("important");
  expect(h.root.dataset.pluginTheme).toBeUndefined();
  expect(readThemePreference().enabled).toBe(true);
});

it("handles cross-window missing/corrupt preferences and rapid toggles; manual stop stays off until a preference change", async () => {
  const h = host();
  pluginRuntime.setEnabled(true);
  stop = startBuiltinThemes();
  saveThemePreference({ ...DEFAULT_THEME_PREFERENCE, enabled: true });
  saveThemePreference({ ...DEFAULT_THEME_PREFERENCE, enabled: false });
  saveThemePreference({ ...DEFAULT_THEME_PREFERENCE, enabled: true });
  await vi.waitFor(() =>
    expect(themeResources.getSnapshot()).toHaveLength(
      BUILTIN_THEME_RESOURCES.length,
    ),
  );
  const storage = () =>
    h.events.dispatchEvent(
      Object.assign(new Event("storage"), { key: THEME_SETTINGS_KEY }),
    );
  h.values.set(
    THEME_SETTINGS_KEY,
    JSON.stringify({
      enabled: true,
      themeId: "absent.provider/theme",
      typography: true,
    }),
  );
  storage();
  expect(h.root.dataset.pluginTheme).toBeUndefined();
  expect(readThemePreference().themeId).toBe("absent.provider/theme");
  saveThemePreference({ ...DEFAULT_THEME_PREFERENCE, enabled: true });
  await pluginLifecycle.deactivate(THEME_PLUGIN_ID);
  expect(themeResources.getSnapshot()).toHaveLength(0);
  await Promise.resolve();
  expect(h.root.dataset.pluginTheme).toBeUndefined();
  saveThemePreference({ ...readThemePreference(), typography: true });
  await vi.waitFor(() =>
    expect(themeResources.getSnapshot()).toHaveLength(
      BUILTIN_THEME_RESOURCES.length,
    ),
  );
  h.values.set(THEME_SETTINGS_KEY, "not-json");
  storage();
  expect(h.root.dataset.pluginTheme).toBeUndefined();
  await vi.waitFor(() => expect(themeResources.getSnapshot()).toHaveLength(0));
});

it("follows the host style without disturbing classic palettes or losing an explicit override", async () => {
  const h = host();
  pluginRuntime.setEnabled(true);
  stop = startBuiltinThemes();
  saveThemePreference({ ...DEFAULT_THEME_PREFERENCE, enabled: true });
  await vi.waitFor(() => expect(h.root.dataset.pluginTheme).toBe(paper.id));
  h.root.dataset.interfaceStyle = "calm-compact";
  h.mutation();
  expect(h.root.dataset.pluginTheme).toBe(`${THEME_PLUGIN_ID}/calm`);
  h.root.dataset.interfaceStyle = "classic";
  h.mutation();
  expect(h.root.dataset.pluginTheme).toBeUndefined();
  expect(h.root.style.getPropertyValue("--bg")).toBe("");
  saveThemePreference({ ...readThemePreference(), themeId: paper.id });
  expect(h.root.dataset.pluginTheme).toBe(paper.id);
  h.root.dataset.interfaceStyle = "yugen";
  h.mutation();
  expect(h.root.dataset.pluginTheme).toBe(paper.id);
  saveThemePreference({ ...readThemePreference(), themeId: "follow" });
  expect(h.root.dataset.pluginTheme).toBe(`${THEME_PLUGIN_ID}/yugen`);
});

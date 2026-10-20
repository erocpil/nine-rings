import { describe, expect, it, vi } from "vitest";
import { PluginRuntime } from "../../src/lib/plugin-system/runtime";
import {
  PanelDisplayRegistry,
  validatePanelDisplay,
} from "../../src/lib/plugin-system/panel-display";
import {
  outlineDisplay,
  OUTLINE_DISPLAY_SETTINGS_KEY,
  DEFAULT_OUTLINE_DISPLAY,
} from "../../src/lib/plugin-system/builtin-outline-display";
import { DEFAULT_TREE_DISPLAY } from "../../src/lib/plugin-system/builtin-tree-display";
import { DEFAULT_SOURCE_SYMBOL_DISPLAY } from "../../src/lib/plugin-system/builtin-source-symbol-display";
import { DEFAULT_SOURCE_MATCH_DISPLAY } from "../../src/lib/plugin-system/builtin-source-match-display";

describe("panel display authority and fallback", () => {
  it("rejects forged identities, competing presenters, invalid tokens and commands", () => {
    const runtime = new PluginRuntime();
    runtime.setEnabled(true);
    const token = runtime.activate("test.presenter", []);
    const registry = new PanelDisplayRegistry(runtime);
    expect(() =>
      registry.register({ ...token }, DEFAULT_TREE_DISPLAY),
    ).toThrow();
    registry.register(token, DEFAULT_TREE_DISPLAY);
    expect(() => registry.register(token, DEFAULT_TREE_DISPLAY)).toThrow(
      "已有",
    );
    for (const patch of [
      { fontSize: 11 },
      { rowHeight: 49 },
      { labelColor: "#fff" },
      { toolbar: ["tree.refresh", "tree.refresh"] },
      { target: "notes" },
      { css: "body{}" },
    ])
      expect(() =>
        validatePanelDisplay({
          ...DEFAULT_TREE_DISPLAY,
          ...patch,
        } as typeof DEFAULT_TREE_DISPLAY),
      ).toThrow();
  });
  it("allows full document information only in the document-tree tooltip", () => {
    expect(validatePanelDisplay({ ...DEFAULT_TREE_DISPLAY, tooltip: "info" }).tooltip).toBe("info");
    expect(() => validatePanelDisplay({ ...DEFAULT_OUTLINE_DISPLAY, tooltip: "info" })).toThrow();
  });
  it("registers separate, presentation-only slots for source symbols and matches", () => {
    expect(validatePanelDisplay(DEFAULT_SOURCE_SYMBOL_DISPLAY).target).toBe("source-symbols");
    expect(validatePanelDisplay(DEFAULT_SOURCE_MATCH_DISPLAY).target).toBe("source-matches");
    expect(() => validatePanelDisplay({ ...DEFAULT_SOURCE_MATCH_DISPLAY, toolbar: ["tree.refresh"] })).toThrow();
  });
  it("freezes contributions, revokes commands and restores host fallback synchronously", () => {
    const runtime = new PluginRuntime();
    runtime.setEnabled(true);
    const token = runtime.activate("test.presenter", []);
    const registry = new PanelDisplayRegistry(runtime);
    registry.register(token, DEFAULT_TREE_DISPLAY);
    const current = registry.get("document-tree")!;
    expect(Object.isFrozen(current)).toBe(true);
    expect(Object.isFrozen(current.toolbar)).toBe(true);
    let calls = 0;
    const handlers = {
      "tree.refresh": () => {
        calls++;
      },
    };
    expect(
      registry.run("document-tree", current, "tree.refresh", handlers),
    ).toBe(true);
    runtime.deactivate(token.pluginId);
    expect(registry.get("document-tree")).toBeNull();
    expect(
      registry.run("document-tree", current, "tree.refresh", handlers),
    ).toBe(false);
    registry.register(
      runtime.activate("test.presenter", []),
      DEFAULT_TREE_DISPLAY,
    );
    expect(
      registry.run("document-tree", current, "tree.refresh", handlers),
    ).toBe(false);
    runtime.setEnabled(false);
    expect(registry.get("document-tree")).toBeNull();
    expect(calls).toBe(1);
  });
  it("non-tree slots can register presentation but cannot borrow tree commands", () => {
    const runtime = new PluginRuntime();
    runtime.setEnabled(true);
    const registry = new PanelDisplayRegistry(runtime);
    registry.register(runtime.activate("test.notes", []), {
      ...DEFAULT_TREE_DISPLAY,
      target: "notes",
      toolbar: [],
    });
    expect(registry.get("notes")?.target).toBe("notes");
    expect(registry.get("document-tree")).toBeNull();
    expect(
      registry.run("notes", registry.get("notes")!, "tree.refresh", {
        "tree.refresh": () => {
          throw new Error("must not run");
        },
      }),
    ).toBe(false);
  });
});

// Real lifecycle and local/cross-window preferences, without exposing document data.
import { afterEach, vi } from "vitest";
import { pluginRuntime } from "../../src/lib/plugin-system/runtime";
import { pluginLifecycle } from "../../src/lib/plugin-system/lifecycle";
import { panelDisplays } from "../../src/lib/plugin-system/panel-display";
import {
  readTreeDisplayPreference,
  saveTreeDisplayPreference,
  startBuiltinTreeDisplay,
  TREE_DISPLAY_PLUGIN_ID,
  TREE_DISPLAY_SETTINGS_KEY,
} from "../../src/lib/plugin-system/builtin-tree-display";
let stop: (() => void) | undefined;
afterEach(async () => {
  stop?.();
  stop = undefined;
  pluginRuntime.setEnabled(false);
  await pluginLifecycle.deactivate(TREE_DISPLAY_PLUGIN_ID);
  vi.unstubAllGlobals();
});
it("invalid saved preferences fall back and rapid changes keep only the latest activation", async () => {
  const values = new Map<string, string>();
  const events = new EventTarget();
  vi.stubGlobal("window", events);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  values.set(
    TREE_DISPLAY_SETTINGS_KEY,
    '{"enabled":true,"display":{"css":"unsafe"}}',
  );
  expect(readTreeDisplayPreference().enabled).toBe(false);
  pluginRuntime.setEnabled(true);
  stop = startBuiltinTreeDisplay();
  saveTreeDisplayPreference({ enabled: true, display: DEFAULT_TREE_DISPLAY });
  saveTreeDisplayPreference({ enabled: false, display: DEFAULT_TREE_DISPLAY });
  saveTreeDisplayPreference({
    enabled: true,
    display: { ...DEFAULT_TREE_DISPLAY, fontSize: 18 },
  });
  await vi.waitFor(() =>
    expect(panelDisplays.get("document-tree")?.fontSize).toBe(18),
  );
  await pluginLifecycle.deactivate(TREE_DISPLAY_PLUGIN_ID);
  expect(panelDisplays.get("document-tree")).toBeNull();
  // Status/resource notifications must not undo manual deactivation.
  pluginRuntime.recordCleanupFailure();
  await Promise.resolve();
  expect(panelDisplays.get("document-tree")).toBeNull();
  values.set(
    TREE_DISPLAY_SETTINGS_KEY,
    JSON.stringify({
      enabled: true,
      display: { ...DEFAULT_TREE_DISPLAY, fontSize: 16 },
    }),
  );
  const storage = new Event("storage");
  Object.assign(storage, { key: TREE_DISPLAY_SETTINGS_KEY });
  events.dispatchEvent(storage);
  await vi.waitFor(() =>
    expect(panelDisplays.get("document-tree")?.fontSize).toBe(16),
  );
  pluginRuntime.setEnabled(false);
  expect(panelDisplays.get("document-tree")).toBeNull();
  pluginRuntime.setEnabled(true);
  await vi.waitFor(() =>
    expect(panelDisplays.get("document-tree")?.fontSize).toBe(16),
  );
  stop();
  stop = undefined;
  await vi.waitFor(() =>
    expect(pluginRuntime.getStatus().activations).toHaveLength(0),
  );
});

it("outline commands are slot-bound and revocation preserves the tree presenter", () => {
  const runtime = new PluginRuntime();
  runtime.setEnabled(true);
  const registry = new PanelDisplayRegistry(runtime);
  registry.register(runtime.activate("test.tree", []), DEFAULT_TREE_DISPLAY);
  const outline = runtime.activate("test.outline", []);
  registry.register(outline, DEFAULT_OUTLINE_DISPLAY);
  const current = registry.get("document-outline")!;
  let reveals = 0;
  expect(
    registry.run("document-outline", current, "outline.reveal-current", {
      "outline.reveal-current": () => reveals++,
    }),
  ).toBe(true);
  expect(() =>
    validatePanelDisplay({
      ...DEFAULT_OUTLINE_DISPLAY,
      toolbar: ["tree.refresh"],
    }),
  ).toThrow();
  expect(() =>
    validatePanelDisplay({
      ...DEFAULT_TREE_DISPLAY,
      toolbar: ["outline.reveal-current"],
    }),
  ).toThrow();
  runtime.deactivate(outline.pluginId);
  expect(
    registry.run("document-outline", current, "outline.reveal-current", {
      "outline.reveal-current": () => reveals++,
    }),
  ).toBe(false);
  expect(registry.get("document-tree")).not.toBeNull();
  expect(reveals).toBe(1);
});

it("outline preferences reject corrupt and cross-slot data without changing tree storage", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("window", new EventTarget());
  try {
    values.set("nr:pluginTreeDisplay", "tree-original");
    values.set(
      OUTLINE_DISPLAY_SETTINGS_KEY,
      JSON.stringify({ enabled: true, display: DEFAULT_TREE_DISPLAY }),
    );
    expect(outlineDisplay.read().enabled).toBe(false);
    values.set(OUTLINE_DISPLAY_SETTINGS_KEY, "bad-json");
    expect(outlineDisplay.read().display).toEqual(DEFAULT_OUTLINE_DISPLAY);
    expect(() =>
      outlineDisplay.save({ enabled: true, display: DEFAULT_TREE_DISPLAY }),
    ).toThrow();
    outlineDisplay.save({
      enabled: true,
      display: { ...DEFAULT_OUTLINE_DISPLAY, fontSize: 19 },
    });
    expect(outlineDisplay.read().display.fontSize).toBe(19);
    expect(values.get("nr:pluginTreeDisplay")).toBe("tree-original");
  } finally {
    vi.unstubAllGlobals();
  }
});

import { afterEach, expect, it } from "vitest";
import { strToU8 } from "fflate";
import {
  DEFAULT_STATUS_DISPLAY,
  validateStatusDisplay,
  statusDisplayStyle,
  statusDisplays,
} from "../../src/lib/plugin-system/status-display";
import { pluginRuntime } from "../../src/lib/plugin-system/runtime";
import { validatePluginPackage } from "../../src/lib/plugin-system/package-validation";
afterEach(() => pluginRuntime.setEnabled(false));
it.each([
  { fontSize: 8 },
  { fontSize: 21 },
  { paddingY: -1 },
  { paddingY: 13 },
  { gap: 25 },
  { bold: 1 },
  { items: ["navigation", "navigation"] },
  { items: ["evil"] },
  { color: "url(evil)" },
  { background: { light: "#aaa", dark: "#111111" } },
  { font: "url(evil)" },
  { extra: true },
])("rejects invalid presentation %j", (patch) => {
  expect(() =>
    validateStatusDisplay({ ...DEFAULT_STATUS_DISPLAY, ...patch }),
  ).toThrow();
});
it("keeps immutable fields, paired colors and host-safe style values", () => {
  const value = validateStatusDisplay({
    ...DEFAULT_STATUS_DISPLAY,
    color: { light: "#112233", dark: "#aabbcc" },
    items: ["history", "navigation"],
  });
  expect(Object.isFrozen(value.items)).toBe(true);
  expect(statusDisplayStyle(value)["--statusbar-color-dark"]).toBe("#aabbcc");
  expect(value.items).toEqual(["history", "navigation"]);
});
it("moves the legacy diagnostics status item out of the status bar without invalidating saved preferences", () => {
  const legacy = validateStatusDisplay({
    ...DEFAULT_STATUS_DISPLAY,
    items: [...DEFAULT_STATUS_DISPLAY.items, "diagnostics"],
  });
  expect(legacy.items).not.toContain("diagnostics");
  expect(legacy.items).toEqual(DEFAULT_STATUS_DISPLAY.items);
});
it("rejects overlapping owners, revokes by activation and ignores stale cleanup", () => {
  pluginRuntime.setEnabled(true);
  const a = pluginRuntime.activate("test.status-a", []),
    b = pluginRuntime.activate("test.status-b", []);
  const stop = statusDisplays.register(a, DEFAULT_STATUS_DISPLAY);
  expect(() => statusDisplays.register(b, DEFAULT_STATUS_DISPLAY)).toThrow(
    "接管",
  );
  pluginRuntime.deactivate(a.pluginId);
  statusDisplays.register(b, { ...DEFAULT_STATUS_DISPLAY, fontSize: 14 });
  stop();
  expect(statusDisplays.getSnapshot()?.fontSize).toBe(14);
  pluginRuntime.setEnabled(false);
  expect(statusDisplays.getSnapshot()).toBeNull();
});
it("admits a data-only status package and rejects unknown widget commands", async () => {
  const files = (display: unknown) => ({
    "manifest.json": strToU8(
      JSON.stringify({
        manifestVersion: 1,
        id: "acme.status",
        name: "状态栏",
        version: "1.0.0",
        engines: { nineRingsPluginApi: "^0.1.0" },
        contributes: { statusBar: display },
        integrity: { algorithm: "sha256", files: {} },
      }),
    ),
  });
  const data = await validatePluginPackage(files(DEFAULT_STATUS_DISPLAY));
  expect(data.statusBar?.items).toContain("navigation");
  expect(data.actions).toEqual([]);
  await expect(
    validatePluginPackage(
      files({ ...DEFAULT_STATUS_DISPLAY, items: ["run-script"] }),
    ),
  ).rejects.toThrow();
});

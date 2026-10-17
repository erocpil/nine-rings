import { afterEach, expect, it } from "vitest";
import { strToU8 } from "fflate";
import { DEFAULT_NUMBERING_DISPLAYS } from "../../src/lib/plugin-system/builtin-numbering-display";
import {
  numberingDisplays,
  numberingVariables,
  validateNumberingDisplay,
} from "../../src/lib/plugin-system/numbering-display";
import { pluginRuntime } from "../../src/lib/plugin-system/runtime";
import { validatePluginPackage } from "../../src/lib/plugin-system/package-validation";
import { editorGutterWidth } from "../../src/lib/editor-gutter";
const display = DEFAULT_NUMBERING_DISPLAYS[0];
afterEach(() => pluginRuntime.setEnabled(false));
it.each([
  { fontSize: 8 },
  { fontSize: 25 },
  { bold: "true" },
  { font: "url(evil)" },
  { color: "#ffffff" },
  { background: { light: "#eee", dark: "#111111" } },
  { color: { light: "#ffffff", dark: "#111111", extra: true } },
  { foldExpanded: "" },
  { foldCollapsed: "abcde" },
  { foldExpanded: "\n" },
  { extra: true },
])("rejects unsafe or incomplete display values: %j", (patch) => {
  expect(() => validateNumberingDisplay({ ...display, ...patch })).toThrow();
});
it("resolves semantic colors and separate light/dark colors without arbitrary CSS", () => {
  const value = validateNumberingDisplay({
    ...display,
    bold: true,
    italic: true,
    color: { light: "#123456", dark: "#abcdef" },
  });
  expect(numberingVariables(value, false)["--numbering-blocks-color"]).toBe(
    "#123456",
  );
  expect(numberingVariables(value, true)["--numbering-blocks-color"]).toBe(
    "#abcdef",
  );
  expect(
    numberingVariables(value, true)["--numbering-blocks-currentColor"],
  ).toBe("var(--accent)");
  expect(numberingVariables(value, true)["--numbering-blocks-style"]).toBe(
    "italic",
  );
});
it("rejects overlapping providers atomically and preserves the owner after stale cleanup", () => {
  pluginRuntime.setEnabled(true);
  const first = pluginRuntime.activate("test.first", []),
    next = pluginRuntime.activate("test.second", []);
  const dispose = numberingDisplays.register(first, [display]);
  expect(() =>
    numberingDisplays.register(next, [DEFAULT_NUMBERING_DISPLAYS[1], display]),
  ).toThrow("接管");
  expect(numberingDisplays.getSnapshot().source).toBeUndefined();
  pluginRuntime.deactivate("test.first");
  numberingDisplays.register(next, [display]);
  dispose();
  expect(numberingDisplays.getSnapshot().blocks).toEqual(display);
  pluginRuntime.setEnabled(false);
  expect(numberingDisplays.getSnapshot()).toEqual({});
});
it("larger numbers reserve sufficient gutter width and revoke without changing host defaults", () => {
  const width = editorGutterWidth(1000, true);
  pluginRuntime.setEnabled(true);
  const owner = pluginRuntime.activate("test.numbering", []);
  numberingDisplays.register(owner, [{ ...display, fontSize: 24 }]);
  expect(editorGutterWidth(1000, true)).toBeGreaterThan(width);
  pluginRuntime.deactivate(owner.pluginId);
  expect(editorGutterWidth(1000, true)).toBe(width);
});
it("accepts a script-free numbering package and rejects duplicate targets and raw CSS", async () => {
  const files = (gutters: unknown[]) => ({
    "manifest.json": strToU8(
      JSON.stringify({
        manifestVersion: 1,
        id: "acme.numbering",
        name: "编号",
        version: "1.0.0",
        engines: { nineRingsPluginApi: "^0.1.0" },
        contributes: { gutters },
        integrity: { algorithm: "sha256", files: {} },
      }),
    ),
  });
  const data = await validatePluginPackage(
    files([...DEFAULT_NUMBERING_DISPLAYS]),
  );
  expect(data.gutters).toHaveLength(2);
  expect(data.actions).toEqual([]);
  await expect(
    validatePluginPackage(files([display, display])),
  ).rejects.toThrow("重复");
  await expect(
    validatePluginPackage(files([{ ...display, color: "var(--evil)" }])),
  ).rejects.toThrow();
});

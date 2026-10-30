import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sourceShortcutSettings,
  sourceNavigationKeybindings,
} from "../../src/lib/source-navigation-shortcuts";
afterEach(() => vi.unstubAllGlobals());
describe("source shortcut settings", () => {
  it("uses safe defaults and ignores malformed bindings", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({
          expand: "x",
          shrink: "Alt-Shift-F5",
          bracket: "Mod-Shift-\\",
        }),
    });
    const settings = sourceShortcutSettings();
    expect(settings.expand).toBe("Alt-F1");
    expect(settings.shrink).toBe("Alt-Shift-F5");
    expect(settings.bracket).toBe("Mod-Shift-\\");
    expect(
      sourceNavigationKeybindings().some((binding) => binding.key === "x"),
    ).toBe(false);
  });
  it("supports clearing a binding", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify({ expand: "" }),
    });
    expect(
      sourceNavigationKeybindings().some((binding) => binding.key === "Alt-F1"),
    ).toBe(false);
  });
});

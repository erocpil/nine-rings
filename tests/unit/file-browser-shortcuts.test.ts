import { describe, expect, it, vi } from "vitest";
import {
  BROWSER_SHORTCUTS_KEY,
  browserShortcutAction,
  browserShortcutFromEvent,
  defaultBrowserShortcuts,
  displayBrowserShortcut,
  normalizeBrowserShortcut,
  readBrowserShortcuts,
  saveBrowserShortcuts,
  validateBrowserShortcuts,
} from "../../src/lib/local-files/browser-shortcuts";

const event = (key: string, extra = {}) => ({
  key,
  code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  defaultPrevented: false,
  repeat: false,
  ...extra,
});
describe.each([false, true])("file browser shortcut platform mac=%s", (mac) => {
  it("keeps platform defaults, modified typing and navigation separate", () => {
    const config = defaultBrowserShortcuts();
    expect(validateBrowserShortcuts(config, mac)).toBeNull();
    expect(browserShortcutAction(event("F5"), config, mac)).toBe("copy");
    expect(browserShortcutAction(event(" "), config, mac)).toBe("preview");
    expect(
      browserShortcutAction(
        event("l", mac ? { metaKey: true } : { ctrlKey: true }),
        config,
        mac,
      ),
    ).toBe("address");
    for (const extra of [
      { repeat: true },
      { isComposing: true },
      { defaultPrevented: true },
      { shiftKey: true },
    ])
      expect(browserShortcutAction(event("F5", extra), config, mac)).toBeNull();
    expect(browserShortcutAction(event("ArrowDown"), config, mac)).toBeNull();
    expect(browserShortcutAction(event("x"), config, mac)).toBeNull();
  });
  it("rejects aliases of duplicate and reserved bindings, permits disabling", () => {
    const config = defaultBrowserShortcuts();
    config.copy = [mac ? "Meta+L" : "Ctrl+L"];
    expect(validateBrowserShortcuts(config, mac)).toContain("编辑当前路径");
    config.copy = ["Mod+W"];
    expect(validateBrowserShortcuts(config, mac)).toContain("保留");
    config.copy = ["A"];
    expect(validateBrowserShortcuts(config, mac)).toContain("普通输入");
    config.copy = [];
    expect(validateBrowserShortcuts(config, mac)).toBeNull();
    expect(browserShortcutAction(event("F5"), config, mac)).toBeNull();
    config.copy = ["F9"];
    const reservations = [{ shortcut: "F9", label: "宿主操作" }];
    expect(validateBrowserShortcuts(config, mac, reservations)).toContain(
      "宿主操作",
    );
    expect(
      browserShortcutAction(event("F9"), config, mac, reservations),
    ).toBeNull();
  });
  it("loads partial preferences, preserves defaults and falls back on corrupt data", () => {
    const store = (raw: string) => ({ getItem: () => raw, setItem: vi.fn() });
    const config = readBrowserShortcuts(
      store('{"copy":["f9"],"preview":[]}'),
      mac,
    );
    expect(config.copy).toEqual(["F9"]);
    expect(config.preview).toEqual([]);
    expect(config.rename).toEqual(["F2"]);
    for (const raw of [
      "invalid",
      "[]",
      '{"copy":[null]}',
      '{"copy":["F2"]}',
      '{"copy":["F1","F2","F3"]}',
    ])
      expect(readBrowserShortcuts(store(raw), mac)).toEqual(
        defaultBrowserShortcuts(),
      );
    expect(
      readBrowserShortcuts(
        {
          getItem() {
            throw new Error("blocked");
          },
          setItem: vi.fn(),
        },
        mac,
      ),
    ).toEqual(defaultBrowserShortcuts());
  });
});
it("normalizes recorded physical keys and renders platform labels", () => {
  expect(normalizeBrowserShortcut("option+command+k")).toBe("Meta+Alt+K");
  expect(normalizeBrowserShortcut("Ctrl+Ctrl+K")).toBeNull();
  expect(normalizeBrowserShortcut("Ctrl+Unknown")).toBeNull();
  expect(normalizeBrowserShortcut("x".repeat(61))).toBeNull();
  expect(browserShortcutFromEvent(event("Meta"), true)).toBeNull();
  expect(
    browserShortcutFromEvent(
      event("˚", { code: "KeyK", altKey: true, metaKey: true }),
      true,
    ),
  ).toBe("Mod+Alt+K");
  expect(displayBrowserShortcut("Mod+Alt+Space", true)).toBe("⌘ + ⌥ + 空格");
  expect(displayBrowserShortcut("Mod+L", false)).toBe("Ctrl + L");
});
it("writes and notifies only after validation and successful storage", () => {
  const dispatchEvent = vi.fn();
  vi.stubGlobal("window", { dispatchEvent });
  try {
    const store = { getItem: () => null, setItem: vi.fn() };
    const config = defaultBrowserShortcuts();
    config.copy = ["F9"];
    saveBrowserShortcuts(store, config, false);
    expect(store.setItem).toHaveBeenCalledWith(
      BROWSER_SHORTCUTS_KEY,
      JSON.stringify(config),
    );
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    store.setItem.mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveBrowserShortcuts(store, config, false)).toThrow("quota");
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    config.copy = ["F2"];
    expect(() => saveBrowserShortcuts(store, config, false)).toThrow("重命名");
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

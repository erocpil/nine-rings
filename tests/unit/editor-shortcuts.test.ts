import { describe, expect, it } from "vitest";
import {
  editorShortcutAction,
  matchesCommandShortcut,
  editorShortcutSpecs,
  shortcutLabel,
} from "../../src/lib/editor-shortcuts";
const key = (code: string, overrides = {}) => ({
  key: "",
  code,
  metaKey: true,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
});
describe("shared editor shortcuts", () => {
  it("has one owner for every accelerator and leaves native responder editing keys alone", () => {
    expect(
      new Set(editorShortcutSpecs.map((spec) => spec.accelerator)).size,
    ).toBe(editorShortcutSpecs.length);
    for (const code of ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyA", "KeyQ"])
      expect(editorShortcutAction(key(code), "MacIntel")).toBeUndefined();
    expect(editorShortcutAction(key("KeyW"), "MacIntel")).toBe(
      "document.close",
    );
    expect(
      editorShortcutAction(key("KeyW", { shiftKey: true }), "MacIntel"),
    ).toBe("window.hide");
  });
  it("uses the platform primary modifier with exact modifiers", () => {
    expect(editorShortcutAction(key("KeyB"), "MacIntel")).toBe("format.bold");
    expect(editorShortcutAction(key("KeyB"), "Win32")).toBeUndefined();
    expect(
      editorShortcutAction(
        key("KeyB", { metaKey: false, ctrlKey: true }),
        "Win32",
      ),
    ).toBe("format.bold");
    expect(
      editorShortcutAction(key("KeyB", { ctrlKey: true }), "MacIntel"),
    ).toBeUndefined();
    expect(
      editorShortcutAction(
        key("KeyB", { altKey: true, shiftKey: true }),
        "MacIntel",
      ),
    ).toBeUndefined();
  });
  it("uses physical keys for shifted digits and macOS Option symbols", () => {
    expect(
      editorShortcutAction(
        key("Digit8", { key: "*", shiftKey: true }),
        "MacIntel",
      ),
    ).toBe("format.bullet");
    expect(
      editorShortcutAction(
        key("Digit3", { key: "£", altKey: true }),
        "MacIntel",
      ),
    ).toBe("format.h3");
    expect(editorShortcutAction(key("Comma"), "MacIntel")).toBe(
      "workspace.settings",
    );
    expect(editorShortcutAction(key("Backslash"), "MacIntel")).toBe(
      "format.clear",
    );
  });
  it("renders platform labels from the same command catalog", () => {
    expect(shortcutLabel("format.h3", "MacIntel")).toBe("⌥⌘3");
    expect(shortcutLabel("format.h3", "Win32")).toBe("Ctrl+Alt+3");
    expect(shortcutLabel("edit.redo", "MacIntel")).toBe("⇧⌘Z");
    expect(shortcutLabel("edit.redo", "Win32")).toBe("Ctrl+Y");
  });
});

it("matches configurable summary keys across platforms and keyboard layouts", () => {
  expect(
    matchesCommandShortcut(
      key("Digit1", { metaKey: false, altKey: true, key: "¡" }),
      "Alt+1",
      "MacIntel",
    ),
  ).toBe(true);
  expect(
    matchesCommandShortcut(key("Digit2"), "CommandOrControl+2", "MacIntel"),
  ).toBe(true);
  expect(
    matchesCommandShortcut(
      key("Digit2", { metaKey: false, ctrlKey: true }),
      "CommandOrControl+2",
      "Win32",
    ),
  ).toBe(true);
  expect(
    matchesCommandShortcut(key("Digit2"), "CommandOrControl+2", "Win32"),
  ).toBe(false);
  expect(
    matchesCommandShortcut(
      key("Digit1", { metaKey: false, altKey: true, shiftKey: true }),
      "Alt+1",
      "MacIntel",
    ),
  ).toBe(false);
  expect(
    matchesCommandShortcut(
      key("Digit1", { metaKey: false }),
      "Typo+1",
      "MacIntel",
    ),
  ).toBe(false);
  expect(matchesCommandShortcut(key("Digit1"), "", "MacIntel")).toBe(false);
});

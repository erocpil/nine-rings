import {
  currentEditorCommandAnchor,
  withEditorCommandTrigger,
} from "../../src/lib/editor-command-surface";
import { describe, expect, it } from "vitest";
import { anchoredMenuPosition } from "../../src/lib/anchored-menu-position";

describe("command submenu geometry", () => {
  const viewport = { width: 1280, height: 800 };
  const menu = { width: 190, height: 220 };
  it("opens beside the invoking row and flips at the right edge", () => {
    expect(
      anchoredMenuPosition(
        { left: 200, right: 400, top: 320, bottom: 350 },
        menu,
        viewport,
        "side",
      ),
    ).toEqual({ x: 406, y: 320 });
    expect(
      anchoredMenuPosition(
        { left: 1000, right: 1200, top: 320, bottom: 350 },
        menu,
        viewport,
        "side",
      ),
    ).toEqual({ x: 804, y: 320 });
  });
  it("clamps tall menus while retaining the direct-toolbar below/above placement", () => {
    const anchor = { left: 200, right: 400, top: 700, bottom: 730 };
    expect(anchoredMenuPosition(anchor, menu, viewport, "side")).toEqual({
      x: 406,
      y: 572,
    });
    expect(anchoredMenuPosition(anchor, menu, viewport, "below")).toEqual({
      x: 200,
      y: 474,
    });
    expect(
      anchoredMenuPosition(
        { ...anchor, top: 100, bottom: 130 },
        menu,
        viewport,
        "below",
      ),
    ).toEqual({ x: 200, y: 136 });
  });
});

it("command invocation anchors are scoped and never leak into later keyboard commands", () => {
  const outer = {
    getBoundingClientRect: () => ({
      left: 30,
      right: 60,
      top: 80,
      bottom: 108,
    }),
  } as HTMLElement;
  const inner = {
    getBoundingClientRect: () => ({
      left: 90,
      right: 120,
      top: 80,
      bottom: 108,
    }),
  } as HTMLElement;
  expect(currentEditorCommandAnchor()).toBeUndefined();
  withEditorCommandTrigger(outer, () => {
    expect(currentEditorCommandAnchor()?.rect.left).toBe(30);
    expect(() =>
      withEditorCommandTrigger(inner, () => {
        throw new Error("cancel");
      }),
    ).toThrow("cancel");
    expect(currentEditorCommandAnchor()?.rect.left).toBe(30);
  });
  expect(currentEditorCommandAnchor()).toBeUndefined();
});

import { describe, expect, it, vi } from "vitest";
import {
  defaultFocusTabs,
  focusTabIds,
  normalizeFocusTabs,
  readFocusTabs,
} from "../../src/lib/focus-tabs";

describe("专注文档标签与最近记录独立", () => {
  it("关闭、重排、限制仅作用于展示投影，不修改最近记录", () => {
    const recent = ["a", "b", "c", "d"];
    expect(
      focusTabIds(recent, {
        ...defaultFocusTabs,
        closed: ["b"],
        order: ["c", "a"],
        limit: 2,
      }),
    ).toEqual(["c", "a"]);
    expect(recent).toEqual(["a", "b", "c", "d"]);
    expect(
      focusTabIds(recent, {
        ...defaultFocusTabs,
        closed: ["b"],
        order: ["missing", "c"],
      }),
    ).toEqual(["c", "a", "d"]);
  });
  it("最近访问顺序变化不重排已建立的标签顺序", () => {
    const state = { ...defaultFocusTabs, order: ["a", "b", "c"] };
    expect(focusTabIds(["c", "a", "b", "new"], state)).toEqual([
      "a",
      "b",
      "c",
      "new",
    ]);
    expect(defaultFocusTabs.limit).toBe(32);
  });
  it("损坏偏好回退并限制重复或越界数据", () => {
    expect(
      normalizeFocusTabs({ limit: NaN, order: ["a", "a"], closed: [] }),
    ).toEqual({ ...defaultFocusTabs, order: ["a"] });
    expect(normalizeFocusTabs({ limit: 200 }).limit).toBe(64);
    expect(normalizeFocusTabs({ limit: -2 }).limit).toBe(1);
  });
  it("旧默认上限迁移为 32，显式新设置和其它自定义上限保留", () => {
    let raw = JSON.stringify({ limit: 16, visible: false, order: ["a"] });
    vi.stubGlobal("localStorage", { getItem: () => raw });
    try {
      expect(readFocusTabs()).toMatchObject({
        limit: 32,
        visible: false,
        order: ["a"],
      });
      raw = JSON.stringify({ version: 2, limit: 16 });
      expect(readFocusTabs().limit).toBe(16);
      raw = JSON.stringify({ limit: 4 });
      expect(readFocusTabs().limit).toBe(4);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

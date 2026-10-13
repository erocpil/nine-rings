import { describe, expect, it } from "vitest";
import {
  defaultFocusTabs,
  focusTabIds,
  normalizeFocusTabs,
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
  it("损坏偏好回退并限制重复或越界数据", () => {
    expect(
      normalizeFocusTabs({ limit: NaN, order: ["a", "a"], closed: [] }),
    ).toEqual({ ...defaultFocusTabs, order: ["a"] });
    expect(normalizeFocusTabs({ limit: 200 }).limit).toBe(20);
    expect(normalizeFocusTabs({ limit: -2 }).limit).toBe(1);
  });
});

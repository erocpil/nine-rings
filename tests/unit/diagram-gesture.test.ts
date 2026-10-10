import { describe, expect, it } from "vitest";
import { pinchScale, pinchView } from "../../src/lib/diagram-gesture";

describe("diagram two-finger gestures", () => {
  const center = { x: 200, y: 150 };
  const a = { x: 130, y: 130 },
    b = { x: 230, y: 130 };
  it("keeps the original content point beneath the moving finger center while zooming", () => {
    const before = { scale: 2, x: 15, y: -10 };
    const next = pinchView(
      before,
      a,
      b,
      { x: 110, y: 160 },
      { x: 310, y: 160 },
      center,
    );
    expect(next.scale).toBe(4);
    expect((210 - center.x - next.x) / next.scale).toBe(
      (180 - center.x - before.x) / before.scale,
    );
    expect((160 - center.y - next.y) / next.scale).toBe(
      (130 - center.y - before.y) / before.scale,
    );
  });
  it("parallel movement pans in both axes without changing scale", () => {
    expect(
      pinchView(
        { scale: 1, x: 10, y: 20 },
        a,
        b,
        { x: 160, y: 110 },
        { x: 260, y: 110 },
        center,
      ),
    ).toEqual({ scale: 1, x: 40, y: 0 });
  });
  it("opposite diagonal movement zooms using actual distance, without stretching the diagram", () => {
    expect(
      pinchScale(1, a, b, { x: 80, y: 30 }, { x: 280, y: 230 }),
    ).toBeCloseTo(Math.sqrt(8));
    expect(pinchScale(1, a, b, { x: 155, y: 130 }, { x: 205, y: 130 })).toBe(
      0.5,
    );
  });
  it("clamps zoom and avoids invalid division when fingers coincide", () => {
    expect(pinchScale(4, a, b, { x: 0, y: 0 }, { x: 1000, y: 0 })).toBe(8);
    expect(pinchScale(0.5, a, b, a, a)).toBe(0.25);
    expect(pinchScale(2, a, a, a, b)).toBe(2);
  });
});

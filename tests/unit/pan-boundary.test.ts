import { expect, it } from "vitest";
import { constrainPanAxis, visiblePanLimit } from "../../src/lib/pan-boundary";
it("stops at either edge and allows returning from old out-of-range positions", () => {
  expect(constrainPanAxis(0, 999, 100)).toBe(100);
  expect(constrainPanAxis(100, 120, 100)).toBe(100);
  expect(constrainPanAxis(0, -999, 100)).toBe(-100);
  expect(constrainPanAxis(-100, -120, 100)).toBe(-100);
  expect(constrainPanAxis(200, 300, 100)).toBe(200);
  expect(constrainPanAxis(200, 180, 100)).toBe(180);
  expect(constrainPanAxis(-200, -300, 100)).toBe(-200);
  expect(constrainPanAxis(-200, -180, 100)).toBe(-180);
  expect(visiblePanLimit(32, 800)).toBe(392);
});

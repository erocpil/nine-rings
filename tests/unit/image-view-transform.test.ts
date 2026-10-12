import { describe, it, expect } from "vitest";
import {
  applyImageTransform,
  DEFAULT_IMAGE_RECIPE,
  imageFitScale,
  imageRecipeCss,
} from "../../src/lib/image-library/view-transform";
describe("non-destructive image transforms", () => {
  it("rotates a portrait into landscape and fits its rotated extent", () => {
    expect(imageFitScale(800, 1600, 1000, 600, 0)).toBe(0.375);
    expect(imageFitScale(800, 1600, 1000, 600, 1)).toBe(0.625);
    expect(imageFitScale(32, 32, 1000, 600, 0)).toBe(1);
    expect(imageFitScale(0, 32, 1000, 600, 0)).toBe(1);
  });
  it("operations are reversible and leave input untouched", () => {
    const right = applyImageTransform(
      { ...DEFAULT_IMAGE_RECIPE },
      "rotate-right",
    );
    expect(right.quarterTurns).toBe(1);
    expect(applyImageTransform(right, "rotate-left")).toEqual(
      DEFAULT_IMAGE_RECIPE,
    );
    const flipped = applyImageTransform(right, "flip-horizontal");
    expect(imageRecipeCss(flipped)).toBe("rotate(90deg) scale(-1,1)");
    expect(right.flipHorizontal).toBe(false);
    expect(applyImageTransform(flipped, "flip-horizontal")).toEqual(right);
    expect(applyImageTransform(flipped, "reset")).toEqual(DEFAULT_IMAGE_RECIPE);
  });
});

import { describe, expect, it } from "vitest";
import { mapScrollPosition } from "../../src/lib/scroll-position-map";

describe("content boundary scroll mapping", () => {
  const anchors = [
    { source: 0, preview: 0 },
    { source: 100, preview: 300 },
    { source: 500, preview: 600 },
  ];
  it("maps unequal block heights continuously and in both directions", () => {
    expect(mapScrollPosition(50, anchors, "source")).toBe(150);
    expect(mapScrollPosition(300, anchors, "source")).toBe(450);
    expect(mapScrollPosition(450, anchors, "preview")).toBe(300);
    for (const offset of [1, 99, 100, 101, 499])
      expect(
        mapScrollPosition(
          mapScrollPosition(offset, anchors, "source"),
          anchors,
          "preview",
        ),
      ).toBeCloseTo(offset);
  });
  it("preserves document boundaries and clamps overscroll", () => {
    expect(mapScrollPosition(-5, anchors, "source")).toBe(0);
    expect(mapScrollPosition(1000, anchors, "source")).toBe(600);
    expect(mapScrollPosition(1000, anchors, "preview")).toBe(500);
  });
  it("handles empty or non-scrollable documents", () => {
    expect(mapScrollPosition(50, [], "source")).toBe(0);
    expect(
      mapScrollPosition(
        20,
        [
          { source: 0, preview: 0 },
          { source: 0, preview: 100 },
        ],
        "preview",
      ),
    ).toBe(0);
  });
});

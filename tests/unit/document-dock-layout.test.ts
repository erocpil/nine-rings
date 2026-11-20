import { describe, expect, it } from "vitest";
import {
  moveDockPanel,
  normalizeDocumentDock,
  openDockPanel,
  visibleDockGroups,
  type DocumentDockLayout,
} from "../../src/lib/document-dock-layout";

const initial: DocumentDockLayout = {
  groups: [
    { panels: ["outline"], active: "outline", weight: 0.7 },
    { panels: ["bookmark"], active: "bookmark", weight: 0.3 },
  ],
  closed: [],
};

describe("document dock placement", () => {
  it("keeps one row per panel and normalizes damaged preferences", () => {
    expect(
      normalizeDocumentDock({
        groups: [
          { panels: ["outline", "bad", "outline"], active: "bad", weight: -3 },
          {
            panels: ["outline", "matches"],
            active: "matches",
            weight: Infinity,
          },
        ],
        closed: ["bookmark", "matches", "matches"],
      }),
    ).toEqual({
      groups: [
        { panels: ["outline"], active: "outline", weight: 0.01 },
        { panels: ["matches"], active: "matches", weight: 1 },
      ],
      closed: ["matches"],
    });
    expect(normalizeDocumentDock(undefined)).toBeUndefined();
    expect(
      normalizeDocumentDock({ groups: [{ panels: ["unsupported"] }] }),
    ).toBeUndefined();
  });

  it("reorders rows, groups into tabs, then splits the active tab above its peer", () => {
    const reordered = moveDockPanel(initial, "bookmark", "outline", "before");
    expect(reordered.groups.map((group) => group.active)).toEqual([
      "bookmark",
      "outline",
    ]);
    expect(reordered.groups[0].weight).toBe(0.3);
    const tabbed = moveDockPanel(reordered, "bookmark", "outline", "tab");
    expect(tabbed.groups).toEqual([
      { panels: ["outline", "bookmark"], active: "bookmark", weight: 0.7 },
    ]);
    const split = moveDockPanel(tabbed, "bookmark", "outline", "before");
    expect(split.groups).toEqual([
      { panels: ["bookmark"], active: "bookmark", weight: 0.35 },
      { panels: ["outline"], active: "outline", weight: 0.35 },
    ]);
    expect(moveDockPanel(split, "outline", "outline", "tab")).toBe(split);
  });

  it("keeps the active preference while a capability is absent and reopens closed panels in place", () => {
    const withMatches = moveDockPanel(initial, "matches", "outline", "tab");
    expect(
      visibleDockGroups(withMatches, (panel) => panel !== "matches")[0].active,
    ).toBe("outline");
    expect(visibleDockGroups(withMatches, () => true)[0].active).toBe(
      "matches",
    );
    const closed = openDockPanel(withMatches, "matches", true);
    expect(visibleDockGroups(closed, () => true)[0].panels).toEqual([
      "outline",
    ]);
    expect(openDockPanel(closed, "matches")).toEqual(withMatches);
    expect(openDockPanel(initial, "matches").groups.at(-1)?.active).toBe(
      "matches",
    );
  });
});

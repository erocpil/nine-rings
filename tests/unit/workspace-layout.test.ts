import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WORKSPACE_LAYOUT,
  normalizeWorkspaceLayout,
  readWorkspaceLayout,
  saveWorkspaceLayout,
  WORKSPACE_LAYOUT_KEY,
} from "../../src/lib/workspace-layout";
import {
  collectFrontendSettings,
  restoreFrontendSettings,
} from "../../src/lib/backup-user-settings";

describe("workspace layout preferences", () => {
  let values: Map<string, string>;
  beforeEach(() => {
    values = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("window", new EventTarget());
  });
  afterEach(() => vi.unstubAllGlobals());
  it("defaults to right dock, vertical 2:1 and a left workspace", () => {
    expect(readWorkspaceLayout()).toEqual(DEFAULT_WORKSPACE_LAYOUT);
  });
  it("preserves old fullscreen hover preferences and normalizes one exclusive scope", () => {
    expect(
      normalizeWorkspaceLayout({ fullscreenQuietChrome: true }),
    ).toMatchObject({
      fullscreenQuietChrome: true,
      quietChromeScope: "fullscreen",
    });
    for (const quietChromeScope of [
      "always",
      "fullscreen",
      "windowed",
    ] as const) {
      expect(
        saveWorkspaceLayout({ fullscreenQuietChrome: true, quietChromeScope }),
      ).toBe(true);
      expect(readWorkspaceLayout().quietChromeScope).toBe(quietChromeScope);
    }
    expect(
      normalizeWorkspaceLayout({ quietChromeScope: ["always", "windowed"] })
        .quietChromeScope,
    ).toBe("fullscreen");
  });
  it("migrates the old outline dock and width without pinning bookmarks", () => {
    values.set("nr:documentOutlineDock", "left");
    values.set("nr:documentOutlineWidth", "340");
    expect(readWorkspaceLayout()).toMatchObject({
      panelsSide: "left",
      outlinePinned: true,
      bookmarkPinned: false,
      panelWidth: 340,
    });
    saveWorkspaceLayout({ outlinePinned: false });
    expect(readWorkspaceLayout().outlinePinned).toBe(false);
  });
  it("validates imported values and recovers corrupt storage", () => {
    expect(
      normalizeWorkspaceLayout({
        panelRatio: 9,
        matchesRatio: -1,
        panelWidth: -1,
        horizontalPanelWidth: Infinity,
        sidebarSide: "bad",
        outlinePinned: "true",
      }),
    ).toMatchObject({
      panelRatio: 0.85,
      matchesRatio: 0.15,
      panelWidth: 180,
      horizontalPanelWidth: 520,
      sidebarSide: "left",
      outlinePinned: false,
    });
    values.set(WORKSPACE_LAYOUT_KEY, "{");
    expect(readWorkspaceLayout()).toEqual(DEFAULT_WORKSPACE_LAYOUT);
  });
  it("merges independent changes, emits notification and preserves layout through backup", () => {
    const notify = vi.fn();
    window.addEventListener("nr:workspace-layout-change", notify);
    saveWorkspaceLayout({
      summaryInteraction: "click",
      summaryVisibleRows: 8,
      panelRatio: 0.4,
      matchesRatio: 0.45,
      sidebarSide: "right",
      outlinePinned: true,
    });
    saveWorkspaceLayout({
      bookmarkPinned: true,
      panelsArrangement: "horizontal",
    });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(readWorkspaceLayout().matchesRatio).toBe(0.45);
    const original = readWorkspaceLayout();
    const backup = collectFrontendSettings(localStorage);
    values.clear();
    restoreFrontendSettings(backup, localStorage);
    expect(readWorkspaceLayout()).toEqual(original);
  });
  it("normalizes summary modes and whole visible rows, with backwards-compatible defaults", () => {
    expect(normalizeWorkspaceLayout({})).toMatchObject({
      summaryInteraction: "click",
      summaryVisibleRows: 16,
    });
    expect(
      normalizeWorkspaceLayout({
        summaryInteraction: "hover",
        summaryVisibleRows: 5.7,
      }),
    ).toMatchObject({ summaryInteraction: "hover", summaryVisibleRows: 6 });
    expect(
      normalizeWorkspaceLayout({
        summaryInteraction: "bad",
        summaryVisibleRows: Infinity,
      }),
    ).toMatchObject({ summaryInteraction: "click", summaryVisibleRows: 16 });
    expect(
      normalizeWorkspaceLayout({ summaryVisibleRows: -1 }).summaryVisibleRows,
    ).toBe(1);
    expect(
      normalizeWorkspaceLayout({ summaryVisibleRows: 999 }).summaryVisibleRows,
    ).toBe(50);
  });

  it("reports unavailable storage without throwing", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    });
    expect(readWorkspaceLayout()).toEqual(DEFAULT_WORKSPACE_LAYOUT);
    expect(saveWorkspaceLayout({ sidebarSide: "right" })).toBe(false);
  });
});

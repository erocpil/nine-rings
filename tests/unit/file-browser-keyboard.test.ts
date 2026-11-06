import { expect, it } from "vitest";
import {
  browserNavigationIndex,
  browserRowScroll,
  browserTypeahead,
} from "../../src/lib/local-files/browser-keyboard";
import {
  activeBrowserPanes,
  addBrowserTab,
  exchangeBrowserPanes,
  mirrorBrowserPath,
  parseBrowserWorkspace,
  updateBrowserTab,
} from "../../src/lib/local-files/browser-tabs";
import {
  browserLocation,
  navigateBrowserPane,
  updateBrowserLocation,
} from "../../src/lib/local-files/browser-state";
it("supports bounded arrows, page movement and Home/End for loaded rows", () => {
  expect(browserNavigationIndex("ArrowDown", -1, 30, 10)).toBe(0);
  expect(browserNavigationIndex("ArrowUp", 0, 30, 10)).toBe(0);
  expect(browserNavigationIndex("PageDown", 7, 30, 10)).toBe(16);
  expect(browserNavigationIndex("PageUp", 16, 30, 10)).toBe(7);
  expect(browserNavigationIndex("Home", 23, 30, 10)).toBe(0);
  expect(browserNavigationIndex("End", 0, 30, 10)).toBe(29);
  expect(browserNavigationIndex("PageDown", 29, 30, 0)).toBe(29);
  expect(browserNavigationIndex("Home", 0, 0, 10)).toBeNull();
  expect(browserNavigationIndex("Enter", 0, 30, 10)).toBeNull();
});
it("scrolls only enough to reveal the current row", () => {
  expect(browserRowScroll(96, 320, 7, 32)).toBe(96);
  expect(browserRowScroll(96, 320, 2, 32)).toBe(64);
  expect(browserRowScroll(96, 320, 13, 32)).toBe(128);
});
it("incremental name location keeps a full prefix, cycles repeated initials and expires", () => {
  const names = ["alpha", "alpine", "beta", "alphabet"];
  let search = browserTypeahead(names, -1, { query: "", at: 0 }, "a", 100);
  expect(search.index).toBe(0);
  search = browserTypeahead(names, search.index, search, "l", 150);
  expect(search).toMatchObject({ query: "al", index: 0 });
  search = browserTypeahead(names, search.index, search, "p", 200);
  expect(search.query).toBe("alp");
  search = browserTypeahead(names, 0, { query: "a", at: 100 }, "a", 200);
  expect(search.index).toBe(1);
  search = browserTypeahead(names, 3, { query: "a", at: 100 }, "a", 200);
  expect(search.index).toBe(0);
  expect(browserTypeahead(names, 0, search, "b", 2000)).toMatchObject({
    query: "b",
    index: 2,
  });
  expect(browserTypeahead(names, 0, search, "z", 220)).toMatchObject({
    query: "az",
    index: -1,
  });
  expect(browserTypeahead([], -1, search, "x", 2000).index).toBe(-1);
});
it("exchanges complete tab groups and mirrors only the opposite active directory", () => {
  let state = parseBrowserWorkspace(null);
  state = updateBrowserTab(state, 0, (pane) =>
    updateBrowserLocation(navigateBrowserPane(pane, "left", "src"), {
      selected: ["src/a.c"],
      scrollTop: 420,
    }),
  );
  state = updateBrowserTab(state, 1, (pane) =>
    navigateBrowserPane(pane, "right", "docs"),
  );
  state = addBrowserTab(state, 1);
  state.active = 0;
  const otherTab = state.groups[1].tabs[0];
  const mirrored = mirrorBrowserPath(state);
  expect(browserLocation(activeBrowserPanes(mirrored)[1])).toMatchObject({
    rootId: "left",
    node: "src",
    selected: [],
  });
  expect(mirrored.groups[1].tabs[0]).toBe(otherTab);
  expect(mirrored.active).toBe(0);
  const exchanged = exchangeBrowserPanes(state);
  expect(exchanged.active).toBe(1);
  expect(exchanged.groups[1]).toBe(state.groups[0]);
  expect(browserLocation(activeBrowserPanes(exchanged)[1])).toMatchObject({
    node: "src",
    scrollTop: 420,
    selected: ["src/a.c"],
  });
  expect(mirrorBrowserPath(parseBrowserWorkspace(null)).active).toBe(0);
});

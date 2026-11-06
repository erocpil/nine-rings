import { expect, it } from "vitest";
import {
  browserLocation,
  emptyBrowserState,
  moveBrowserHistory,
  navigateBrowserPane,
  parseBrowserState,
  selectBrowserItems,
  updateBrowserLocation,
} from "../../src/lib/local-files/browser-state";

it("keeps independent panes, restores history selection and scroll, and clears the forward branch", () => {
  const state = emptyBrowserState();
  let pane = navigateBrowserPane(state.panes[0], "r", "src");
  pane = updateBrowserLocation(pane, { selected: ["src/a.c"], scrollTop: 350 });
  pane = navigateBrowserPane(pane, "r", "docs");
  pane = moveBrowserHistory(pane, -1);
  expect(browserLocation(pane)).toEqual({
    rootId: "r",
    node: "src",
    selected: ["src/a.c"],
    scrollTop: 350,
  });
  expect(state.panes[1].history).toEqual([]);
  pane = navigateBrowserPane(pane, "r", "other");
  expect(pane.history.map((entry) => entry.node)).toEqual(["src", "other"]);
  expect(moveBrowserHistory(pane, 1).index).toBe(1);
  expect(moveBrowserHistory(emptyBrowserState().panes[0], -1).index).toBe(-1);
  expect(navigateBrowserPane(pane, "r", "other")).toBe(pane);
});
it("bounds history and rejects root escapes", () => {
  let pane = emptyBrowserState().panes[0];
  for (let i = 0; i < 60; i++) pane = navigateBrowserPane(pane, "r", `dir${i}`);
  expect(pane.history).toHaveLength(40);
  expect(pane.index).toBe(39);
  for (const path of ["../bad", "/bad", "a//b", "C:\\bad"])
    expect(() => navigateBrowserPane(pane, "r", path)).toThrow();
});
it("supports toggle and range selection without selecting unknown ancestors", () => {
  const ids = ["a", "b", "c", "d"];
  expect(selectBrowserItems(["a"], ids, "c", "a", false, true)).toEqual([
    "a",
    "b",
    "c",
  ]);
  expect(selectBrowserItems(["d"], ids, "b", "a", true, true)).toEqual([
    "d",
    "a",
    "b",
  ]);
  expect(selectBrowserItems(["a", "b"], ids, "a", null, true, false)).toEqual([
    "b",
  ]);
  expect(selectBrowserItems(["a"], ids, "c", "missing", false, true)).toEqual([
    "c",
  ]);
});
it("normalizes persisted UI state and rejects invalid or oversized input", () => {
  const pane = updateBrowserLocation(
    navigateBrowserPane(emptyBrowserState().panes[0], "r", "src"),
    { scrollTop: 200, selected: ["src/a.c", "else/b.c", "../bad", "src/a.c"] },
  );
  const parsed = parseBrowserState(
    JSON.stringify({ panes: [pane], active: 1, ratio: 4 }),
  );
  expect(parsed.ratio).toBe(0.75);
  expect(parsed.active).toBe(1);
  expect(browserLocation(parsed.panes[0])?.selected).toEqual(["src/a.c"]);
  expect(parsed.panes[1].index).toBe(-1);
  for (const raw of [
    null,
    "bad",
    " ".repeat(512 * 1024 + 1),
    JSON.stringify({
      panes: [{ history: [{ rootId: "r", node: "../escape" }] }],
    }),
  ])
    expect(parseBrowserState(raw)).toEqual(emptyBrowserState());
});

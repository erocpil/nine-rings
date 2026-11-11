import { expect, it } from "vitest";
import {
  addBrowserTab,
  browserTabAnchor,
  modifyBrowserTabs,
  parseBrowserWorkspace,
  reconcileBrowserTabs,
  revokeBrowserRoot,
  selectBrowserTab,
  updateBrowserTab,
} from "../../src/lib/local-files/browser-tabs";
import {
  browserLocation,
  navigateBrowserPane,
} from "../../src/lib/local-files/browser-state";
const setup = () => {
  let state = updateBrowserTab(parseBrowserWorkspace(null), 0, (tab) =>
    navigateBrowserPane(tab, "r", "base"),
  );
  state = modifyBrowserTabs(state, 0, state.groups[0].tabs[0].tabId, "pin");
  return state;
};
it("pin captures an independent base, navigation stays free and round trips without changing its title", () => {
  let state = setup();
  state = updateBrowserTab(state, 0, (tab) =>
    navigateBrowserPane(tab, "r", "base/sub"),
  );
  expect(browserTabAnchor(state.groups[0].tabs[0])).toMatchObject({
    rootId: "r",
    node: "base",
    label: "base",
  });
  state = updateBrowserTab(state, 0, (tab) =>
    navigateBrowserPane(tab, "r", "sibling"),
  );
  state = parseBrowserWorkspace(JSON.stringify(state));
  expect(browserLocation(state.groups[0].tabs[0])?.node).toBe("sibling");
  expect(browserTabAnchor(state.groups[0].tabs[0])?.node).toBe("base");
  state = modifyBrowserTabs(state, 0, state.groups[0].tabs[0].tabId, "home");
  expect(browserLocation(state.groups[0].tabs[0])?.node).toBe("base");
});
it("restriction admits descendants, rejects sibling-prefix and other grants, and can be disabled", () => {
  let state = setup();
  const id = state.groups[0].tabs[0].tabId;
  state = modifyBrowserTabs(state, 0, id, "limit");
  for (const [root, node] of [
    ["r", "base2"],
    ["r", ""],
    ["other", "base"],
  ]) {
    state = updateBrowserTab(state, 0, (tab) =>
      navigateBrowserPane(tab, root, node),
    );
    expect(browserLocation(state.groups[0].tabs[0])?.node).toBe("base");
  }
  state = updateBrowserTab(state, 0, (tab) =>
    navigateBrowserPane(tab, "r", "base/sub"),
  );
  expect(browserLocation(state.groups[0].tabs[0])?.node).toBe("base/sub");
  state = modifyBrowserTabs(state, 0, id, "limit");
  state = updateBrowserTab(state, 0, (tab) =>
    navigateBrowserPane(tab, "r", ""),
  );
  expect(browserLocation(state.groups[0].tabs[0])?.node).toBe("");
});
it("automatic home is optional and only applies on activation, not repeated clicks on a tab", () => {
  let state = setup();
  const id = state.groups[0].tabs[0].tabId;
  state = updateBrowserTab(state, 0, (tab) =>
    navigateBrowserPane(tab, "r", "base/sub"),
  );
  state = addBrowserTab(state, 0);
  state = selectBrowserTab(state, 0, 0);
  expect(browserLocation(state.groups[0].tabs[0])?.node).toBe("base/sub");
  state = modifyBrowserTabs(state, 0, id, "auto-home");
  state = selectBrowserTab(state, 0, 0);
  expect(browserLocation(state.groups[0].tabs[0])?.node).toBe("base/sub");
  state = selectBrowserTab(state, 0, 1);
  state = selectBrowserTab(state, 0, 0);
  expect(browserLocation(state.groups[0].tabs[0])?.node).toBe("base");
});
it("move migrates base; delete/revocation marks it missing without assigning a different grant", () => {
  let state = setup();
  state = reconcileBrowserTabs(state, {
    kind: "move",
    rootId: "r",
    node: "base",
    targetRootId: "other",
    targetNode: "renamed",
  });
  expect(browserTabAnchor(state.groups[0].tabs[0])).toMatchObject({
    rootId: "other",
    node: "renamed",
    label: "base",
  });
  state = revokeBrowserRoot(state, "other", "parent");
  expect(browserTabAnchor(state.groups[0].tabs[0])?.missing).toBe(true);
  expect(browserLocation(state.groups[0].tabs[0])?.rootId).toBe("parent");
  expect(
    modifyBrowserTabs(state, 0, state.groups[0].tabs[0].tabId, "home"),
  ).toBe(state);
  expect(
    browserTabAnchor(
      reconcileBrowserTabs(setup(), {
        kind: "trash",
        rootId: "r",
        node: "base",
      }).groups[0].tabs[0],
    )?.missing,
  ).toBe(true);
});
it("legacy pins migrate, malformed bases are rejected and unpin discards the base", () => {
  let state = setup();
  delete state.groups[0].tabs[0].anchor;
  state = parseBrowserWorkspace(JSON.stringify(state));
  expect(browserTabAnchor(state.groups[0].tabs[0])?.node).toBe("base");
  state.groups[0].tabs[0].anchor!.node = "../escape";
  state = parseBrowserWorkspace(JSON.stringify(state));
  expect(browserTabAnchor(state.groups[0].tabs[0])?.node).toBe("base");
  state = modifyBrowserTabs(state, 0, state.groups[0].tabs[0].tabId, "pin");
  expect(browserTabAnchor(state.groups[0].tabs[0])).toBeUndefined();
});

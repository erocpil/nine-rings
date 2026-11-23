import { expect, it } from "vitest";
import {
  readNamedBrowserWorkspaces,
  restoreNamedBrowserWorkspace,
  saveNamedBrowserWorkspaces,
} from "../../src/lib/local-files/browser-named-workspaces";
import { parseBrowserWorkspace } from "../../src/lib/local-files/browser-tabs";

it("restores directory layout without restoring a revoked grant", () => {
  const tab = (rootId: string) => ({
    tabId: rootId,
    history: [{ rootId, node: "project", selected: ["project/a.md"] }],
    index: 0,
    pinned: true,
  });
  const layout = parseBrowserWorkspace(
    JSON.stringify({
      version: 2,
      ratio: 0.6,
      groups: [
        { tabs: [tab("old")], active: 0 },
        { tabs: [tab("allowed")], active: 0 },
      ],
    }),
  );
  let saved = "";
  const store = {
    getItem: () => saved,
    setItem: (_key: string, value: string) => {
      saved = value;
    },
  };
  saveNamedBrowserWorkspaces(store, [{ id: "p", name: "Project", layout }]);
  const [entry] = readNamedBrowserWorkspaces(store);
  const restored = restoreNamedBrowserWorkspace(entry.layout, ["allowed"]);
  expect(restored.ratio).toBe(0.6);
  expect(restored.groups[0].tabs[0].history[0]).toMatchObject({
    rootId: "allowed",
    node: "",
    selected: [],
  });
  expect(restored.groups[0].tabs[0].anchor?.missing).toBe(true);
  expect(restored.groups[1]).toEqual(entry.layout.groups[1]);
  expect(saved).toContain('"rootId":"old"');
});

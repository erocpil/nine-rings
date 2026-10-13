import { type PanelDisplayContribution } from "./panel-display";

import { createBuiltinPanelDisplay } from "./builtin-panel-display";
export const TREE_DISPLAY_PLUGIN_ID = "nine-rings.builtin-tree-display";
export const TREE_DISPLAY_SETTINGS_KEY = "nr:pluginTreeDisplay";
export const DEFAULT_TREE_DISPLAY: PanelDisplayContribution = Object.freeze({
  target: "document-tree",
  font: "inherit",
  fontSize: 14,
  rowHeight: 30,
  labelColor: "inherit",
  tooltip: "path",
  showCounts: true,
  showMetadata: true,
  toolbar: Object.freeze(["tree.expand-all", "tree.refresh"] as const),
});
export const treeDisplay = createBuiltinPanelDisplay(
  TREE_DISPLAY_PLUGIN_ID,
  TREE_DISPLAY_SETTINGS_KEY,
  DEFAULT_TREE_DISPLAY,
  "nr:plugin-tree-display-change",
);
export type { PanelDisplayPreference as TreeDisplayPreference } from "./builtin-panel-display";
export const readTreeDisplayPreference = treeDisplay.read;
export const treeDisplayPreferenceSnapshot = treeDisplay.snapshot;
export const subscribeTreeDisplayPreference = treeDisplay.subscribe;
export const saveTreeDisplayPreference = treeDisplay.save;
export const startBuiltinTreeDisplay = treeDisplay.start;

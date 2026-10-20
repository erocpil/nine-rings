import { createBuiltinPanelDisplay } from "./builtin-panel-display";
import type { PanelDisplayContribution } from "./panel-display";

export const SOURCE_MATCH_DISPLAY_PLUGIN_ID = "nine-rings.builtin-source-match-display";
export const SOURCE_MATCH_DISPLAY_SETTINGS_KEY = "nr:pluginSourceMatchDisplay";
export const DEFAULT_SOURCE_MATCH_DISPLAY: PanelDisplayContribution = Object.freeze({
  target: "source-matches",
  font: "inherit",
  fontSize: 13,
  rowHeight: 32,
  labelColor: "inherit",
  tooltip: "name",
  showCounts: true,
  showMetadata: true,
  toolbar: Object.freeze([] as const),
});
export const sourceMatchDisplay = createBuiltinPanelDisplay(
  SOURCE_MATCH_DISPLAY_PLUGIN_ID,
  SOURCE_MATCH_DISPLAY_SETTINGS_KEY,
  DEFAULT_SOURCE_MATCH_DISPLAY,
);

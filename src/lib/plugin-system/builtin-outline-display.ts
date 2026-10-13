import { createBuiltinPanelDisplay } from "./builtin-panel-display";
import type { PanelDisplayContribution } from "./panel-display";
export const OUTLINE_DISPLAY_PLUGIN_ID = "nine-rings.builtin-outline-display";
export const OUTLINE_DISPLAY_SETTINGS_KEY = "nr:pluginOutlineDisplay";
export const DEFAULT_OUTLINE_DISPLAY: PanelDisplayContribution = Object.freeze({
  target: "document-outline",
  font: "inherit",
  fontSize: 13,
  rowHeight: 28,
  labelColor: "inherit",
  tooltip: "name",
  showCounts: true,
  showMetadata: true,
  toolbar: Object.freeze(["outline.reveal-current"] as const),
});
export const outlineDisplay = createBuiltinPanelDisplay(
  OUTLINE_DISPLAY_PLUGIN_ID,
  OUTLINE_DISPLAY_SETTINGS_KEY,
  DEFAULT_OUTLINE_DISPLAY,
);

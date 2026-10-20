import { createBuiltinPanelDisplay } from "./builtin-panel-display";
import type { PanelDisplayContribution } from "./panel-display";

export const SOURCE_SYMBOL_DISPLAY_PLUGIN_ID = "nine-rings.builtin-source-symbol-display";
export const SOURCE_SYMBOL_DISPLAY_SETTINGS_KEY = "nr:pluginSourceSymbolDisplay";
export const DEFAULT_SOURCE_SYMBOL_DISPLAY: PanelDisplayContribution = Object.freeze({
  target: "source-symbols",
  font: "inherit",
  fontSize: 13,
  rowHeight: 28,
  labelColor: "inherit",
  tooltip: "name",
  showCounts: false,
  showMetadata: true,
  toolbar: Object.freeze(["source-symbols.reveal-current"] as const),
});
export const sourceSymbolDisplay = createBuiltinPanelDisplay(
  SOURCE_SYMBOL_DISPLAY_PLUGIN_ID,
  SOURCE_SYMBOL_DISPLAY_SETTINGS_KEY,
  DEFAULT_SOURCE_SYMBOL_DISPLAY,
);

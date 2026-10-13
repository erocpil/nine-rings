import { createBuiltinPanelDisplay } from "./builtin-panel-display";
import type { PanelDisplayContribution } from "./panel-display";
export const BOOKMARK_DISPLAY_PLUGIN_ID = "nine-rings.builtin-bookmark-display";
export const BOOKMARK_DISPLAY_SETTINGS_KEY = "nr:pluginBookmarkDisplay";
export const DEFAULT_BOOKMARK_DISPLAY: PanelDisplayContribution = Object.freeze(
  {
    target: "bookmarks",
    order: "host",
    font: "inherit",
    fontSize: 13,
    rowHeight: 32,
    labelColor: "inherit",
    tooltip: "path",
    showCounts: true,
    showMetadata: true,
    toolbar: Object.freeze(["bookmarks.reveal-current"] as const),
  },
);
export const bookmarkDisplay = createBuiltinPanelDisplay(
  BOOKMARK_DISPLAY_PLUGIN_ID,
  BOOKMARK_DISPLAY_SETTINGS_KEY,
  DEFAULT_BOOKMARK_DISPLAY,
);

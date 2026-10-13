import { createBuiltinPanelDisplay } from "./builtin-panel-display";
import type { PanelDisplayContribution } from "./panel-display";
export const NOTES_DISPLAY_PLUGIN_ID = "nine-rings.builtin-notes-display";
export const NOTES_DISPLAY_SETTINGS_KEY = "nr:pluginNotesDisplay";
export const DEFAULT_NOTES_DISPLAY: PanelDisplayContribution = Object.freeze({
  target: "notes",
  order: "host",
  font: "inherit",
  fontSize: 13,
  rowHeight: 32,
  labelColor: "inherit",
  tooltip: "path",
  showCounts: true,
  showMetadata: true,
  toolbar: Object.freeze(["notes.expand-all", "notes.refresh"] as const),
});
export const notesDisplay = createBuiltinPanelDisplay(
  NOTES_DISPLAY_PLUGIN_ID,
  NOTES_DISPLAY_SETTINGS_KEY,
  DEFAULT_NOTES_DISPLAY,
);

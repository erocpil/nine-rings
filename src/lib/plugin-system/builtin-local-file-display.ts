import { createBuiltinPanelDisplay } from "./builtin-panel-display";
import type { PanelDisplayContribution } from "./panel-display";

export const LOCAL_FILE_DISPLAY_SETTINGS_KEY = "nr:pluginLocalFileDisplay";
export const DEFAULT_LOCAL_FILE_DISPLAY: PanelDisplayContribution = Object.freeze({
  target: "local-files",
  font: "inherit",
  fontSize: 14,
  rowHeight: 30,
  labelColor: "inherit",
  tooltip: "path",
  showCounts: true,
  showMetadata: true,
  toolbar: Object.freeze([
    "local-files.collapse-all",
    "local-files.refresh",
  ] as const),
});

const controller = createBuiltinPanelDisplay(
  "nine-rings.builtin-local-file-display",
  LOCAL_FILE_DISPLAY_SETTINGS_KEY,
  DEFAULT_LOCAL_FILE_DISPLAY,
  "nr:plugin-local-file-display-change",
);

// The local-files plugin owns activation. This controller stores only its
// presentation preference, so it is always enabled while that plugin runs.
export const localFileDisplay = {
  ...controller,
  read: () => ({ ...controller.read(), enabled: true }),
  save: (value: ReturnType<typeof controller.read>) =>
    controller.save({ ...value, enabled: true }),
};

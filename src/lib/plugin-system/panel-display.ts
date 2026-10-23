import {
  PluginHostError,
  pluginRuntime,
  type PluginActivation,
  type PluginRuntime,
} from "./runtime";

/** Presentation only. Host controllers retain data, focus, navigation and selection. */
export type PanelDisplayTarget =
  "document-tree" | "local-files" | "document-outline" | "source-symbols" | "source-matches" | "bookmarks" | "notes";
export type PanelDisplayCommand =
  | "tree.expand-all"
  | "tree.refresh"
  | "local-files.collapse-all"
  | "local-files.refresh"
  | "outline.reveal-current"
  | "source-symbols.reveal-current"
  | "bookmarks.reveal-current"
  | "notes.expand-all"
  | "notes.refresh";
const COMMANDS: Record<PanelDisplayTarget, readonly PanelDisplayCommand[]> = {
  "document-tree": ["tree.expand-all", "tree.refresh"],
  "local-files": ["local-files.collapse-all", "local-files.refresh"],
  "document-outline": ["outline.reveal-current"],
  "source-symbols": ["source-symbols.reveal-current"],
  "source-matches": [],
  bookmarks: ["bookmarks.reveal-current"],
  notes: ["notes.expand-all", "notes.refresh"],
};
export interface PanelDisplayContribution {
  readonly target: PanelDisplayTarget;
  readonly order?: "host" | "name" | "recent";
  readonly font: "inherit" | "sans" | "mono";
  readonly fontSize: number;
  readonly rowHeight: number;
  readonly labelColor: "inherit" | "secondary" | "accent";
  readonly tooltip: "name" | "path" | "info";
  readonly showCounts: boolean;
  readonly showMetadata: boolean;
  readonly toolbar: readonly PanelDisplayCommand[];
}
const TARGETS = new Set<PanelDisplayTarget>([
  "document-tree",
  "local-files",
  "document-outline",
  "source-symbols",
  "source-matches",
  "bookmarks",
  "notes",
]);
const KEYS = new Set([
  "target",
  "order",
  "font",
  "fontSize",
  "rowHeight",
  "labelColor",
  "tooltip",
  "showCounts",
  "showMetadata",
  "toolbar",
]);
export function validatePanelDisplay(
  value: PanelDisplayContribution,
): PanelDisplayContribution {
  if (
    !value ||
    Object.keys(value).some((key) => !KEYS.has(key)) ||
    !TARGETS.has(value.target) ||
    (value.order !== undefined &&
      (!["bookmarks", "notes"].includes(value.target) ||
        !["host", "name", "recent"].includes(value.order))) ||
    !["inherit", "sans", "mono"].includes(value.font) ||
    !Number.isInteger(value.fontSize) ||
    value.fontSize < 12 ||
    value.fontSize > 20 ||
    !Number.isInteger(value.rowHeight) ||
    value.rowHeight < 28 ||
    value.rowHeight > 48 ||
    !["inherit", "secondary", "accent"].includes(value.labelColor) ||
    !["name", "path", "info"].includes(value.tooltip) ||
    (value.tooltip === "info" && value.target !== "document-tree") ||
    typeof value.showCounts !== "boolean" ||
    typeof value.showMetadata !== "boolean" ||
    !Array.isArray(value.toolbar) ||
    value.toolbar.length > 2 ||
    new Set(value.toolbar).size !== value.toolbar.length ||
    value.toolbar.some((command) => !COMMANDS[value.target].includes(command))
  )
    throw new PluginHostError("INVALID_ARGUMENT", "分栏展示配置无效");
  return Object.freeze({
    ...value,
    toolbar: Object.freeze([...value.toolbar]),
  });
}

/** One primary presenter per slot; registration is owned by an issued activation. */
export class PanelDisplayRegistry {
  private entries = new Map<
    PanelDisplayTarget,
    { activation: PluginActivation; value: PanelDisplayContribution }
  >();
  private listeners = new Set<() => void>();
  constructor(private runtime: PluginRuntime) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private changed() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Observers cannot block revocation. */
      }
    }
  }
  get(target: PanelDisplayTarget) {
    return this.entries.get(target)?.value ?? null;
  }
  run(
    target: PanelDisplayTarget,
    value: PanelDisplayContribution,
    command: PanelDisplayContribution["toolbar"][number],
    handlers: Partial<
      Record<PanelDisplayContribution["toolbar"][number], () => void>
    >,
  ) {
    const entry = this.entries.get(target);
    if (!entry || entry.value !== value || !value.toolbar.includes(command))
      return false;
    this.runtime.assert(entry.activation);
    const handler = handlers[command];
    if (!handler) return false;
    handler();
    return true;
  }
  register(
    activation: PluginActivation,
    contribution: PanelDisplayContribution,
  ) {
    this.runtime.assert(activation);
    const value = validatePanelDisplay(contribution);
    if (this.entries.has(value.target))
      throw new PluginHostError("INVALID_ARGUMENT", "此分栏已有展示插件");
    const entry = { activation, value };
    this.entries.set(value.target, entry);
    const dispose = this.runtime.own(activation, () => {
      if (this.entries.get(value.target) === entry) {
        this.entries.delete(value.target);
        this.changed();
      }
    });
    this.changed();
    return dispose;
  }
}
export const panelDisplays = new PanelDisplayRegistry(pluginRuntime);

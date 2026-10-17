import {
  PluginHostError,
  pluginRuntime,
  type PluginActivation,
} from "./runtime";
import { numberingColor, type NumberingColor } from "./numbering-display";
export const STATUS_ITEMS = [
  "navigation",
  "save",
  "block",
  "position",
  "characters",
  "words",
  "diagnostics",
  "history",
] as const;
export type StatusItem = (typeof STATUS_ITEMS)[number];
export interface StatusDisplay {
  readonly visible: boolean;
  readonly showInFocus: boolean;
  readonly font: "inherit" | "mono" | "sans" | "serif";
  readonly fontSize: number;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly color: NumberingColor;
  readonly background: NumberingColor;
  readonly paddingY: number;
  readonly gap: number;
  readonly items: readonly StatusItem[];
}
export const DEFAULT_STATUS_DISPLAY: StatusDisplay = Object.freeze({
  visible: true,
  showInFocus: true,
  font: "inherit",
  fontSize: 11,
  bold: false,
  italic: false,
  color: "secondary",
  background: "transparent",
  paddingY: 4,
  gap: 10,
  items: Object.freeze([...STATUS_ITEMS]),
});
export function validateStatusDisplay(input: unknown): StatusDisplay {
  const invalid = (): never => {
    throw new PluginHostError("INVALID_ARGUMENT", "状态栏展示配置无效");
  };
  if (!input || typeof input !== "object" || Array.isArray(input))
    return invalid();
  const v = input as Record<string, unknown>;
  if (
    Object.keys(v).length !== Object.keys(DEFAULT_STATUS_DISPLAY).length ||
    Object.keys(v).some((k) => !(k in DEFAULT_STATUS_DISPLAY))
  )
    return invalid();
  if (
    !["visible", "showInFocus", "bold", "italic"].every(
      (k) => typeof v[k] === "boolean",
    ) ||
    !["inherit", "mono", "sans", "serif"].includes(String(v.font))
  )
    return invalid();
  for (const [key, min, max] of [
    ["fontSize", 9, 20],
    ["paddingY", 0, 12],
    ["gap", 2, 24],
  ] as const)
    if (
      typeof v[key] !== "number" ||
      !Number.isFinite(v[key]) ||
      v[key] < min ||
      v[key] > max
    )
      return invalid();
  if (
    !Array.isArray(v.items) ||
    v.items.length > STATUS_ITEMS.length ||
    new Set(v.items).size !== v.items.length ||
    v.items.some((k) => !STATUS_ITEMS.includes(k))
  )
    return invalid();
  const color = (value: unknown): NumberingColor => {
    if (
      typeof value === "string" &&
      [
        "text",
        "secondary",
        "accent",
        "transparent",
        "surface",
        "active",
      ].includes(value)
    )
      return value as NumberingColor;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join() === "dark,light"
    ) {
      const p = value as { light: string; dark: string };
      if (
        [p.light, p.dark].every(
          (c) => typeof c === "string" && /^#[a-f0-9]{6}$/i.test(c),
        )
      )
        return Object.freeze({ ...p });
    }
    return invalid();
  };
  return Object.freeze({
    ...v,
    color: color(v.color),
    background: color(v.background),
    items: Object.freeze([...v.items]),
  }) as unknown as StatusDisplay;
}
class StatusDisplayRegistry {
  private value: StatusDisplay | null = null;
  private owner: PluginActivation | null = null;
  private listeners = new Set<() => void>();
  getSnapshot = () => this.value;
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
        /* Continue revocation. */
      }
    }
  }
  register(owner: PluginActivation, input: StatusDisplay) {
    pluginRuntime.assert(owner);
    const value = validateStatusDisplay(input);
    if (this.owner)
      throw new PluginHostError(
        "INVALID_ARGUMENT",
        "状态栏已由其它插件接管，请先停用原插件",
      );
    this.owner = owner;
    this.value = value;
    const dispose = pluginRuntime.own(owner, () => {
      if (this.owner !== owner) return;
      this.value = null;
      this.owner = null;
      this.changed();
    });
    this.changed();
    return dispose;
  }
}
export const statusDisplays = new StatusDisplayRegistry();
export function statusDisplayStyle(
  display: StatusDisplay,
): Record<string, string> {
  const colors = Object.fromEntries(
    (["color", "background"] as const).flatMap((k) =>
      [false, true].map((dark) => [
        `--statusbar-${k}-${dark ? "dark" : "light"}`,
        numberingColor(display[k], dark),
      ]),
    ),
  );
  return {
    ...colors,
    "--statusbar-font": {
      inherit: "inherit",
      mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      sans: "system-ui, sans-serif",
      serif: 'Georgia, "Noto Serif SC", serif',
    }[display.font],
    "--statusbar-size": `${display.fontSize}px`,
    "--statusbar-weight": display.bold ? "700" : "400",
    "--statusbar-style": display.italic ? "italic" : "normal",
    "--statusbar-padding": `${display.paddingY}px`,
    "--statusbar-gap": `${display.gap}px`,
  };
}

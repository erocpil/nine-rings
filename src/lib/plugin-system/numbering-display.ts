import {
  pluginRuntime,
  PluginHostError,
  type PluginActivation,
} from "./runtime";
export type NumberingTarget = "blocks" | "source";
export type NumberingColor =
  | "text"
  | "secondary"
  | "accent"
  | "transparent"
  | "surface"
  | "active"
  | Readonly<{ light: string; dark: string }>;
export interface NumberingDisplay {
  readonly target: NumberingTarget;
  readonly visible: boolean;
  readonly relative: boolean;
  readonly currentAlignment: "left" | "right";
  readonly font: "inherit" | "mono" | "sans" | "serif";
  readonly fontSize: number;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly color: NumberingColor;
  readonly background: NumberingColor;
  readonly highlightCurrent: boolean;
  readonly currentBold: boolean;
  readonly currentColor: NumberingColor;
  readonly currentBackground: NumberingColor;
  readonly foldExpanded: string;
  readonly foldCollapsed: string;
  readonly sourceDividerWidth: number;
  readonly sourceDividerLeftSpace: number;
  readonly sourceDividerRightSpace: number;
}
const invalid = (): never => {
  throw new PluginHostError(
    "INVALID_ARGUMENT",
    "编号展示资源无效：请检查目标、字号、颜色和折叠符号",
  );
};
export function validateNumberingDisplay(input: unknown): NumberingDisplay {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return invalid();
  const value = input as Record<string, unknown>;
  const keys = [
    "target",
    "visible",
    "relative",
    "currentAlignment",
    "font",
    "fontSize",
    "bold",
    "italic",
    "color",
    "background",
    "highlightCurrent",
    "currentBold",
    "currentColor",
    "currentBackground",
    "foldExpanded",
    "foldCollapsed",
  ];
  const optionalKeys = ["sourceDividerWidth", "sourceDividerLeftSpace", "sourceDividerRightSpace"];
  const result = { ...value };
  if (
    keys.some(key => !(key in value)) ||
    Object.keys(value).some((key) => !keys.includes(key) && !optionalKeys.includes(key)) ||
    !["blocks", "source"].includes(String(value.target)) ||
    !["left", "right"].includes(String(value.currentAlignment)) ||
    !["inherit", "mono", "sans", "serif"].includes(String(value.font)) ||
    typeof value.fontSize !== "number" ||
    !Number.isFinite(value.fontSize) ||
    value.fontSize < 9 ||
    value.fontSize > 24
  )
    return invalid();
  for (const [key, fallback, maximum] of [
    ["sourceDividerWidth", 1, 4],
    ["sourceDividerLeftSpace", 5, 24],
    ["sourceDividerRightSpace", 6, 24],
  ] as const) {
    const number = value[key] ?? fallback;
    if (typeof number !== "number" || !Number.isInteger(number) || number < 0 || number > maximum)
      return invalid();
    result[key] = number;
  }
  for (const key of [
    "visible",
    "relative",
    "bold",
    "italic",
    "highlightCurrent",
    "currentBold",
  ])
    if (typeof value[key] !== "boolean") return invalid();
  for (const key of ["foldExpanded", "foldCollapsed"]) {
    const symbol = value[key];
    if (
      typeof symbol !== "string" ||
      !symbol.trim() ||
      Array.from(symbol).length > 4 ||
      Array.from(symbol).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    )
      return invalid();
  }
  for (const key of [
    "color",
    "background",
    "currentColor",
    "currentBackground",
  ]) {
    const color = value[key];
    if (typeof color === "string") {
      if (
        ![
          "text",
          "secondary",
          "accent",
          "transparent",
          "surface",
          "active",
        ].includes(color)
      )
        return invalid();
    } else {
      if (
        !color ||
        typeof color !== "object" ||
        Array.isArray(color) ||
        Object.keys(color).sort().join() !== "dark,light"
      )
        return invalid();
      const pair = color as { light: unknown; dark: unknown };
      if (
        ![pair.light, pair.dark].every(
          (item) => typeof item === "string" && /^#[a-f0-9]{6}$/i.test(item),
        )
      )
        return invalid();
      result[key] = Object.freeze({ ...pair });
    }
  }
  return Object.freeze(result) as unknown as NumberingDisplay;
}
const fonts = {
  inherit: "inherit",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  sans: "system-ui, sans-serif",
  serif: 'Georgia, "Noto Serif SC", serif',
};
export function numberingColor(value: NumberingColor, dark: boolean) {
  if (typeof value === "object") return dark ? value.dark : value.light;
  return {
    text: "var(--text)",
    secondary: "var(--text-secondary)",
    accent: "var(--accent)",
    transparent: "transparent",
    surface: "var(--surface)",
    active: "var(--active-bg)",
  }[value];
}
export function numberingVariables(
  value: NumberingDisplay,
  dark: boolean,
): Record<string, string> {
  const prefix = `--numbering-${value.target}-`;
  return Object.fromEntries(
    Object.entries({
      font: fonts[value.font],
      size: `${value.fontSize}px`,
      weight: value.bold ? "700" : "400",
      style: value.italic ? "italic" : "normal",
      color: numberingColor(value.color, dark),
      background: numberingColor(value.background, dark),
      currentWeight: value.currentBold ? "700" : value.bold ? "700" : "400",
      currentColor: numberingColor(
        value.highlightCurrent ? value.currentColor : value.color,
        dark,
      ),
      currentBackground: numberingColor(
        value.highlightCurrent ? value.currentBackground : value.background,
        dark,
      ),
      dividerWidth: `${value.sourceDividerWidth}px`,
      dividerLeftSpace: `${value.sourceDividerLeftSpace}px`,
      dividerRightSpace: `${value.sourceDividerRightSpace}px`,
    }).map(([key, item]) => [prefix + key, item]),
  );
}
class NumberingDisplayRegistry {
  private values = new Map<
    NumberingTarget,
    { owner: PluginActivation; value: NumberingDisplay }
  >();
  private snapshot: Readonly<
    Partial<Record<NumberingTarget, NumberingDisplay>>
  > = Object.freeze({});
  private listeners = new Set<() => void>();
  getSnapshot = () => this.snapshot;
  getOwner(target: NumberingTarget) {
    return this.values.get(target)?.owner.pluginId ?? null;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private changed() {
    this.snapshot = Object.freeze(
      Object.fromEntries(
        [...this.values].map(([target, entry]) => [target, entry.value]),
      ),
    );
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Continue revocation. */
      }
    }
  }
  register(owner: PluginActivation, input: readonly NumberingDisplay[]) {
    pluginRuntime.assert(owner);
    const values = input.map(validateNumberingDisplay);
    if (
      !values.length ||
      values.length > 2 ||
      new Set(values.map((value) => value.target)).size !== values.length ||
      values.some((value) => this.values.has(value.target))
    )
      throw new PluginHostError(
        "INVALID_ARGUMENT",
        "编号展示目标已由其它插件接管，请先停用原插件",
      );
    const entries = values.map((value) => ({ owner, value }));
    for (const entry of entries) this.values.set(entry.value.target, entry);
    const dispose = pluginRuntime.own(owner, () => {
      for (const entry of entries)
        if (this.values.get(entry.value.target) === entry)
          this.values.delete(entry.value.target);
      this.changed();
    });
    this.changed();
    return dispose;
  }
}
export const numberingDisplays = new NumberingDisplayRegistry();
/** CSS owns paint; the host still owns numbering, hit targets and fold behavior. */
export function startNumberingAppearance() {
  const root = document.documentElement;
  let applied: string[] = [];
  const apply = () => {
    for (const key of applied) root.style.removeProperty(key);
    applied = [];
    const dark = [
      "theme-dark",
      "theme-azure-dark",
      "theme-nord",
      "theme-dracula",
    ].some((name) => root.classList.contains(name));
    const snapshot = numberingDisplays.getSnapshot();
    for (const target of ["blocks", "source"] as const) {
      root.toggleAttribute(
        `data-numbering-${target}`,
        Boolean(snapshot[target]),
      );
      const value = snapshot[target];
      if (!value) continue;
      for (const [key, text] of Object.entries(
        numberingVariables(value, dark),
      )) {
        root.style.setProperty(key, text);
        applied.push(key);
      }
    }
  };
  const observer = new MutationObserver(apply);
  observer.observe(root, { attributes: true, attributeFilter: ["class"] });
  const stop = numberingDisplays.subscribe(apply);
  apply();
  return () => {
    stop();
    observer.disconnect();
    for (const key of applied) root.style.removeProperty(key);
    root.removeAttribute("data-numbering-blocks");
    root.removeAttribute("data-numbering-source");
  };
}

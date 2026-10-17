import {
  PluginHostError,
  pluginRuntime,
  type PluginActivation,
  type PluginRuntime,
} from "./runtime";

/** Versioned, declarative resources. No CSS, URLs, fonts loaded from disk or code. */
export const THEME_COLOR_KEYS = [
  "bg",
  "surface",
  "border",
  "text",
  "muted",
  "accent",
  "accentHover",
  "hover",
  "active",
  "code",
  "syntaxKeyword",
  "syntaxString",
  "syntaxValue",
  "syntaxMeta",
  "syntaxType",
] as const;
export type ThemeColors = Readonly<
  Record<(typeof THEME_COLOR_KEYS)[number], string>
>;
export type ThemeFont = "system" | "sans" | "serif" | "monospace";
export interface ThemeTypography {
  readonly headingScale: readonly number[];
  readonly compactHeadingScale: readonly number[];
  readonly codeFont: "monospace";
  readonly quoteFont: ThemeFont;
  readonly flowFont: ThemeFont;
}
export interface ThemeResource {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly light: ThemeColors;
  readonly dark: ThemeColors;
  readonly typography?: ThemeTypography;
}
const invalid = () => {
  throw new PluginHostError(
    "INVALID_ARGUMENT",
    "主题资源无效：请检查浅深配色、文字对比度及排版令牌",
  );
};
function object(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Reflect.ownKeys(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key === "string" &&
        descriptor?.enumerable === true &&
        "value" in descriptor
      );
    })
  );
}
function exact(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid();
}
export function themeLuminance(color: string) {
  const channels = color
    .slice(1)
    .match(/../g)!
    .map((hex) => {
      const v = parseInt(hex, 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [themeLuminance(a), themeLuminance(b)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
function palette(value: unknown, dark: boolean): ThemeColors {
  if (!object(value)) return invalid();
  exact(value, THEME_COLOR_KEYS);
  for (const key of THEME_COLOR_KEYS)
    if (typeof value[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(value[key]))
      invalid();
  const colors = Object.fromEntries(
    THEME_COLOR_KEYS.map((key) => [key, (value[key] as string).toLowerCase()]),
  ) as unknown as ThemeColors;
  if (dark ? themeLuminance(colors.bg) > 0.15 : themeLuminance(colors.bg) < 0.5)
    invalid();
  for (const background of [colors.bg, colors.surface, colors.code]) {
    if (
      contrast(colors.text, background) < 4.5 ||
      contrast(colors.muted, background) < 4.5
    )
      invalid();
  }
  if (
    contrast(colors.accent, colors.bg) < 4.5 ||
    contrast(colors.accentHover, colors.bg) < 4.5
  )
    invalid();
  return Object.freeze(colors);
}
function scales(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length !== 6) return invalid();
  const items = [...value];
  if (
    items.some(
      (item, index) =>
        typeof item !== "number" ||
        !Number.isFinite(item) ||
        item < 1 ||
        item > 3 ||
        (index > 0 && item >= items[index - 1]),
    )
  )
    return invalid();
  return Object.freeze(items);
}
export function validateThemeResource(value: unknown): ThemeResource {
  if (!object(value)) return invalid();
  exact(value, ["version", "id", "name", "light", "dark", "typography"]);
  if (
    value.version !== 1 ||
    typeof value.id !== "string" ||
    !/^[a-z][a-z0-9.-]{0,95}\/[a-z][a-z0-9-]{0,47}$/.test(value.id) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 64 ||
    Array.from(value.name).some((character) => character.charCodeAt(0) < 32)
  )
    return invalid();
  let typography: ThemeTypography | undefined;
  if (value.typography !== undefined) {
    const t = value.typography;
    if (!object(t)) return invalid();
    exact(t, [
      "headingScale",
      "compactHeadingScale",
      "codeFont",
      "quoteFont",
      "flowFont",
    ]);
    if (
      t.codeFont !== "monospace" ||
      !["system", "sans", "serif", "monospace"].includes(String(t.quoteFont)) ||
      !["system", "sans", "serif", "monospace"].includes(String(t.flowFont))
    )
      return invalid();
    typography = Object.freeze({
      headingScale: scales(t.headingScale),
      compactHeadingScale: scales(t.compactHeadingScale),
      codeFont: "monospace",
      quoteFont: t.quoteFont as ThemeFont,
      flowFont: t.flowFont as ThemeFont,
    });
  }
  return Object.freeze({
    version: 1,
    id: value.id,
    name: value.name.trim(),
    light: palette(value.light, false),
    dark: palette(value.dark, true),
    ...(typography ? { typography } : {}),
  });
}

/** Multiple namespaced resources, with atomic validation and activation-owned revocation. */
export class ThemeResourceRegistry {
  private entries = new Map<
    string,
    { activation: PluginActivation; value: ThemeResource }
  >();
  private listeners = new Set<() => void>();
  private snapshot: readonly ThemeResource[] = Object.freeze([]);
  constructor(private runtime: PluginRuntime) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get(id: string) {
    return this.entries.get(id)?.value ?? null;
  }
  private changed() {
    this.snapshot = Object.freeze(
      [...this.entries.values()].map((entry) => entry.value),
    );
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Observers cannot block revocation. */
      }
    }
  }
  register(activation: PluginActivation, resources: readonly ThemeResource[]) {
    this.runtime.assert(activation);
    if (
      !Array.isArray(resources) ||
      !resources.length ||
      resources.length > 8 ||
      this.entries.size + resources.length > 32
    )
      return invalid();
    const values = resources.map(validateThemeResource);
    if (
      new Set(values.map((value) => value.id)).size !== values.length ||
      values.some(
        (value) =>
          !value.id.startsWith(activation.pluginId + "/") ||
          this.entries.has(value.id),
      )
    )
      return invalid();
    this.runtime.assert(activation);
    const entries = values.map((value) => ({ activation, value }));
    for (const entry of entries) this.entries.set(entry.value.id, entry);
    const dispose = this.runtime.own(activation, () => {
      for (const entry of entries)
        if (this.entries.get(entry.value.id) === entry)
          this.entries.delete(entry.value.id);
      this.changed();
    });
    this.changed();
    return dispose;
  }
}
export const themeResources = new ThemeResourceRegistry(pluginRuntime);

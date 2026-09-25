import type { AppConfig } from "./storage/types";
import {
  DEFAULT_EDITOR_APPEARANCE,
  NAVIGATION_APPEARANCE_KEYS,
} from "./editor-appearance";
import { applyTheme } from "./theme";
export type InterfaceStyle = "classic" | "calm" | "calm-compact";
export const INTERFACE_STYLES: ReadonlyArray<{
  value: InterfaceStyle;
  label: string;
  description: string;
}> = [
  {
    value: "classic",
    label: "经典",
    description: "保留原有布局密度与控件外观",
  },
  {
    value: "calm",
    label: "清雅",
    description: "舒适留白、轻边框，让正文更突出",
  },
  {
    value: "calm-compact",
    label: "清雅·紧凑",
    description: "清雅的视觉层级，更紧凑的空间",
  },
];
export function normalizeInterfaceStyle(value: unknown): InterfaceStyle {
  return value === "calm" || value === "calm-compact" ? value : "classic";
}
/** Root style marker; classic preferences are never rewritten. */
export function applyInterfaceStyle(value: unknown): void {
  document.documentElement.dataset.interfaceStyle =
    normalizeInterfaceStyle(value);
}

export type InterfaceColorMode = "light" | "dark" | "system";
export function normalizeInterfaceColorMode(
  value: unknown,
): InterfaceColorMode {
  return value === "light" || value === "dark" ? value : "system";
}
export function applyInterfaceAppearance(
  config: Pick<AppConfig, "interface_style" | "interface_color_mode" | "theme">,
): void {
  applyInterfaceStyle(config.interface_style);
  applyTheme(
    normalizeInterfaceStyle(config.interface_style) === "classic"
      ? config.theme
      : normalizeInterfaceColorMode(config.interface_color_mode),
  );
}
/** Display-only projection. Never persist this object over the classic preferences. */
export function resolveInterfaceConfig<T extends Partial<AppConfig>>(
  config: T,
): T {
  if (normalizeInterfaceStyle(config.interface_style) === "classic")
    return config;
  const compact = config.interface_style === "calm-compact";
  const navigation = Object.fromEntries(
    NAVIGATION_APPEARANCE_KEYS.map((key) => [
      key,
      key.endsWith("font_size")
        ? 13
        : key.endsWith("text_color")
          ? "#333333"
          : "#f5f1e8",
    ]),
  );
  return {
    ...config,
    ...DEFAULT_EDITOR_APPEARANCE,
    ...navigation,
    note_font_size: compact ? 14 : 15,
    editor_line_height: 1.9,
    editor_block_spacing: 16 / (compact ? 14 : 15),
    editor_heading_margin_top: 28 / (compact ? 14 : 15),
    editor_heading_margin_bottom: 12 / (compact ? 14 : 15),
  };
}

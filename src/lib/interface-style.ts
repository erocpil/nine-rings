import type { AppConfig } from "./storage/types";
import {
  DEFAULT_EDITOR_APPEARANCE,
  NAVIGATION_APPEARANCE_KEYS,
} from "./editor-appearance";
import { applyTheme } from "./theme";
export type InterfaceStyle =
  | "classic"
  | "calm"
  | "calm-compact"
  | "paper"
  | "minimal"
  | "mono-aware"
  | "yugen"
  | "wabi-sabi";
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
    value: "paper",
    label: "纸页",
    description: "暖色纸面、衬线正文，适合长文阅读与写作",
  },
  {
    value: "minimal",
    label: "精简",
    description: "中性配色、紧凑层级，适合多栏技术笔记",
  },
  {
    value: "mono-aware",
    label: "物哀",
    description: "樱灰与玫瑰、舒展衬线，温柔的阅读余韵",
  },
  {
    value: "yugen",
    label: "幽玄",
    description: "墨蓝与烟青、集中阅读，含蓄而清晰的层次",
  },
  {
    value: "wabi-sabi",
    label: "侘寂",
    description: "砂岩与苔色、朴素边界，自然安定的纸石感",
  },
];
export function normalizeInterfaceStyle(value: unknown): InterfaceStyle {
  return value === "calm" ||
    value === "calm-compact" ||
    value === "paper" ||
    value === "minimal" ||
    value === "mono-aware" ||
    value === "yugen" ||
    value === "wabi-sabi"
    ? value
    : "classic";
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
  const compact =
    config.interface_style === "calm-compact" ||
    config.interface_style === "minimal";
  const paper = config.interface_style === "paper";
  const literary =
    paper ||
    config.interface_style === "mono-aware" ||
    config.interface_style === "wabi-sabi";
  const size =
    paper || config.interface_style === "mono-aware" ? 16 : compact ? 14 : 15;
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
    editor_font_family: literary ? "serif" : "system",
    note_font_size: size,
    editor_line_height:
      config.interface_style === "mono-aware"
        ? 2
        : config.interface_style === "wabi-sabi"
          ? 1.8
          : paper
            ? 1.95
            : config.interface_style === "minimal"
              ? 1.7
              : 1.9,
    editor_block_spacing: 16 / size,
    editor_heading_margin_top: 28 / size,
    editor_heading_margin_bottom: 12 / size,
  };
}

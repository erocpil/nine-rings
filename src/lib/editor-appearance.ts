import type { AppConfig } from "./storage/types";

export const DEFAULT_EDITOR_APPEARANCE = {
  note_font_size: 16,
  editor_font_family: "system",
  editor_line_height: 1.6,
  editor_block_spacing: 1,
  editor_paragraph_indent: 0,
  editor_heading_margin_top: 0.7,
  editor_heading_margin_bottom: 0.35,
  editor_list_margin_top: 0.25,
  editor_list_margin_bottom: 0.25,
  editor_list_indent: 1,
  editor_list_marker_gap: 0.35,
  editor_blockquote_indent: 8,
  editor_search_highlight_color: "#ffd54f",
  navigation_font_size: 14,
  navigation_text_color: "#333333",
  navigation_background_color: "#f5f1e8",
  editor_cjk_spacing: true,
} as const;

/** Stable subset reserved for a future appearance export/import flow. */
export const NAVIGATION_APPEARANCE_KEYS = [
  "navigation_font_size",
  "navigation_text_color",
  "navigation_background_color",
  "navigation_outline_font_size", "navigation_outline_text_color", "navigation_outline_background_color",
  "navigation_bookmark_font_size", "navigation_bookmark_text_color", "navigation_bookmark_background_color",
  "navigation_tree_font_size", "navigation_tree_text_color", "navigation_tree_background_color",
  "navigation_list_font_size", "navigation_list_text_color", "navigation_list_background_color",
] as const;

export type NavigationAppearance = Pick<AppConfig, typeof NAVIGATION_APPEARANCE_KEYS[number]>;

export function pickNavigationAppearance(config: Partial<AppConfig>): Partial<NavigationAppearance> {
  return Object.fromEntries(NAVIGATION_APPEARANCE_KEYS.map((key) => [key, config[key]])) as Partial<NavigationAppearance>;
}

const FONT_STACKS: Record<AppConfig["editor_font_family"], string> = {
  system: '"Segoe UI", "Microsoft YaHei", system-ui, -apple-system, sans-serif',
  sans: '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif',
  serif: '"Noto Serif SC", "Songti SC", SimSun, serif',
  monospace: '"Cascadia Code", "SFMono-Regular", Consolas, "Microsoft YaHei", monospace',
};

function clamp(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function safeColor(value: unknown): string {
  const color = String(value ?? "");
  return /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_EDITOR_APPEARANCE.editor_search_highlight_color;
}

export function editorAppearanceVariables(config?: Partial<AppConfig>): Record<string, string> {
  const family = config?.editor_font_family;
  const resolvedFamily = family === "sans" || family === "serif" || family === "monospace"
    ? family
    : "system";
  const navigationFontSize = clamp(config?.navigation_font_size, 11, 22, 14);
  // Older configurations stored fixed light-theme navigation colours. Treat
  // those shipped defaults as “follow the theme”, while retaining every
  // explicitly chosen colour as an inline variable.
  const appearanceColor = (value: unknown, legacyDefault: string) => {
    const color = safeAppearanceColor(value, legacyDefault);
    return color.toLowerCase() === legacyDefault ? undefined : color;
  };
  const navigationText = appearanceColor(config?.navigation_text_color, "#333333");
  const navigationBackground = appearanceColor(config?.navigation_background_color, "#f5f1e8");
  const style = (prefix: string) => ({
    font: `${clamp(config?.[`${prefix}_font_size` as keyof AppConfig], 11, 22, 14)}px`,
    text: appearanceColor(config?.[`${prefix}_text_color` as keyof AppConfig], "#333333") ?? navigationText,
    background: appearanceColor(config?.[`${prefix}_background_color` as keyof AppConfig], "#f5f1e8") ?? navigationBackground,
  });
  const outline = style("navigation_outline");
  const bookmark = style("navigation_bookmark");
  const tree = style("navigation_tree");
  const list = style("navigation_list");
  return {
    "--editor-font-family": config?.interface_style && config.interface_style !== "classic" ? '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif' : FONT_STACKS[resolvedFamily],
    "--editor-font-size": `${clamp(config?.note_font_size, 12, 32, 16)}px`,
    "--editor-line-height": String(clamp(config?.editor_line_height, 1.2, 2.2, 1.6)),
    "--editor-block-spacing": `${clamp(config?.editor_block_spacing, 0, 3, 1)}em`,
    "--editor-paragraph-indent": `${clamp(config?.editor_paragraph_indent, 0, 2, 0)}em`,
    "--editor-heading-margin-top": `${clamp(config?.editor_heading_margin_top, 0, 2, 0.7)}em`,
    "--editor-heading-margin-bottom": `${clamp(config?.editor_heading_margin_bottom, 0, 1.5, 0.35)}em`,
    "--editor-list-margin-top": `${clamp(config?.editor_list_margin_top, 0, 2, 0.25)}em`,
    "--editor-list-margin-bottom": `${clamp(config?.editor_list_margin_bottom, 0, 1.5, 0.25)}em`,
    "--editor-list-indent": `${clamp(config?.editor_list_indent, 1, 3, 1)}em`,
    "--editor-list-marker-gap": `${clamp(config?.editor_list_marker_gap, 0.1, 0.8, 0.35)}em`,
    "--editor-blockquote-indent": `${clamp(config?.editor_blockquote_indent, 4, 32, 8)}px`,
    "--editor-search-highlight": safeColor(config?.editor_search_highlight_color),
    "--navigation-font-size": `${navigationFontSize}px`,
    ...(navigationText ? { "--navigation-text": navigationText } : {}),
    ...(navigationBackground ? { "--navigation-bg": navigationBackground } : {}),
    "--navigation-outline-font-size": outline.font,
    ...(outline.text ? { "--navigation-outline-text": outline.text } : {}),
    ...(outline.background ? { "--navigation-outline-bg": outline.background } : {}),
    "--navigation-bookmark-font-size": bookmark.font,
    ...(bookmark.text ? { "--navigation-bookmark-text": bookmark.text } : {}),
    ...(bookmark.background ? { "--navigation-bookmark-bg": bookmark.background } : {}),
    "--navigation-tree-font-size": tree.font,
    ...(tree.text ? { "--navigation-tree-text": tree.text } : {}),
    ...(tree.background ? { "--navigation-tree-bg": tree.background } : {}),
    "--navigation-list-font-size": list.font,
    ...(list.text ? { "--navigation-list-text": list.text } : {}),
    ...(list.background ? { "--navigation-list-bg": list.background } : {}),
  };
}

function safeAppearanceColor(value: unknown, fallback: string): string {
  const color = String(value ?? "");
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

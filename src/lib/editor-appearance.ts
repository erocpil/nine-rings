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
  editor_list_indent: 1.25,
  editor_list_marker_gap: 0.2,
  editor_blockquote_indent: 12,
  editor_search_highlight_color: "#ffd54f",
  editor_cjk_spacing: true,
} as const;

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
  return {
    "--editor-font-family": FONT_STACKS[resolvedFamily],
    "--editor-font-size": `${clamp(config?.note_font_size, 12, 32, 16)}px`,
    "--editor-line-height": String(clamp(config?.editor_line_height, 1.2, 2.2, 1.6)),
    "--editor-block-spacing": `${clamp(config?.editor_block_spacing, 0, 3, 1)}em`,
    "--editor-paragraph-indent": `${clamp(config?.editor_paragraph_indent, 0, 2, 0)}em`,
    "--editor-heading-margin-top": `${clamp(config?.editor_heading_margin_top, 0, 2, 0.7)}em`,
    "--editor-heading-margin-bottom": `${clamp(config?.editor_heading_margin_bottom, 0, 1.5, 0.35)}em`,
    "--editor-list-margin-top": `${clamp(config?.editor_list_margin_top, 0, 2, 0.25)}em`,
    "--editor-list-margin-bottom": `${clamp(config?.editor_list_margin_bottom, 0, 1.5, 0.25)}em`,
    "--editor-list-indent": `${clamp(config?.editor_list_indent, 1, 3, 1.25)}em`,
    "--editor-list-marker-gap": `${clamp(config?.editor_list_marker_gap, 0.1, 0.8, 0.2)}em`,
    "--editor-blockquote-indent": `${clamp(config?.editor_blockquote_indent, 4, 32, 12)}px`,
    "--editor-search-highlight": safeColor(config?.editor_search_highlight_color),
  };
}

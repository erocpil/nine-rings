import { normalizeInterfaceStyle, normalizeInterfaceColorMode } from "../interface-style";
// ── db-config.ts：localStorage 应用配置 ──

import type { AppConfig } from "./types";
import { DEFAULT_CONFIG } from "./types";

function normalizeExhibition(config: AppConfig): AppConfig {
  return { ...config,
    exhibition_text_width: config.exhibition_text_width === "narrow" || config.exhibition_text_width === "standard" ? config.exhibition_text_width : "wide",
    exhibition_density: config.exhibition_density === "compact" ? "compact" : "comfortable",
  };
}

const CONFIG_KEY = "nine_rings_config";

// The hierarchy palette was reordered to alternate cool and warm colors.
// Upgrade only the exact former defaults so a user's custom palette survives.
const LEGACY_HIERARCHY_COLORS = ["#9A5B00", "#B0473C", "#5E7C36", "#247F7B", "#5266A8", "#8356A1"];

function migrateHierarchyPalette(config: AppConfig): AppConfig {
  const colorsMatchLegacy = (colors: string[]) =>
    colors.length === LEGACY_HIERARCHY_COLORS.length &&
    colors.every((color, index) => color.toUpperCase() === LEGACY_HIERARCHY_COLORS[index]);
  const migrate = (colors: string[]) =>
    colorsMatchLegacy(colors) ? [...DEFAULT_CONFIG.hierarchy_path_custom_colors] : colors;
  return {
    ...config,
    hierarchy_path_custom_colors: migrate(config.hierarchy_path_custom_colors),
    hierarchy_outline_custom_colors: migrate(config.hierarchy_outline_custom_colors),
  };
}

export async function getConfig(): Promise<AppConfig> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CONFIG_KEY);
  } catch {
    // 在 Node/服务端测试环境中，localStorage 不可用，返回默认配置
    return { ...DEFAULT_CONFIG };
  }
  if (!raw) {
    console.log("[getConfig] localStorage empty → using defaults");
    return { ...DEFAULT_CONFIG };
  }
  try {
    const parsed = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    console.log("[getConfig]", "highlight_active_line:", parsed.highlight_active_line, "editor_show_line_numbers:", parsed.editor_show_line_numbers);
    return normalizeExhibition(migrateHierarchyPalette({ ...parsed, workspace_layout: parsed.workspace_layout === "exhibition" ? "exhibition" : "standard", interface_style: normalizeInterfaceStyle(parsed.interface_style), interface_color_mode: normalizeInterfaceColorMode(parsed.interface_color_mode) }));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function setConfig(partial: Partial<AppConfig>): Promise<AppConfig> {
  const current = await getConfig();
  const merged = normalizeExhibition({ ...current, ...partial });
  merged.workspace_layout = merged.workspace_layout === "exhibition" ? "exhibition" : "standard";
  merged.interface_style = normalizeInterfaceStyle(merged.interface_style);
  merged.interface_color_mode = normalizeInterfaceColorMode(merged.interface_color_mode);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(merged));
  }
  return merged;
}

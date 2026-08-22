// ── db-config.ts：localStorage 应用配置 ──

import type { AppConfig } from "./types";
import { DEFAULT_CONFIG } from "./types";

const CONFIG_KEY = "nine_rings_config";

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
    return parsed;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function setConfig(partial: Partial<AppConfig>): Promise<AppConfig> {
  const current = await getConfig();
  const merged = { ...current, ...partial };
  console.log("[setConfig]", JSON.stringify(partial), "→", JSON.stringify({ highlight_active_line: merged.highlight_active_line, editor_show_line_numbers: merged.editor_show_line_numbers }));
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(merged));
  } catch {
    // 在非浏览器环境保留内存返回值，不持久化
  }
  return merged;
}

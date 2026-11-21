import { validateBrowserRenameRules, type BrowserRenameRules } from "./browser-rename";
import type { BrowserSettingsStore } from "./browser-workspace-contract";

export interface BrowserRenamePreset { name: string; rules: BrowserRenameRules }
const key = "batch-rename-presets-v1";
export const maxBrowserRenamePresets = 40;

export function readBrowserRenamePresets(settings: BrowserSettingsStore): BrowserRenamePreset[] {
  const parsed: unknown = JSON.parse(settings.getItem(key) ?? "[]");
  if (!Array.isArray(parsed)) throw new Error("无法读取重命名预设");
  const presets = new Map<string, BrowserRenamePreset>();
  for (const preset of parsed.slice(0, maxBrowserRenamePresets)) {
    if (!preset || typeof preset.name !== "string" || !preset.name.trim() || preset.name.length > 60) continue;
    const rules = preset.rules;
    if (!rules || typeof rules.template !== "string" || typeof rules.find !== "string" || typeof rules.replacement !== "string"
      || !["text", "regex"].includes(rules.match) || !["keep", "lower", "upper"].includes(rules.letterCase)) continue;
    try { validateBrowserRenameRules(rules); }
    catch { continue; }
    presets.set(preset.name, { name: preset.name, rules });
  }
  return [...presets.values()];
}

export function writeBrowserRenamePresets(settings: BrowserSettingsStore, presets: BrowserRenamePreset[]) {
  settings.setItem(key, JSON.stringify(presets));
}

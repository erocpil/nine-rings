export interface EditorFoldIconConfig {
  editor_fold_icon_style: "chevron" | "triangle" | "custom";
  editor_fold_icon_collapsed: string;
  editor_fold_icon_expanded: string;
  editor_outline_fold_icon_style?: "triangle" | "chevron" | "inherit" | "custom" | null;
  editor_fold_icon_overrides?: Record<string, { style: "inherit" | "chevron" | "triangle" | "custom"; collapsed?: string; expanded?: string }>;
}

export type EditorFoldIconScope = "heading" | "block" | "outline";
export type EditorFoldIconOverride = { style: "inherit" | "chevron" | "triangle" | "custom"; collapsed?: string; expanded?: string };

export const DEFAULT_EDITOR_FOLD_ICONS: EditorFoldIconConfig = {
  editor_fold_icon_style: "chevron",
  editor_fold_icon_collapsed: "▶",
  editor_fold_icon_expanded: "▼",
};

export const EDITOR_FOLD_PRESETS = [
  { id: "chevron", label: "线条箭头", style: "chevron" },
  { id: "triangle", label: "实心三角 ▶ / ▼", style: "triangle" },
  { id: "small-triangle", label: "小三角 ▸ / ▾", style: "custom", collapsed: "▸", expanded: "▾" },
  { id: "right-down-arrows", label: "方向箭头 → / ↓", style: "custom", collapsed: "→", expanded: "↓" },
  { id: "angle-down", label: "轻量折角 › / ⌄", style: "custom", collapsed: "›", expanded: "⌄" },
  { id: "plus-minus", label: "加减号 + / −", style: "custom", collapsed: "+", expanded: "−" },
  { id: "boxed-plus-minus", label: "方框加减 ⊞ / ⊟", style: "custom", collapsed: "⊞", expanded: "⊟" },
] as const;

export function editorFoldPreset(config: Partial<EditorFoldIconConfig> | null): string {
  if (config?.editor_fold_icon_style !== "custom") return config?.editor_fold_icon_style ?? "chevron";
  return EDITOR_FOLD_PRESETS.find(preset => preset.style === "custom" && preset.collapsed === config.editor_fold_icon_collapsed && preset.expanded === config.editor_fold_icon_expanded)?.id ?? "custom";
}

export function editorFoldPresetPatch(id: string): Partial<EditorFoldIconConfig> {
  const preset = EDITOR_FOLD_PRESETS.find(item => item.id === id);
  if (!preset) return { editor_fold_icon_style: "custom" };
  return preset.style === "custom"
    ? { editor_fold_icon_style: "custom", editor_fold_icon_collapsed: preset.collapsed, editor_fold_icon_expanded: preset.expanded }
    : { editor_fold_icon_style: preset.style };
}

/** Old custom symbols remain shared; otherwise the chapter outline defaults to triangles. */
export function outlineFoldStyle(config: Partial<EditorFoldIconConfig> | null): "triangle" | "chevron" | "inherit" | "custom" {
  const style = config?.editor_outline_fold_icon_style;
  if (style === "triangle" || style === "chevron" || style === "inherit" || style === "custom") return style;
  return config?.editor_fold_icon_style === "custom" ? "inherit" : "triangle";
}

export function outlineFoldSymbol(config: Partial<EditorFoldIconConfig> | null, expanded: boolean): string | null {
  const override = validFoldOverride(config?.editor_fold_icon_overrides?.outline);
  if (override) return foldSymbolFromOverride(config, override, expanded);
  const style = outlineFoldStyle(config);
  if (style === "inherit") return editorFoldSymbol(config, expanded);
  if (style === "chevron") return null;
  if (style === "custom") return safeCustomSymbol(expanded ? config?.editor_fold_icon_overrides?.outline?.expanded : config?.editor_fold_icon_overrides?.outline?.collapsed, expanded);
  return expanded ? "▼" : "▶";
}

export function scopedFoldPreset(config: Partial<EditorFoldIconConfig> | null, scope: EditorFoldIconScope): string {
  if (scope === "outline" && !validFoldOverride(config?.editor_fold_icon_overrides?.outline)) return outlineFoldStyle(config);
  const override = validFoldOverride(config?.editor_fold_icon_overrides?.[scope]);
  if (!override || override.style === "inherit") return "inherit";
  return EDITOR_FOLD_PRESETS.find(preset => preset.style === override.style && (preset.style !== "custom" || preset.collapsed === override.collapsed && preset.expanded === override.expanded))?.id ?? "custom";
}

export function scopedFoldOverridePatch(config: Partial<EditorFoldIconConfig> | null, scope: EditorFoldIconScope, presetId: string): Record<string, EditorFoldIconOverride> {
  const overrides = { ...(config?.editor_fold_icon_overrides ?? {}) } as Record<string, EditorFoldIconOverride>;
  if (presetId === "inherit") {
    overrides[scope] = { style: "inherit" };
    return overrides;
  }
  if (presetId === "custom") {
    overrides[scope] = {
      style: "custom",
      collapsed: config?.editor_fold_icon_collapsed ?? "▶",
      expanded: config?.editor_fold_icon_expanded ?? "▼",
    };
    return overrides;
  }
  const patch = editorFoldPresetPatch(presetId);
  if (!patch.editor_fold_icon_style) return overrides;
  const override: EditorFoldIconOverride = { style: patch.editor_fold_icon_style };
  if (patch.editor_fold_icon_collapsed !== undefined) override.collapsed = patch.editor_fold_icon_collapsed;
  if (patch.editor_fold_icon_expanded !== undefined) override.expanded = patch.editor_fold_icon_expanded;
  overrides[scope] = override;
  return overrides;
}

export function scopedFoldSymbolConfig(config: Partial<EditorFoldIconConfig> | null, scope: Exclude<EditorFoldIconScope, "outline">): Partial<EditorFoldIconConfig> | null {
  const override = validFoldOverride(config?.editor_fold_icon_overrides?.[scope]);
  if (!override || override.style === "inherit") return config;
  return { ...config, editor_fold_icon_style: override.style, editor_fold_icon_collapsed: override.collapsed ?? "", editor_fold_icon_expanded: override.expanded ?? "" };
}

export function scopedFoldOverrideValue(config: Partial<EditorFoldIconConfig> | null, scope: EditorFoldIconScope): EditorFoldIconOverride | null {
  if (scope === "outline" && !validFoldOverride(config?.editor_fold_icon_overrides?.outline)) {
    const style = outlineFoldStyle(config);
    if (style === "inherit") return { style: "inherit" };
    if (style === "chevron" || style === "triangle") return { style };
    return { style: "custom", collapsed: "▶", expanded: "▼" };
  }
  return validFoldOverride(config?.editor_fold_icon_overrides?.[scope]);
}

function validFoldOverride(value: unknown): EditorFoldIconOverride | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const override = value as Partial<EditorFoldIconOverride>;
  return override.style === "inherit" || override.style === "chevron" || override.style === "triangle" || override.style === "custom"
    ? { style: override.style, collapsed: override.collapsed, expanded: override.expanded }
    : null;
}

function foldSymbolFromOverride(config: Partial<EditorFoldIconConfig> | null, override: EditorFoldIconOverride, expanded: boolean): string | null {
  if (override.style === "inherit") return editorFoldSymbol(config, expanded);
  if (override.style === "chevron") return null;
  if (override.style === "triangle") return expanded ? "▼" : "▶";
  return safeCustomSymbol(expanded ? override.expanded : override.collapsed, expanded);
}

function safeCustomSymbol(raw: unknown, expanded: boolean): string {
  if (typeof raw !== "string") return expanded ? "▼" : "▶";
  const text = Array.from(raw).filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join("").trim();
  return Array.from(text).slice(0, 4).join("") || (expanded ? "▼" : "▶");
}

/** Plain text only; old backups and empty/invalid custom values remain usable. */
export function editorFoldSymbol(
  config: Partial<EditorFoldIconConfig> | null,
  expanded: boolean,
): string | null {
  if (
    config?.editor_fold_icon_style !== "triangle" &&
    config?.editor_fold_icon_style !== "custom"
  )
    return null;
  const fallback = expanded ? "▼" : "▶";
  if (config.editor_fold_icon_style === "triangle") return fallback;
  const raw = expanded
    ? config.editor_fold_icon_expanded
    : config.editor_fold_icon_collapsed;
  if (typeof raw !== "string") return fallback;
  const text = Array.from(raw)
    .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join("")
    .trim();
  return Array.from(text).slice(0, 4).join("") || fallback;
}

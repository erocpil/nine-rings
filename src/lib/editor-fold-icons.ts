export interface EditorFoldIconConfig {
  editor_fold_icon_style: "chevron" | "triangle" | "custom";
  editor_fold_icon_collapsed: string;
  editor_fold_icon_expanded: string;
  editor_outline_fold_icon_style?: "triangle" | "chevron" | "inherit" | null;
}

export const DEFAULT_EDITOR_FOLD_ICONS: EditorFoldIconConfig = {
  editor_fold_icon_style: "chevron",
  editor_fold_icon_collapsed: "▶",
  editor_fold_icon_expanded: "▼",
};

export const EDITOR_FOLD_PRESETS = [
  { id: "chevron", label: "线条箭头", style: "chevron" },
  { id: "triangle", label: "实心三角 ▶ / ▼", style: "triangle" },
  { id: "small-triangle", label: "小三角 ▸ / ▾", style: "custom", collapsed: "▸", expanded: "▾" },
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
export function outlineFoldStyle(config: Partial<EditorFoldIconConfig> | null): "triangle" | "chevron" | "inherit" {
  const style = config?.editor_outline_fold_icon_style;
  if (style === "triangle" || style === "chevron" || style === "inherit") return style;
  return config?.editor_fold_icon_style === "custom" ? "inherit" : "triangle";
}

export function outlineFoldSymbol(config: Partial<EditorFoldIconConfig> | null, expanded: boolean): string | null {
  const style = outlineFoldStyle(config);
  return style === "inherit" ? editorFoldSymbol(config, expanded)
    : style === "chevron" ? null : expanded ? "▼" : "▶";
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

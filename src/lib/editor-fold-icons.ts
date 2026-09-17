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

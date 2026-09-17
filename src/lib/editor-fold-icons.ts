export interface EditorFoldIconConfig {
  editor_fold_icon_style: "chevron" | "triangle" | "custom";
  editor_fold_icon_collapsed: string;
  editor_fold_icon_expanded: string;
}

export const DEFAULT_EDITOR_FOLD_ICONS: EditorFoldIconConfig = {
  editor_fold_icon_style: "chevron",
  editor_fold_icon_collapsed: "▶",
  editor_fold_icon_expanded: "▼",
};

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

import { normalizeCodeLanguage } from "./code-highlight";
import type { ReadingBlockState } from "./reading-block-session";

export function structuredBlockSymbol(language?: unknown): string {
  const normalized = normalizeCodeLanguage(language);
  return normalized === "mermaid" ? "◇→◇" : normalized === "flow" ? "①→②" : "</>";
}

/** Presentation rules shared by NodeViews and virtual readonly rendering. */
export function codeBlockDisplay(
  attrs: Record<string, unknown>, override: ReadingBlockState = {}, defaultWrap = true,
) {
  const language = normalizeCodeLanguage(attrs.language);
  return {
    language,
    title: typeof attrs.title === "string" ? attrs.title : "",
    collapsed: override.collapsed ?? attrs.collapsed === true,
    wrap: override.wrap ?? (attrs.wrap === undefined ? defaultWrap : attrs.wrap !== false),
    isMermaid: language === "mermaid",
    isFlow: language === "flow",
    showFlow: language === "flow" && override.diagram !== false,
    showDiagram: language === "mermaid" && override.diagram !== false,
  };
}
export function blockquoteCaption(text: string, collapsed: boolean): string {
  const preview = collapsed ? text.trim().replace(/\s+/g, " ").slice(0, 24) : "";
  return preview ? `引用 ${preview}` : "引用";
}

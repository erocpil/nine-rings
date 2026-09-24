import { normalizeCodeLanguage } from "./code-highlight";
import type { ReadingBlockState } from "./reading-block-session";

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
    showDiagram: language === "mermaid" && override.diagram !== false,
  };
}
export function blockquoteCaption(text: string, collapsed: boolean): string {
  const preview = collapsed ? text.trim().replace(/\s+/g, " ").slice(0, 24) : "";
  return preview ? `引用 ${preview}` : "引用";
}

/** Fenced storage is shared, but gutter labels describe semantic block types. */
export function fencedBlockLabel(language: unknown): string {
  const name = typeof language === "string" ? language.trim().toLowerCase() : "";
  return name === "flow" ? "Flow" : name === "mermaid" ? "MMD" : name === "toc" ? "TOC" : "Code";
}

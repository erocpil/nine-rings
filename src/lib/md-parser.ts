/** CommonMark/GFM parser shared by import, paste, source, templates and Workers. */
import { markdownAST, parseGFMTable } from "./gfm-parser";
export type { MarkdownSourceSpan } from "./gfm-parser";
export { parseGFM as mdToDelta } from "./gfm-parser";

export function looksLikeMarkdown(text: string): boolean {
  // Classification must not parse a megabyte twice on the UI thread before the Worker starts.
  if (text.length > 32_768) return /(^|\n) {0,3}(?:#{1,6}\s|>|[-+*]\s|\d+[.)]\s|`{3,}|~{3,})|[*_`|$]|\[[^\]]+\]/m.test(text);
  if (/\\\(.+?\\\)|\[\^[^\]\s]+\]/.test(text)) return true;
  const signal = (node: { type: string; children?: readonly { type: string }[] }): boolean =>
    node.type !== "paragraph" && node.type !== "text" || !!node.children?.some(signal);
  return markdownAST(text).children.some(signal);
}
export function isMarkdownTableRow(text: string): boolean { return /(^|[^\\])\|/.test(text); }
export function markdownTableToEmbed(tableLines: string[]) { return parseGFMTable(tableLines.join("\n")); }
export function extractTitle(mdText: string, fallback: string): string {
  const heading = markdownAST(mdText).children.find(node => node.type === "heading" && node.depth === 1);
  if (!heading || heading.type !== "heading") return fallback;
  const text = (node: { type: string; value?: string; alt?: string | null; children?: readonly unknown[] }): string =>
    node.value ?? node.alt ?? node.children?.map(child => text(child as typeof node)).join("") ?? "";
  return heading.children.map(child => text(child)).join("").trim() || fallback;
}

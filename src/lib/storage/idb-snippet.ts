/** 纯文本搜索片段提取 — 从文本中提取匹配区域并高亮 */

/**
 * 从纯文本中提取匹配片段（带 `<mark>` 高亮），上下文各约 40 字符。
 * 不依赖 IndexedDB 或任何存储层，纯字符串函数。
 */
export interface SnippetPart {
  text: string;
  match: boolean;
}

export function snippetParts(text: string, query: string): SnippetPart[] {
  if (!text || !query) return [];
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const terms = [...new Set(qLower.trim().split(/\s+/).filter(Boolean))];
  if (!terms.length) return [];
  const positions = terms
    .map((term) => lower.indexOf(term))
    .filter((pos) => pos >= 0);
  const idx = positions.length ? Math.min(...positions) : -1;
  if (idx === -1) return [{ text: text.slice(0, 120), match: false }];

  const contextBefore = 40;
  const contextAfter = 60;
  const start = Math.max(0, idx - contextBefore);
  const end = Math.min(text.length, idx + query.length + contextAfter);

  let snippet = text.slice(start, end);
  if (start > 0) snippet = "\u2026" + snippet;
  if (end < text.length) snippet = snippet + "\u2026";

  const escaped = [...terms]
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const re = new RegExp(`(${escaped})`, "gi");
  return snippet
    .split(re)
    .filter(Boolean)
    .map((part) => ({ text: part, match: terms.includes(part.toLowerCase()) }));
}

/** Compatibility helper: escape text before adding the only permitted markup. */
export function extractSnippet(text: string, query: string): string {
  return snippetParts(text, query)
    .map((part) => {
      const escaped = part.text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
      return part.match ? `<mark>${escaped}</mark>` : escaped;
    })
    .join("");
}

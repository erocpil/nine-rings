/** 纯文本搜索片段提取 — 从文本中提取匹配区域并高亮 */

/**
 * 从纯文本中提取匹配片段（带 `<mark>` 高亮），上下文各约 40 字符。
 * 不依赖 IndexedDB 或任何存储层，纯字符串函数。
 */
export function extractSnippet(text: string, query: string): string {
  if (!text || !query) return "";
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx === -1) return text.slice(0, 120);

  const contextBefore = 40;
  const contextAfter = 60;
  const start = Math.max(0, idx - contextBefore);
  const end = Math.min(text.length, idx + query.length + contextAfter);

  let snippet = text.slice(start, end);
  if (start > 0) snippet = "\u2026" + snippet;
  if (end < text.length) snippet = snippet + "\u2026";

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "gi");
  return snippet.replace(re, "<mark>$1</mark>");
}

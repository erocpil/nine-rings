import type { DocumentOutlineItem } from "./document-outline";

/** GitHub-style heading fragments: lower case, remove punctuation, space → -. */
export function headingSlug(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\- ]/gu, "").replace(/ /g, "-");
}

const cache = new WeakMap<readonly DocumentOutlineItem[], Map<string, DocumentOutlineItem>>();
export function headingLinkMap(items: readonly DocumentOutlineItem[]): Map<string, DocumentOutlineItem> {
  const cached = cache.get(items);
  if (cached) return cached;
  const map = new Map<string, DocumentOutlineItem>();
  for (const item of items) {
    const base = headingSlug(item.text);
    let id = base;
    let suffix = 0;
    while (map.has(id)) id = `${base}-${++suffix}`;
    map.set(id, item);
  }
  cache.set(items, map);
  return map;
}

export function headingLinkTarget(target: EventTarget | null, items: readonly DocumentOutlineItem[]): DocumentOutlineItem | null {
  const link = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
  const href = link?.getAttribute("href");
  if (!href || href.startsWith("#nr-footnote-")) return null;
  const position = /^#nr-heading-(\d+)$/.exec(href)?.[1];
  if (position !== undefined) return items.find(item => item.pos === Number(position)) ?? null;
  try { return headingLinkMap(items).get(decodeURIComponent(href.slice(1))) ?? null; }
  catch { return null; }
}

/** Truncate display only; never use the shortened label as a jump identifier. */
export function outlineLabel(text: string, maximum = 80): string {
  let label = "";
  let count = 0;
  for (const char of text.replace(/\s+/g, " ").trim()) {
    if (++count > maximum) return `${label}…`;
    label += char;
  }
  return label;
}

export function tocLevels(source: string): number[] {
  const configured = /^levels\s*:\s*([1-6](?:\s*,\s*[1-6])*)\s*$/m.exec(source)?.[1];
  return configured ? [...new Set(configured.split(",").map(Number))].sort() : [1, 2, 3];
}

/** Chinese prose boundaries apply to bare autolinks, never explicit destinations. */
export const CJK_LINK_BOUNDARY = /[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u;
export function bareLinkParts(text: string): Array<{ text: string; href?: string }> {
  const parts: Array<{ text: string; href?: string }> = [];
  const pattern = /https?:\/\/[^\s\p{Script=Han}\u3000-\u303f\uff00-\uffef<>]+|www\.[^\s\p{Script=Han}\u3000-\u303f\uff00-\uffef<>]+|[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d](?:[a-z\d.-]*[a-z\d])?\.[a-z]{2,}/giu;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    let value = match[0].replace(/[.,:;!?]+$/, "");
    // Preserve balanced parentheses in paths; exclude surrounding prose punctuation.
    while (value.endsWith(")") && (value.match(/\)/g)?.length ?? 0) > (value.match(/\(/g)?.length ?? 0)) value = value.slice(0, -1);
    if (!value) continue;
    if (match.index! > offset) parts.push({ text: text.slice(offset, match.index) });
    parts.push({ text: value, href: /^https?:/i.test(value) ? value : /^www\./i.test(value) ? `http://${value}` : `mailto:${value}` });
    offset = match.index! + value.length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts;
}

/** Older imports stored merged autolinks as one mark. Recognize only self-labelled links. */
export function malformedBareLink(text: string, href: unknown, title?: unknown): boolean {
  if (typeof href !== "string" || title || !CJK_LINK_BOUNDARY.test(text)) return false;
  return href === text || href === `http://${text}` || href === `https://${text}` || href === `mailto:${text}`;
}

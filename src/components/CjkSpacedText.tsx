import { needsCjkLatinSpacing, supportsNativeCjkLatinSpacing } from "../extensions/CjkLatinSpacing";

/** Read-only projections keep real text intact; only boundary spans add space. */
export function cjkSpacedText(text: string, previous = ""): React.ReactNode {
  if (supportsNativeCjkLatinSpacing()) return text;
  const parts: React.ReactNode[] = [];
  let start = 0;
  let offset = 0;
  for (const character of text) {
    if (previous && needsCjkLatinSpacing(previous, character)) {
      if (offset > start) parts.push(text.slice(start, offset));
      parts.push(<span key={offset} className="cjk-auto-space-before">{character}</span>);
      start = offset + character.length;
    }
    previous = character;
    offset += character.length;
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}

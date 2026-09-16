export interface EscapeRepairCandidate {
  line: number;
  before: string;
  after: string;
}

/** Ambiguous historical escapes: propose only, never change without explicit selection. */
export function scanMarkdownEscapes(source: string): EscapeRepairCandidate[] {
  const candidates: EscapeRepairCandidate[] = [];
  let fence: string | null = null;
  source.split("\n").forEach((before, line) => {
    const marker = before.trim().match(/^(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = null;
      return;
    }
    if (fence) return;
    const match = before.match(
      /^(\s*(?:[-*+]|\d+\.)\s+)\\+\[([ xX])\\+\](?=\s|$)/,
    );
    if (match)
      candidates.push({
        line,
        before,
        after: before.replace(match[0], `${match[1]}[${match[2]}]`),
      });
  });
  return candidates;
}

export function applyMarkdownEscapeRepairs(
  source: string,
  candidates: EscapeRepairCandidate[],
): string {
  const lines = source.split("\n");
  for (const candidate of candidates) {
    if (lines[candidate.line] !== candidate.before)
      throw new Error("正文已变化，请重新扫描");
    lines[candidate.line] = candidate.after;
  }
  return lines.join("\n");
}

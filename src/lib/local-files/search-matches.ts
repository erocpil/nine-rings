import { findTextMatches, initializeSearchRegex, searchPatternError, type SearchOptions } from "../search-matching";
export interface LocalSourceMatch { from: number; to: number; line: number; snippet: string; count: number }
export async function matchLocalSource(source: string, query: string, options: SearchOptions) {
  if (options.regex) await initializeSearchRegex();
  const error = searchPatternError(query, options);
  if (error) throw new Error(error);
  const matches = findTextMatches(source, query, options, 501);
  const rows: LocalSourceMatch[] = [];
  let scanned = 0, line = 1, lastStart = 0;
  for (const match of matches.slice(0, 500)) {
    while (scanned < match.from) { if (source.charCodeAt(scanned) === 10) { line++; lastStart = scanned + 1; } scanned++; }
    const previous = rows[rows.length - 1];
    if (previous?.line === line) { previous.count++; continue; }
    const end = source.indexOf("\n", match.from);
    const start = Math.max(lastStart, match.from - 80);
    rows.push({ from: match.from, to: match.to, line, count: 1, snippet: `${start > lastStart ? "…" : ""}${source.slice(start, Math.min(end < 0 ? source.length : end, start + 240))}` });
  }
  return { rows, limited: matches.length > 500 };
}

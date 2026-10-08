/** Matching options shared by global search and rendered-document find. */
import type { PCRE2, PCRE2Regex } from "pcre2-wasm";

let engine: PCRE2 | null = null;
let flags = { UTF: 0, UCP: 0, MULTILINE: 0, CASELESS: 0 };
let initializing: Promise<void> | null = null;
const compiled = new Map<string, PCRE2Regex>();
export function initializeSearchRegex(): Promise<void> {
  initializing ??= import("pcre2-wasm")
    .then(async (module) => {
      engine = await module.createPCRE2();
      flags = module.FLAGS;
    })
    .catch((error) => {
      initializing = null;
      throw error;
    });
  return initializing;
}
export function searchRegexReady(): boolean {
  return engine !== null;
}
export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}
export interface TextMatch {
  from: number;
  to: number;
  captures?: (string | null | undefined)[];
  namedCaptures?: Record<string, string | null | undefined>;
}
function searchPattern(query: string, options: SearchOptions = {}): RegExp {
  const source = options.regex
    ? query
    : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(source, options.caseSensitive ? "gmu" : "gmiu");
}
function perlPattern(query: string, options: SearchOptions): PCRE2Regex {
  if (!engine) throw new Error("正在加载 Perl 正则引擎…");
  const key = `${options.caseSensitive ? "1" : "0"}:${query}`;
  let pattern = compiled.get(key);
  if (!pattern) {
    pattern = engine.compile(
      query,
      flags.UTF |
        flags.UCP |
        flags.MULTILINE |
        (options.caseSensitive ? 0 : flags.CASELESS),
    );
    compiled.set(key, pattern);
    if (compiled.size > 16) {
      const oldest = compiled.keys().next().value!;
      compiled.get(oldest)!.destroy();
      compiled.delete(oldest);
    }
  }
  return pattern;
}
export function searchPatternError(
  query: string,
  options: SearchOptions = {},
): string {
  if (!query || !options.regex) return "";
  if (!engine) return "正在加载 Perl 正则引擎…";
  try {
    perlPattern(query, options);
    return "";
  } catch (error) {
    return `正则表达式无效：${error instanceof Error ? error.message : String(error)}`;
  }
}
const wordCharacter = /[\p{L}\p{N}\p{M}_]/u;
function isWholeWord(text: string, from: number, to: number): boolean {
  const beforeCharacters = Array.from(text.slice(Math.max(0, from - 2), from));
  const before = beforeCharacters[beforeCharacters.length - 1] ?? "";
  const after = Array.from(text.slice(to, to + 2))[0] ?? "";
  return !wordCharacter.test(before) && !wordCharacter.test(after);
}
export function findTextMatches(
  text: string,
  query: string,
  options: SearchOptions = {},
): TextMatch[] {
  if (!query || searchPatternError(query, options)) return [];
  if (options.regex) {
    const result: TextMatch[] = [];
    for (const match of perlPattern(query, options).matchAllIterator(text, {
      matchLimit: 100_000,
      depthLimit: 500,
    })) {
      if (!match.match.length) continue;
      const from = match.index,
        to = from + match.match.length;
      if (options.wholeWord && !isWholeWord(text, from, to)) continue;
      result.push({
        from,
        to,
        captures: [match.match, ...match.groups],
        namedCaptures: match.namedGroups,
      });
    }
    return result;
  }
  const pattern = searchPattern(query, options);
  const matches: TextMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (!match[0].length) {
      // Empty assertions cannot be highlighted/replaced. Advance by a complete
      // Unicode code point so /^/, /a*/ and emoji never loop indefinitely.
      pattern.lastIndex =
        match.index + ((text.codePointAt(match.index) ?? 0) > 0xffff ? 2 : 1);
      continue;
    }
    const from = match.index,
      to = from + match[0].length;
    if (options.wholeWord && !isWholeWord(text, from, to)) continue;
    matches.push({
      from,
      to,
      ...(options.regex
        ? { captures: [...match], namedCaptures: match.groups }
        : {}),
    });
  }
  return matches;
}
/** Regex replacement tokens; ordinary replacements always remain literal. */
export function searchReplacement(
  value: string,
  match: TextMatch,
  options: SearchOptions = {},
): string {
  if (!options.regex || !match.captures) return value;
  const captures = match.captures;
  return value.replace(
    /\$(\$|&|\d{1,2}|<[^>]+>|\{[^}]+\})/g,
    (token, group: string) => {
      if (group === "$") return "$";
      if (group === "&") return captures[0] ?? "";
      if (group.startsWith("<") || group.startsWith("{"))
        return match.namedCaptures
          ? (match.namedCaptures[group.slice(1, -1)] ?? "")
          : token;
      const index = Number(group);
      if (index >= 0 && index < captures.length) return captures[index] ?? "";
      if (
        group.length === 2 &&
        Number(group[0]) > 0 &&
        Number(group[0]) < captures.length
      )
        return (captures[Number(group[0])] ?? "") + group[1];
      return token;
    },
  );
}

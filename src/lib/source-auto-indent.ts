import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, getIndentUnit, indentRange, indentString, language } from "@codemirror/language";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import { cppDelimiterTokens, type CppLexState } from "./source-cpp-delimiters";

export type SourceAutoIndentScope = "selection" | "document";

type CppScope = { kind: "class" | "block" | "continuation"; delimiter: string; openingIndent: number };

/** C++'s grammar recovery can lose the class scope after an otherwise harmless
 * parse error (for example, a temporary `};` after a member definition). Use
 * delimiters and lexical comment/string boundaries for stable class/member
 * levels. Like Vim cindent, round-parenthesis continuations use two indent
 * units while brackets and ordinary blocks use one. */
function cppIndentChanges(
  state: EditorState,
  selectedLines: Set<number>,
): { from: number; to: number; insert: string }[] {
  const scopes: CppScope[] = [];
  const lex: CppLexState = {
    blockComment: false,
    rawStringEnd: null,
    quotedString: null,
    continuedLineComment: false,
    continuedDirective: false,
  };
  const unitColumns = Math.max(1, getIndentUnit(state));
  const innerIndent = (scope: CppScope) => scope.openingIndent + unitColumns * (scope.delimiter === "(" ? 2 : 1);
  const changes: { from: number; to: number; insert: string }[] = [];
  const closeScope = (delimiter: string) => {
    for (let index = scopes.length - 1; index >= 0; index--) {
      if (scopes[index].delimiter !== delimiter) continue;
      const scope = scopes[index];
      scopes.splice(index);
      return scope;
    }
  };

  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number);
    const leading = /^\s*/.exec(line.text)![0];
    const text = line.text.slice(leading.length);
    const insideRawString = lex.rawStringEnd !== null;
    const tokens = cppDelimiterTokens(line.text, lex);
    let leadingClosers = 0;
    let closingIndent: number | undefined;
    let nextLeadingPosition = leading.length;
    for (const token of tokens) {
      if (token.kind !== "close" || line.text.slice(nextLeadingPosition, token.position).trim()) break;
      leadingClosers++;
      closingIndent = closeScope(token.delimiter)?.openingIndent ?? closingIndent;
      nextLeadingPosition = token.position + 1;
    }
    const top = scopes[scopes.length - 1];
    const accessLabel = top?.kind === "class"
      && /^(?:(?:public|protected|private)(?:\s+slots)?|signals|slots|Q_SIGNALS|Q_SLOTS)\s*:/.test(text);
    const columns = !text.trim()
      ? 0
      : closingIndent !== undefined
        ? closingIndent
        : accessLabel
        ? top!.openingIndent
        : top
          ? innerIndent(top)
          : 0;
    const replacement = indentString(state, columns);
    if (!insideRawString && selectedLines.has(number) && leading !== replacement) {
      changes.push({ from: line.from, to: line.from + leading.length, insert: replacement });
    }

    let skippedClosers = leadingClosers;
    for (const token of tokens) {
      if (token.kind === "close") {
        if (skippedClosers > 0) {
          skippedClosers--;
          continue;
        }
        closeScope(token.delimiter);
        continue;
      }
      const beforeBrace = line.text.slice(0, token.position);
      const opensClass = token.delimiter === "{" && /^\s*(?:(?:template\s*<.*>\s*)?)(?:class|struct|union)\b/.test(beforeBrace)
        && !/^\s*enum\b/.test(beforeBrace);
      const parent = scopes[scopes.length - 1];
      // A signature's final parameter can close ')' before '{' on the same
      // line. The body belongs to the enclosing scope, not the parameter indent.
      const openingIndent = token.delimiter === "{"
        ? Math.min(columns, parent ? innerIndent(parent) : 0)
        : columns;
      scopes.push({ kind: token.delimiter !== "{" ? "continuation" : opensClass ? "class" : "block", delimiter: token.delimiter, openingIndent });
    }
  }
  return changes;
}

/** Reindent selected lines (or the whole document) with the active language's
 * CodeMirror indentation rules. Changes are isolated as one undoable action. */
export function sourceAutoIndentChange(
  state: EditorState,
  scope: SourceAutoIndentScope,
): TransactionSpec | null {
  if (state.readOnly || !state.doc.length) return null;

  const activeLanguage = state.facet(language);
  if (activeLanguage && !ensureSyntaxTree(state, state.doc.length, 1000)) {
    throw Error("源码仍在解析，请稍后重试自动缩进。");
  }

  const selectedLines = new Set<number>();
  if (scope === "document") {
    for (let line = 1; line <= state.doc.lines; line++) selectedLines.add(line);
  } else {
    const selectedRanges = state.selection.ranges.filter(range => !range.empty);
    if (!selectedRanges.length) return null;
    for (const range of selectedRanges) {
      const first = state.doc.lineAt(range.from).number;
      const last = state.doc.lineAt(Math.max(range.from, range.to - 1)).number;
      for (let line = first; line <= last; line++) selectedLines.add(line);
    }
  }

  if (!selectedLines.size) return null;
  const ordered = [...selectedLines].sort((a, b) => a - b);
  const changes = activeLanguage?.name === "cpp"
    ? cppIndentChanges(state, selectedLines)
    : (() => {
        const result: { from: number; to: number; insert: string }[] = [];
        let start = ordered[0];
        let end = start;
        const collect = (first: number, last: number) => {
          const changeSet = indentRange(state, state.doc.line(first).from, state.doc.line(last).to);
          changeSet.iterChanges((from, to, _fromB, _toB, inserted) => {
            result.push({ from, to, insert: inserted.toString() });
          });
        };
        for (const line of ordered.slice(1)) {
          if (line === end + 1) end = line;
          else { collect(start, end); start = end = line; }
        }
        collect(start, end);
        return result;
      })();

  return changes.length
    ? {
        changes,
        userEvent: "input.indent",
        annotations: isolateHistory.of("full"),
      }
    : null;
}

/** Use unchanged token spans to derive indentation without applying formatting edits.
 * Unmatched lines and multiline literals retain their original whitespace.
 */
export async function sourceFormattedIndentChange(state: EditorState, scope: SourceAutoIndentScope): Promise<{ change: TransactionSpec | null; skipped: number }> {
  const empty = { change: null, skipped: 0 };
  if (state.readOnly || !state.doc.length || (scope === "selection" && state.selection.main.empty)) return empty;
  const { formatSource, sourceFormatSettings, sourceFormatStyle } = await import("./source-formatting");
  const { blockWorkspacePreferences } = await import("./block-display-settings");
  const prefs = blockWorkspacePreferences();
  const source = state.doc.toString();
  const settings = sourceFormatSettings();
  const validation = settings.style === "custom" ? { validationStyle: settings.custom } : {};
  const style = sourceFormatStyle(settings, prefs.tabSize ?? 4, prefs.sourceIndentStyle !== "spaces");
  const formatted = await formatSource({ source, language: "cpp", style, ...validation });
  const joined: number[] = [];
  const result = await sourceIndentationFromFormatted(state, scope, formatted, joined);
  const tree = ensureSyntaxTree(state, state.doc.length, 1000);
  const keepBreaks = new Set(joined.filter(number => {
    if (number <= 1) return false;
    const previous = state.doc.line(number - 1);
    return /[,([]\s*$/.test(previous.text) && !/^\s*#/.test(previous.text)
      && [",", "(", "["].includes(tree?.resolveInner(previous.from + previous.text.trimEnd().length - 1, 1).name ?? "");
  }).map(number => number - 1));
  if (!keepBreaks.size || source.includes("__nr_indent_break_")) return result;
  // Temporary line comments constrain only the reference formatter's layout.
  // They never enter the document, its history or its saved source.
  const probe = source.split("\n").map((line, index) => keepBreaks.has(index + 1) ? `${line} // __nr_indent_break_${index}__` : line).join("\n");
  const reference = await formatSource({ source: probe, language: "cpp", style, ...validation });
  return sourceIndentationFromFormatted(state, scope, reference.replace(/[ \t]*\/\/ __nr_indent_break_\d+__/g, ""));
}

export async function sourceIndentationFromFormatted(state: EditorState, scope: SourceAutoIndentScope, formatted: string, joined?: number[]): Promise<{ change: TransactionSpec | null; skipped: number }> {
  const source = state.doc.toString();
  if (source === formatted) return { change: null, skipped: 0 };
  const compact = (text: string) => {
    const positions: number[] = [];
    let tokens = "";
    for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) { positions.push(i); tokens += text[i]; }
    return { tokens, positions };
  };
  const before = compact(source), after = compact(formatted);
  const { diff } = await import("@codemirror/merge");
  const edits = before.tokens === after.tokens ? [] : diff(before.tokens, after.tokens, { scanLimit: 1000, timeout: 100 });
  const spans: { from: number; to: number; target: number }[] = [];
  let a = 0, b = 0;
  for (const edit of edits) { spans.push({ from: a, to: edit.fromA, target: b }); a = edit.toA; b = edit.toB; }
  spans.push({ from: a, to: before.tokens.length, target: b });
  const tree = ensureSyntaxTree(state, state.doc.length, 1000);
  if (!tree) throw Error("源码仍在解析，请稍后重试自动缩进。");
  const changes: { from: number; to: number; insert: string }[] = [];
  let token = 0, span = 0, skipped = 0;
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number);
    const prefix = /^[\t ]*/.exec(line.text)![0];
    while (token < before.positions.length && before.positions[token] < line.from + prefix.length) token++;
    const first = token;
    while (token < before.positions.length && before.positions[token] < line.to) token++;
    if (first === token || (scope !== "document" && !state.selection.ranges.some(range => !range.empty && line.to >= range.from && line.from < range.to))) continue;
    let literal = false;
    for (let node = tree.resolveInner(line.from + prefix.length, 1); node; node = node.parent!) {
      if (node.from < line.from && /string|comment|heredoc/i.test(node.name)) literal = true;
    }
    if (literal) continue;
    while (span < spans.length - 1 && spans[span].to <= first) span++;
    const match = spans[span];
    if (first < match.from || token > match.to) { skipped++; continue; }
    const position = after.positions[match.target + first - match.from];
    const start = formatted.lastIndexOf("\n", position - 1) + 1;
    const indent = /^[\t ]*/.exec(formatted.slice(start))![0];
    // A joined continuation has no line-leading indentation in the reference
    // layout. Its containing line's prefix is not a valid indentation target.
    if (position !== start + indent.length) { joined?.push(number); skipped++; continue; }
    if (prefix !== indent) changes.push({ from: line.from, to: line.from + prefix.length, insert: indent });
  }
  return { change: changes.length ? { changes, userEvent: "input.indent", annotations: isolateHistory.of("full") } : null, skipped };
}

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

/** Derive only line-leading whitespace from the same formatter/style as Format.
 * Token offsets allow clang-format to wrap/join lines without rewriting source.
 */
export async function sourceFormattedIndentChange(state: EditorState, scope: SourceAutoIndentScope): Promise<TransactionSpec | null> {
  if (state.readOnly || !state.doc.length || (scope === "selection" && state.selection.main.empty)) return null;
  const { formatSource, sourceFormatSettings, sourceFormatStyle } = await import("./source-formatting");
  const { blockWorkspacePreferences } = await import("./block-display-settings");
  const prefs = blockWorkspacePreferences();
  const source = state.doc.toString();
  const formatted = await formatSource({ source, language: "cpp", style: sourceFormatStyle(sourceFormatSettings(), prefs.tabSize ?? 4, prefs.sourceIndentStyle !== "spaces") });
  const changes: { from: number; to: number; insert: string }[] = [];
  let a = 0, b = 0;
  while (a < source.length || b < formatted.length) {
    while (a < source.length && /\s/.test(source[a])) a++;
    while (b < formatted.length && /\s/.test(formatted[b])) b++;
    if (source[a] !== formatted[b]) throw Error("格式化改变了代码顺序，无法安全提取缩进；请使用格式化全文。");
    if (a >= source.length) break;
    const line = state.doc.lineAt(a);
    const prefix = /^[\t ]*/.exec(line.text)![0];
    if (a === line.from + prefix.length && (scope === "document" || state.selection.ranges.some(range => !range.empty && line.to >= range.from && line.from <= range.to))) {
      const start = formatted.lastIndexOf("\n", b - 1) + 1;
      const indent = /^[\t ]*/.exec(formatted.slice(start))![0];
      if (prefix !== indent) changes.push({ from: line.from, to: line.from + prefix.length, insert: indent });
    }
    a++; b++;
  }
  return changes.length ? { changes, userEvent: "input.indent", annotations: isolateHistory.of("full") } : null;
}

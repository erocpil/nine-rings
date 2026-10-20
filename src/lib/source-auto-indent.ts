import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, getIndentUnit, indentRange, indentString, language } from "@codemirror/language";
import type { EditorState, TransactionSpec } from "@codemirror/state";

export type SourceAutoIndentScope = "selection" | "document";

type CppScope = { kind: "class" | "block"; openingIndent: number };
type CppLexState = { blockComment: boolean; rawStringEnd: string | null };

function cppBraceTokens(text: string, state: CppLexState): { position: number; kind: "open" | "close" }[] {
  const tokens: { position: number; kind: "open" | "close" }[] = [];
  if (!state.blockComment && !state.rawStringEnd && /^\s*#/.test(text)) return tokens;
  for (let index = 0; index < text.length;) {
    if (state.blockComment) {
      const end = text.indexOf("*/", index);
      if (end < 0) break;
      state.blockComment = false;
      index = end + 2;
      continue;
    }
    if (state.rawStringEnd) {
      const end = text.indexOf(state.rawStringEnd, index);
      if (end < 0) break;
      index = end + state.rawStringEnd.length;
      state.rawStringEnd = null;
      continue;
    }
    if (text.startsWith("//", index)) break;
    if (text.startsWith("/*", index)) {
      state.blockComment = true;
      index += 2;
      continue;
    }
    const rawStart = /^R"([^ ()\\]{0,16})\(/.exec(text.slice(index));
    if (rawStart) {
      state.rawStringEnd = `)${rawStart[1]}"`;
      index += rawStart[0].length;
      continue;
    }
    const char = text[index];
    if (char === "\"" || char === "'") {
      index++;
      while (index < text.length) {
        if (text[index] === "\\") index += 2;
        else if (text[index++] === char) break;
      }
      continue;
    }
    if (char === "{") tokens.push({ position: index, kind: "open" });
    else if (char === "}") tokens.push({ position: index, kind: "close" });
    index++;
  }
  return tokens;
}

/** C++'s grammar recovery can lose the class scope after an otherwise harmless
 * parse error (for example, a temporary `};` after a member definition). Use
 * braces and lexical comment/string boundaries for stable class/member levels. */
function cppIndentChanges(
  state: EditorState,
  selectedLines: Set<number>,
): { from: number; to: number; insert: string }[] {
  const scopes: CppScope[] = [];
  const lex: CppLexState = { blockComment: false, rawStringEnd: null };
  const unitColumns = Math.max(1, getIndentUnit(state));
  const changes: { from: number; to: number; insert: string }[] = [];

  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number);
    const leading = /^\s*/.exec(line.text)![0];
    const text = line.text.slice(leading.length);
    const insideRawString = lex.rawStringEnd !== null;
    const tokens = cppBraceTokens(line.text, lex);
    let leadingClosers = 0;
    let nextLeadingPosition = leading.length;
    for (const token of tokens) {
      if (token.kind !== "close" || line.text.slice(nextLeadingPosition, token.position).trim()) break;
      leadingClosers++;
      nextLeadingPosition = token.position + 1;
    }
    for (let count = 0; count < leadingClosers; count++) scopes.pop();

    const top = scopes[scopes.length - 1];
    const accessLabel = top?.kind === "class" && /^(?:public|protected|private)\s*:/.test(text);
    const columns = !text.trim()
      ? 0
      : accessLabel
        ? top!.openingIndent
        : top
          ? top.openingIndent + unitColumns
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
        scopes.pop();
        continue;
      }
      const beforeBrace = line.text.slice(0, token.position);
      const opensClass = /^\s*(?:(?:template\s*<.*>\s*)?)(?:class|struct|union)\b/.test(beforeBrace)
        && !/^\s*enum\b/.test(beforeBrace);
      scopes.push({ kind: opensClass ? "class" : "block", openingIndent: columns });
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

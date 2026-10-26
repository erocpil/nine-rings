type CppDelimiter = { position: number; kind: "open" | "close"; delimiter: string };
export type CppLexState = {
  blockComment: boolean;
  rawStringEnd: string | null;
  quotedString: "\"" | "'" | null;
  continuedLineComment: boolean;
  continuedDirective: boolean;
};

function hasEscapedLineEnding(text: string) {
  let slashes = 0;
  for (let index = text.length - 1; index >= 0 && text[index] === "\\"; index--) slashes++;
  return slashes % 2 === 1;
}

export function cppDelimiterTokens(text: string, state: CppLexState): CppDelimiter[] {
  const tokens: CppDelimiter[] = [];
  if (state.continuedDirective || (!state.blockComment && !state.rawStringEnd && !state.quotedString && !state.continuedLineComment && /^\s*#/.test(text))) {
    state.continuedDirective = hasEscapedLineEnding(text);
    return tokens;
  }
  for (let index = 0; index < text.length;) {
    if (state.continuedLineComment) {
      state.continuedLineComment = hasEscapedLineEnding(text);
      break;
    }
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
    if (state.quotedString) {
      let closed = false;
      while (index < text.length) {
        if (text[index] === "\\") {
          if (index === text.length - 1) {
            state.quotedString = hasEscapedLineEnding(text) ? state.quotedString : null;
            index++;
            break;
          }
          index += 2;
        } else if (text[index++] === state.quotedString) {
          state.quotedString = null;
          closed = true;
          break;
        }
      }
      if (!closed) state.quotedString = hasEscapedLineEnding(text) ? state.quotedString : null;
      continue;
    }
    if (text.startsWith("//", index)) {
      state.continuedLineComment = hasEscapedLineEnding(text);
      break;
    }
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
      state.quotedString = char;
      index++;
      continue;
    }
    if ("{([".includes(char)) tokens.push({ position: index, kind: "open", delimiter: char });
    else if ("})]".includes(char)) tokens.push({ position: index, kind: "close", delimiter: "{(["["})]".indexOf(char)] });
    index++;
  }
  return tokens;
}

/** Find one delimiter's matching close without scanning unrelated earlier text. */
export function cppDelimiterPairAt(text: string, openingPosition: number, delimiter: string): number | null {
  if (!"{([".includes(delimiter) || text[openingPosition] !== delimiter) return null;
  const stack: CppDelimiter[] = [{ position: openingPosition, kind: "open", delimiter }];
  const state: CppLexState = {
    blockComment: false,
    rawStringEnd: null,
    quotedString: null,
    continuedLineComment: false,
    continuedDirective: false,
  };
  const suffix = text.slice(openingPosition);
  let base = openingPosition;
  for (const line of suffix.split("\n")) {
    for (const token of cppDelimiterTokens(line, state)) {
      const position = base + token.position;
      if (position === openingPosition) continue;
      if (token.kind === "open") {
        stack.push({ ...token, position });
        continue;
      }
      let index = stack.length - 1;
      while (index >= 0 && stack[index]?.delimiter !== token.delimiter) index--;
      if (index < 0) continue;
      if (index === 0) return position;
      stack.splice(index);
    }
    base += line.length + 1;
  }
  return null;
}

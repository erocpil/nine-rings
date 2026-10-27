import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
} from "@codemirror/language";

interface MakefileState {
  defineBody: boolean;
}

const DIRECTIVE =
  /^\s*(?:-?include|sinclude|define|endef|ifeq|ifneq|ifdef|ifndef|else|endif|export|unexport|override|private|vpath)\b/;
const ASSIGNMENT =
  /^\s*(?:override\s+|export\s+|private\s+)?(?:[A-Za-z_][\w.-]*|\$\([^)]+\)|\$\{[^}]+\})\s*(?:::|[?:+!])?=/;
const TARGET = /^\s*(?:[^\s:#=]+(?:\s+[^\s:#=]+)*)\s*(?=::?)/;

const makefileParser: StreamParser<MakefileState> = {
  name: "makefile",
  startState: () => ({ defineBody: false }),
  token(stream, state) {
    if (stream.sol()) {
      if (stream.peek() === "\t") {
        stream.next();
        return "meta";
      }
      if (stream.match(/^\s*#/)) {
        stream.skipToEnd();
        return "comment";
      }
      const directive = stream.match(DIRECTIVE);
      if (directive) {
        const word = stream.current().trimStart();
        if (word === "define") state.defineBody = true;
        if (word === "endef") state.defineBody = false;
        return "keyword";
      }
      if (
        stream.match(
          /^\s*\.(?:PHONY|SUFFIXES|DEFAULT|PRECIOUS|INTERMEDIATE|SECONDARY|SECONDEXPANSION|DELETE_ON_ERROR|IGNORE|LOW_RESOLUTION_TIME|SILENT|EXPORT_ALL_VARIABLES|NOTPARALLEL|ONESHELL|POSIX)\b/,
        )
      )
        return "macroName";
      if (stream.match(ASSIGNMENT)) return "variableName.definition";
      if (stream.match(TARGET)) return "typeName.definition";
    }

    if (state.defineBody && stream.match(/^endef\b/)) {
      state.defineBody = false;
      return "keyword";
    }
    if (stream.match(/^#.*$/)) return "comment";
    if (stream.match(/^\$\((?:[^()]|\([^)]*\))*\)|^\$\{[^}]+\}|^\$[@%<?^+*|]/))
      return "macroName";
    if (stream.match(/^(?:::|[?:+!])?=/)) return "operator";
    if (stream.match(/^\|/)) return "operator";
    if (stream.match(/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)\b/)) return "number";
    if (stream.match(/^["']/)) {
      const quote = stream.current();
      let escaped = false;
      while (!stream.eol()) {
        const char = stream.next();
        if (char === quote && !escaped) break;
        escaped = char === "\\" && !escaped;
        if (char !== "\\") escaped = false;
      }
      return "string";
    }
    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: "#" },
  },
};

export const makefileLanguage = StreamLanguage.define(makefileParser);
export const makefileLanguageSupport = new LanguageSupport(makefileLanguage);
export const makefileLanguageDescription = LanguageDescription.of({
  name: "Makefile",
  alias: ["makefile", "make", "mk", "gnumake"],
  extensions: ["mk", "mak"],
  filename: /^(?:GNUmakefile|BSDmakefile|[Mm]akefile)(?:\.(?:am|in))?$/,
  load: async () => makefileLanguageSupport,
});

import { HighlightStyle, syntaxHighlighting, LanguageSupport, LRLanguage, foldInside, foldNodeProp } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { styleTags, tags } from "@lezer/highlight";

/** Parser-derived categories only: no regex guesses about symbol identity. */
export const sourceCodeStyle = HighlightStyle.define([
  { tag: tags.keyword, class: "source-code-keyword" },
  { tag: tags.controlKeyword, class: "source-code-control" },
  { tag: tags.definitionKeyword, class: "source-code-definition" },
  { tag: tags.modifier, class: "source-code-modifier" },
  { tag: tags.typeName, class: "source-code-type" },
  { tag: tags.className, class: "source-code-type" },
  { tag: tags.function(tags.variableName), class: "source-code-function" },
  { tag: tags.function(tags.definition(tags.variableName)), class: "source-code-function source-code-function-definition" },
  { tag: tags.function(tags.propertyName), class: "source-code-function" },
  { tag: tags.definition(tags.variableName), class: "source-code-name-definition" },
  { tag: tags.definition(tags.typeName), class: "source-code-type source-code-name-definition" },
  { tag: tags.constant(tags.variableName), class: "source-code-constant" },
  { tag: tags.propertyName, class: "source-code-member" },
  { tag: tags.attributeName, class: "source-code-member" },
  { tag: tags.macroName, class: "source-code-macro" },
  { tag: tags.namespace, class: "source-code-type" },
  { tag: tags.special(tags.name), class: "source-code-macro" },
  { tag: [tags.meta, tags.processingInstruction], class: "source-code-preprocessor" },
  { tag: [tags.string, tags.character, tags.docString], class: "source-code-string" },
  { tag: tags.escape, class: "source-code-escape" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.literal, tags.regexp], class: "source-code-value" },
  { tag: tags.labelName, class: "source-code-label" },
  { tag: [tags.comment, tags.docComment], class: "source-code-comment" },
  { tag: tags.operator, class: "source-code-operator" },
]);
export const sourceCodeHighlighting = syntaxHighlighting(sourceCodeStyle);

/** The upstream parser tags macro invocations but not the name in #define. */
export function sourceCodeSupport(
  support: LanguageSupport,
  cFamily = false,
): LanguageSupport {
  const language = cFamily && support.language instanceof LRLanguage
    ? support.language.configure({ props: [
      styleTags({ "PreprocDirective/Identifier": tags.special(tags.name) }),
      foldNodeProp.add({ CompoundStatement: (node, state) => {
        const range = foldInside(node);
        if (!range) return null;
        const closingLine = state.doc.lineAt(range.to);
        // Keep a following branch on its own visual line, with its own gutter
        // control. Otherwise folding the first branch merges both controls.
        if (/^}\s*(?:else|catch)\b/.test(state.doc.sliceString(range.to, closingLine.to))
          && /^\s*$/.test(state.doc.sliceString(closingLine.from, range.to))
          && closingLine.from > range.from) {
          return { from: range.from, to: closingLine.from - 1 };
        }
        return range;
      } }),
    ] })
    : support.language;
  return new LanguageSupport(language, [
    support.support,
    sourceCodeHighlighting,
    // Bundled parsers vary in which closing delimiters trigger reindentation.
    // Use the active language's indentation service for all three closers.
    EditorState.languageData.of(() => [{ indentOnInput: /^\s*(?:\)|\])$/ }]),
  ]);
}

/** Kept as a named helper for C-family callers and tests. */
export const cSourceSupport = (support: LanguageSupport) => sourceCodeSupport(support, true);

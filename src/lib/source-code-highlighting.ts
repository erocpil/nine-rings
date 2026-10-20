import { HighlightStyle, syntaxHighlighting, LanguageSupport, LRLanguage } from "@codemirror/language";
import { styleTags, tags } from "@lezer/highlight";

/** Parser-derived categories only: no regex guesses about symbol identity. */
export const sourceCodeStyle = HighlightStyle.define([
  { tag: tags.keyword, class: "source-code-keyword" },
  { tag: tags.controlKeyword, class: "source-code-control" },
  { tag: tags.definitionKeyword, class: "source-code-definition" },
  { tag: tags.modifier, class: "source-code-modifier" },
  { tag: tags.typeName, class: "source-code-type" },
  { tag: tags.function(tags.variableName), class: "source-code-function" },
  { tag: tags.function(tags.definition(tags.variableName)), class: "source-code-function source-code-function-definition" },
  { tag: tags.function(tags.propertyName), class: "source-code-function" },
  { tag: tags.propertyName, class: "source-code-member" },
  { tag: tags.namespace, class: "source-code-type" },
  { tag: tags.special(tags.name), class: "source-code-macro" },
  { tag: [tags.meta, tags.processingInstruction], class: "source-code-preprocessor" },
  { tag: [tags.string, tags.character], class: "source-code-string" },
  { tag: tags.escape, class: "source-code-escape" },
  { tag: [tags.number, tags.bool, tags.null], class: "source-code-value" },
  { tag: tags.comment, class: "source-code-comment" },
  { tag: tags.operator, class: "source-code-operator" },
]);
export const sourceCodeHighlighting = syntaxHighlighting(sourceCodeStyle);

/** The upstream parser tags macro invocations but not the name in #define. */
export function cSourceSupport(support: LanguageSupport): LanguageSupport {
  const language = support.language instanceof LRLanguage
    ? support.language.configure({ props: [styleTags({ "PreprocDirective/Identifier": tags.special(tags.name) })] })
    : support.language;
  return new LanguageSupport(language, [support.support, sourceCodeHighlighting]);
}

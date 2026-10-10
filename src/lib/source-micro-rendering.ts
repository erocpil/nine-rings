import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { styleTags, Tag, tags } from "@lezer/highlight";

// Derived tags retain ordinary delimiter highlighting when enhancement is off.
const listMark = Tag.define(tags.processingInstruction);
const quoteMark = Tag.define(tags.processingInstruction);
const codeMark = Tag.define(tags.processingInstruction);
const taskMark = Tag.define(tags.processingInstruction);
export const sourceMicroSyntax = {
  // A parent context takes precedence over Markdown's existing generic rule.
  props: [
    styleTags({
      "*/ListMark": listMark,
      "*/QuoteMark": quoteMark,
      "*/CodeMark": codeMark,
      "*/TaskMarker": taskMark,
    }),
  ],
};
export const sourceMicroStyle = HighlightStyle.define(
  [
    ...[
      tags.heading1,
      tags.heading2,
      tags.heading3,
      tags.heading4,
      tags.heading5,
      tags.heading6,
    ].map((tag, index) => ({
      tag,
      class: `source-micro-h${index + 1}`,
    })),
    { tag: [tags.link, tags.url], class: "source-micro-link" },
    { tag: listMark, class: "source-micro-marker source-micro-list" },
    { tag: quoteMark, class: "source-micro-marker source-micro-quote-mark" },
    { tag: codeMark, class: "source-micro-marker source-micro-code-mark" },
    { tag: taskMark, class: "source-micro-marker source-micro-task" },
    { tag: tags.monospace, class: "source-micro-code" },
    { tag: tags.quote, class: "source-micro-quote" },
    { tag: tags.strong, class: "source-micro-strong" },
    { tag: tags.emphasis, class: "source-micro-emphasis" },
  ],
  { scope: markdownLanguage },
);
export const sourceMicroHighlighting = syntaxHighlighting(sourceMicroStyle);

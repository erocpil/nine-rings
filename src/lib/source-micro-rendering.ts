import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { styleTags, Tag, tags } from "@lezer/highlight";

// Derived tags retain ordinary delimiter highlighting when enhancement is off.
const structureMark = Tag.define(tags.processingInstruction);
export const sourceMicroSyntax = {
  // A parent context takes precedence over Markdown's existing generic rule.
  props: [
    styleTags({
      "*/ListMark */QuoteMark */CodeMark */TaskMarker": structureMark,
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
    { tag: structureMark, class: "source-micro-marker" },
    { tag: tags.monospace, class: "source-micro-code" },
  ],
  { scope: markdownLanguage },
);
export const sourceMicroHighlighting = syntaxHighlighting(sourceMicroStyle);

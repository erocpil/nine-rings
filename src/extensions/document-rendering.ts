import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import Heading from "@tiptap/extension-heading";
import TextStyle from "@tiptap/extension-text-style";
import TableRow from "@tiptap/extension-table-row";
import { DocumentStarterKit } from "./DocumentStarterKit";
import { OrderedListLayout } from "./OrderedListLayout";
import { MarkdownTaskState } from "./MarkdownTaskState";
import { FootnoteNumbering } from "./FootnoteNumbering";
import { AutomaticTOC } from "./AutomaticTOC";
import { MathInline, MathBlock, InlineHighlight, FootnoteReference, HTMLDetails, FootnoteDefinition, Footnotes, HTMLStyle, HTMLAnchor, RawHTML, RawHTMLInline } from "./MarkdownExtras";
import { ThemeAwareColor } from "./ThemeAwareColor";
import { FontSize } from "./FontSize";
import { MarkdownImage, ResizableImage } from "./ResizableImage";
import { DocumentLink } from "./DocumentLink";
import { ContentSizedTable, AlignedTableCell, AlignedTableHeader } from "./ContentSizedTable";
import { CodeBlockLineNumbers } from "./CodeBlockLineNumbers";
import { CollapsibleBlockquote, blockquoteFoldTransactionMeta } from "./CollapsibleBlockquote";
import { BlockIndent } from "./BlockIndent";
import { StandaloneStrongLabel } from "./StandaloneStrongLabel";

/** The document schema and NodeViews are independent of storage and editability.
 * Both file and database adapters use this definition; session/persistence,
 * navigation and editing commands are attached separately by their owners. */
export function documentRenderingExtensions({ lineNumbers = false, defaultWrap = true } = {}) {
  return [
    DocumentStarterKit.configure({ heading: false, codeBlock: false, blockquote: false }),
    Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }).extend({ addInputRules: () => [] }),
    OrderedListLayout, MarkdownTaskState, FootnoteNumbering, AutomaticTOC,
    MathInline, MathBlock, InlineHighlight, FootnoteReference, HTMLDetails, FootnoteDefinition, Footnotes, HTMLStyle, HTMLAnchor, RawHTML, RawHTMLInline,
    TextStyle, ThemeAwareColor.configure({ types: ["textStyle"] }), FontSize,
    MarkdownImage, ResizableImage.configure({ inline: false, allowBase64: true }),
    DocumentLink.configure({ openOnClick: true, protocols: ["nr-note"] }),
    ContentSizedTable.configure({ resizable: true, handleWidth: 8, cellMinWidth: 48, lastColumnResizable: true, allowTableNodeSelection: true }),
    TableRow, AlignedTableHeader, AlignedTableCell,
    CodeBlockLineNumbers.configure({ lineNumbersEnabled: lineNumbers, defaultWrap }),
    CollapsibleBlockquote, BlockIndent, StandaloneStrongLabel,
  ];
}

/** Read-only is enforced at the transaction boundary, including native paste.
 * Reading-only quote folding cannot change the source text. */
export function readonlyDocumentGuard(isReadonly: () => boolean) {
  return Extension.create({
    name: "readonlyDocumentGuard",
    addProseMirrorPlugins: () => [new Plugin({
      filterTransaction: transaction => !isReadonly() || !transaction.docChanged || transaction.getMeta(blockquoteFoldTransactionMeta) === true,
      props: {
        handleDOMEvents: {
          paste: (_view, event) => { if (!isReadonly()) return false; event.preventDefault(); return true; },
          drop: (_view, event) => { if (!isReadonly()) return false; event.preventDefault(); return true; },
        },
      },
    })],
  });
}

import type { Editor } from "@tiptap/core";
import { preserveReadingPositions } from "./reading-position";

/** Word at the caret; whitespace/empty paragraphs affect subsequent typing only. */
export function caretWordRange(text: string, offset: number): { from: number; to: number } | null {
  type Segment = { index: number; segment: string; isWordLike?: boolean };
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: undefined, options: { granularity: "word" }) => { segment: (text: string) => Iterable<Segment> } }).Segmenter;
  const segments = Segmenter ? [...new Segmenter(undefined, { granularity: "word" }).segment(text)]
    : [...text.matchAll(/[\p{L}\p{N}_]+/gu)].map(match => ({ index: match.index!, segment: match[0], isWordLike: true }));
  const match = segments.find(part => part.isWordLike && part.index <= offset && offset < part.index + part.segment.length)
    ?? (offset === text.length ? segments.find(part => part.isWordLike && part.index + part.segment.length === offset) : undefined);
  return match ? { from: match.index, to: match.index + match.segment.length } : null;
}

export function applyToolbarColor(editor: Editor, kind: "text" | "background", color: string | null) {
  if (!editor.isEditable) return;
  const selection = editor.state.selection;
  const { $from } = selection;
  const mark = kind === "text" ? "textStyle" : "inlineHighlight";
  if (selection.empty && !$from.parent.type.allowsMarkType(editor.schema.marks[mark])) return;
  const range = selection.empty && $from.parent.isTextblock
    ? caretWordRange($from.parent.textBetween(0, $from.parent.content.size, "", "\ufffc"), $from.parentOffset) : null;
  preserveReadingPositions(() => {
    let chain = editor.chain().focus(undefined, { scrollIntoView: false });
    if (range) chain = chain.setTextSelection({ from: $from.start() + range.from, to: $from.start() + range.to });
    const apply = () => {
      if (kind === "text") chain = color ? chain.setColor(color) : chain.unsetColor();
      else chain = color ? chain.setMark("inlineHighlight", { backgroundColor: color }) : chain.unsetMark("inlineHighlight");
    };
    apply();
    if (range) {
      chain = chain.command(({ tr }) => { tr.setSelection(selection.map(tr.doc, tr.mapping)); return true; });
      apply();
    }
    chain.run();
  });
}

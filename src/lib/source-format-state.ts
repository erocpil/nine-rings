import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export type SourceInlineFormat = "bold" | "italic" | "strike" | "code";
const inlineNodes: Record<SourceInlineFormat, string> = { bold: "StrongEmphasis", italic: "Emphasis", strike: "Strikethrough", code: "InlineCode" };
const blockNodes: Record<string, string> = { quote: "Blockquote", bullet: "BulletList", ordered: "OrderedList", todo: "Task", codeblock: "FencedCode", paragraph: "Paragraph", link: "Link", table: "Table", rule: "HorizontalRule" };
export type SourceFormats = Record<SourceInlineFormat | "quote" | "bullet" | "ordered" | "todo" | "codeblock" | "paragraph" | "link" | "table" | "rule" | `h${1 | 2 | 3 | 4 | 5 | 6}`, boolean>;
export const emptySourceFormats = (): SourceFormats => Object.fromEntries([
  ...Object.keys(inlineNodes), ...Object.keys(blockNodes), ...Array.from({ length: 6 }, (_, i) => `h${i + 1}`),
].map(key => [key, false])) as SourceFormats;

function currentTree(state: EditorState) {
  // Bound foreground work for long files; parser background updates retry this
  // projection when more syntax becomes available, without requiring a click.
  return ensureSyntaxTree(state, state.selection.main.to, 5) ?? syntaxTree(state);
}
function markers(node: SyntaxNode) {
  const first = node.firstChild, last = node.lastChild;
  return first && last && first !== last && /^(EmphasisMark|StrikethroughMark|CodeMark)$/.test(first.name)
    && first.name === last.name ? { first, last } : null;
}
export function sourceInlineNode(state: EditorState, kind: SourceInlineFormat): SyntaxNode | null {
  const range = state.selection.main;
  let result: SyntaxNode | null = null;
  currentTree(state).iterate({ from: range.from, to: range.to, enter(ref) {
    if (ref.name !== inlineNodes[kind]) return;
    const node = ref.node, marks = markers(node);
    if (!marks) return;
    const contains = range.empty ? range.head >= marks.first.to && range.head <= marks.last.from
      : range.from >= node.from && range.to <= node.to;
    if (contains && (!result || node.to - node.from < result.to - result.from)) result = node;
  } });
  return result;
}

/** Syntax, not regex: escaped delimiters, code literals and incomplete markup
 * must never become a checked format. Mixed selections remain unchecked. */
export function sourceFormats(state: EditorState): SourceFormats {
  const formats = emptySourceFormats(), range = state.selection.main, tree = currentTree(state);
  const names = { ...inlineNodes, ...blockNodes, ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`h${i + 1}`, `ATXHeading${i + 1}`])) };
  const spans = new Map<string, { from: number; to: number }[]>();
  tree.iterate({ from: range.from, to: range.to, enter(ref) {
    for (const [kind, name] of Object.entries(names)) {
      if (ref.name !== name && !(kind === "codeblock" && ref.name === "CodeBlock")
        && !(kind === "link" && ref.name === "Autolink")
        && !(kind === "h1" && ref.name === "SetextHeading1") && !(kind === "h2" && ref.name === "SetextHeading2")) continue;
      let from = ref.from, to = ref.to;
      if (range.empty && kind in inlineNodes) {
        const marks = markers(ref.node);
        if (!marks) continue;
        from = marks.first.to; to = marks.last.from;
      }
      if (range.empty) {
        if (range.head >= from && range.head <= to) formats[kind as keyof SourceFormats] = true;
      } else {
        const entries = spans.get(kind) ?? [];
        entries.push({ from, to }); spans.set(kind, entries);
      }
    }
  } });
  if (!range.empty) for (const [kind, intervals] of spans) {
    let covered = range.from;
    for (const span of intervals.sort((a, b) => a.from - b.from)) {
      if (span.to <= covered) continue;
      if (span.from > covered) {
        // Newline separators are not part of block nodes; allow blank gaps for
        // structural formats, while inline text must be entirely marked.
        if (kind in inlineNodes || kind === "link" || state.sliceDoc(covered, span.from).trim()) break;
      }
      covered = Math.max(covered, span.to);
      if (covered >= range.to) break;
    }
    formats[kind as keyof SourceFormats] = covered >= range.to || (!(kind in inlineNodes) && kind !== "link" && covered > range.from && !state.sliceDoc(covered, range.to).trim());
  }
  if (formats.todo) formats.bullet = formats.ordered = false;
  return formats;
}

/** Remove the actual enclosing pair (including alternate/multi-tick markers),
 * retaining the selection and all nested formatting; never serialize the doc. */
export function removeSourceInlineFormat(state: EditorState, kind: SourceInlineFormat): TransactionSpec | null {
  const node = sourceInlineNode(state, kind);
  const marks = node && markers(node);
  if (!marks) return null;
  const range = state.selection.main;
  const changes = state.changes([{ from: marks.first.from, to: marks.first.to }, { from: marks.last.from, to: marks.last.to }]);
  return { changes, selection: { anchor: changes.mapPos(range.anchor), head: changes.mapPos(range.head) }, userEvent: "input", scrollIntoView: true };
}

/** Change selected Markdown lines in place, preserving quote/list prefixes. */
export function sourceHeadingChange(state: EditorState, level: number): TransactionSpec | null {
  if (state.readOnly || !Number.isInteger(level) || level < 0 || level > 6) return null;
  const range = state.selection.main, tree = currentTree(state);
  let code = false;
  const setext: SyntaxNode[] = [], atx: SyntaxNode[] = [];
  tree.iterate({ from: range.from, to: range.to, enter(ref) {
    if (ref.name === "FencedCode" || ref.name === "CodeBlock") code = true;
    if (/^SetextHeading[12]$/.test(ref.name)) setext.push(ref.node);
    if (/^ATXHeading[1-6]$/.test(ref.name)) atx.push(ref.node);
  } });
  if (code) return null;
  const first = state.doc.lineAt(range.from).number;
  const last = state.doc.lineAt(range.empty ? range.to : Math.max(range.from, range.to - 1)).number;
  const changes: { from: number; to: number; insert: string }[] = [];
  const visited = new Set<number>();
  for (let number = first; number <= last; number++) {
    const line = state.doc.line(number);
    const heading = setext.find(node => line.from <= node.to && line.to >= node.from);
    if (heading) {
      if (visited.has(heading.from)) continue;
      visited.add(heading.from);
      const title = state.doc.lineAt(heading.from), underline = state.doc.lineAt(heading.to);
      if (underline.number !== title.number + 1) return null;
      changes.push({ from: heading.from, to: heading.from, insert: level ? "#".repeat(level) + " " : "" });
      changes.push({ from: title.to, to: underline.to, insert: "" });
      continue;
    }
    if (!line.text.trim() && first !== last) continue;
    const prefix = /^\s*(?:(?:>\s*)|(?:(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?))*/.exec(line.text)![0];
    const from = line.from + prefix.length;
    const previous = /^#{1,6}(?:\s+|$)/.exec(line.text.slice(prefix.length))?.[0] ?? "";
    changes.push({ from, to: from + previous.length, insert: level ? "#".repeat(level) + " " : "" });
    if (!level) {
      const closing = atx.find(node => node.from >= line.from && node.from <= line.to)?.lastChild;
      if (closing?.name === "HeaderMark" && closing.from > from + previous.length) {
        let start = closing.from;
        while (start > from + previous.length && /\s/.test(state.sliceDoc(start - 1, start))) start--;
        changes.push({ from: start, to: closing.to, insert: "" });
      }
    }
  }
  const set = state.changes(changes.sort((a, b) => a.from - b.from));
  return { changes: set, selection: { anchor: set.mapPos(range.anchor), head: set.mapPos(range.head) }, userEvent: "input", scrollIntoView: true };
}

import {
  countColumn,
  type EditorState,
  type ChangeSpec,
  type TransactionSpec,
} from "@codemirror/state";
import { ensureSyntaxTree, language } from "@codemirror/language";
import { isolateHistory } from "@codemirror/commands";

export type SourceIndentStyle = "tabs" | "spaces";

/** Convert only line-leading whitespace, retaining its visual columns. Literal
 * lines inside multiline strings/comments are data, not editor indentation. */
export function sourceIndentationChange(
  state: EditorState,
  size: number,
  style: SourceIndentStyle,
): TransactionSpec | null {
  if (state.readOnly || ![2, 4, 8].includes(size)) return null;
  const activeLanguage = state.facet(language);
  const tree = activeLanguage
    ? ensureSyntaxTree(state, state.doc.length, 200)
    : null;
  if (activeLanguage && !tree)
    throw Error("源码仍在解析，请稍后重试缩进转换。");
  const changes: ChangeSpec[] = [];
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number);
    const prefix = /^[\t ]+/.exec(line.text)?.[0];
    if (!prefix) continue;
    let literal = false;
    for (
      let node = tree?.resolveInner(line.from + prefix.length, 1);
      node;
      node = node.parent!
    ) {
      if (node.from < line.from && /string|comment|heredoc/i.test(node.name)) {
        literal = true;
        break;
      }
    }
    if (literal) continue;
    const width = countColumn(prefix, size);
    const replacement =
      style === "spaces"
        ? " ".repeat(width)
        : "\t".repeat(Math.floor(width / size)) + " ".repeat(width % size);
    if (replacement !== prefix)
      changes.push({
        from: line.from,
        to: line.from + prefix.length,
        insert: replacement,
      });
  }
  return changes.length
    ? {
        changes,
        userEvent: "input.indent",
        annotations: isolateHistory.of("full"),
      }
    : null;
}

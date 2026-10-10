import { EditorState, type TransactionSpec } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";

export type SourceLineFormat = "quote" | "bullet" | "ordered" | "task";
const prefixes = {
  quote: /^>\s?/,
  bullet: /^[-+*]\s+/,
  ordered: /^\d+[.)]\s+/,
  task: /^[-+*]\s+\[[ xX]\]\s*/,
};

/** Map line prefixes without replacing their contents or touching adjacent lines. */
export function formatSourceLines(
  state: EditorState,
  format: SourceLineFormat,
): TransactionSpec | null {
  if (state.readOnly) return null;
  const numbers = new Set<number>();
  for (const range of state.selection.ranges) {
    const start = state.doc.lineAt(range.from).number;
    const end = state.doc.lineAt(
      range.empty ? range.to : Math.max(range.from, range.to - 1),
    ).number;
    for (let i = start; i <= end; i++) numbers.add(i);
  }
  const lines = [...numbers]
    .sort((a, b) => a - b)
    .map((number) => state.doc.line(number));
  const selected = lines.filter(
    (line) => lines.length === 1 || line.text.trim(),
  );
  const remove = selected.every((line) => {
    const text = line.text.trimStart();
    return (
      prefixes[format].test(text) &&
      (format !== "bullet" || !prefixes.task.test(text))
    );
  });
  const changes = selected.map((line, index) => {
    const indent = /^\s*/.exec(line.text)![0].length;
    const text = line.text.slice(indent);
    const previous =
      (remove
        ? prefixes[format]
        : format === "quote"
          ? /^>\s?/
          : /^(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/
      ).exec(text)?.[0] ?? "";
    const insert = remove
      ? ""
      : format === "quote"
        ? "> "
        : format === "bullet"
          ? "- "
          : format === "ordered"
            ? `${index + 1}. `
            : "- [ ] ";
    return {
      from: line.from + indent,
      to: line.from + indent + previous.length,
      insert,
    };
  });
  if (!changes.length) return null;
  return {
    changes,
    annotations: isolateHistory.of("full"),
    userEvent: "input.format",
    scrollIntoView: true,
  };
}

export function insertSourceBlock(
  state: EditorState,
  kind: "code" | "table" | "rule",
): TransactionSpec | null {
  if (state.readOnly) return null;
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to);
  // A selected backtick fence must never close the surrounding new fence.
  let longest = 2;
  if (kind === "code")
    for (const match of selected.matchAll(/`+/g))
      longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(longest + 1);
  let body =
    kind === "code"
      ? `${fence}\n${selected}\n${fence}`
      : kind === "table"
        ? "| 标题 | 内容 |\n| --- | --- |\n|  |  |"
        : "---";
  if (kind !== "code" && selected) body += "\n\n" + selected;
  const before =
    range.from > 0
      ? state.sliceDoc(Math.max(0, range.from - 2), range.from).endsWith("\n\n")
        ? ""
        : state.sliceDoc(range.from - 1, range.from) === "\n"
          ? "\n"
          : "\n\n"
      : "";
  const after =
    range.to < state.doc.length
      ? state
          .sliceDoc(range.to, Math.min(state.doc.length, range.to + 2))
          .startsWith("\n\n")
        ? ""
        : state.sliceDoc(range.to, range.to + 1) === "\n"
          ? "\n"
          : "\n\n"
      : "\n";
  const anchor =
    range.from +
    before.length +
    (kind === "code" ? fence.length + 1 : kind === "table" ? 2 : body.length);
  return {
    changes: { from: range.from, to: range.to, insert: before + body + after },
    selection: {
      anchor,
      head: kind === "code" ? anchor + selected.length : anchor,
    },
    annotations: isolateHistory.of("full"),
    userEvent: "input.block",
    scrollIntoView: true,
  };
}

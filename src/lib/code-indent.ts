/** Indent selected code lines; a collapsed caret inserts a literal tab. */
export function codeIndentChanges(text: string, from: number, to: number, outdent: boolean, tabSize = 4) {
  if (!outdent && from === to) return [{ from, to, insert: "\t" }];
  const changes: { from: number; to: number; insert: string }[] = [];
  let start = from === 0 ? 0 : text.lastIndexOf("\n", from - 1) + 1;
  const last = to > from && text[to - 1] === "\n" ? to - 1 : to;
  while (start <= last) {
    if (!outdent) changes.push({ from: start, to: start, insert: "\t" });
    else {
      const prefix = text.slice(start).match(/^(?:\t| +)/)?.[0] ?? "";
      const length = prefix.startsWith("\t") ? 1 : Math.min(tabSize, prefix.length);
      if (length) changes.push({ from: start, to: start + length, insert: "" });
    }
    const next = text.indexOf("\n", start);
    if (next < 0) break;
    start = next + 1;
  }
  return changes;
}

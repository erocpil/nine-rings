/** A document-level YAML mapping, kept as source without interpreting its values. */
export function markdownFrontMatter(source: string): string | undefined {
  const opening = /^(?:\uFEFF)?---[ \t]*(?:\r\n|\n|\r)/.exec(source);
  if (!opening) return;
  const end = /(?:^|[\r\n])(?:---|\.\.\.)[ \t]*(?=[\r\n]|$)/g;
  end.lastIndex = opening[0].length - 1;
  const closing = end.exec(source);
  if (!closing) return;
  const header = source.slice(opening[0].length, closing.index);
  // Keep an ordinary divider followed by a Setext heading as Markdown.
  if (!/^(?:(?:[ \t]*#[^\r\n]*|[ \t]*)\r?\n)*(?:[\p{L}\p{N}_][\p{L}\p{M}\p{N}_ .-]*|"[^"\r\n]+"|'[^'\r\n]+'):(?=[ \t\r\n]|$)/u.test(header.replace(/\r\n?/g, "\n"))) return;
  return source.slice(0, closing.index + closing[0].length);
}

export function withMarkdownFrontMatter(header: unknown, body: string): string {
  if (typeof header !== "string" || markdownFrontMatter(header) !== header) return body;
  return body ? `${header}\n\n${body}` : header;
}

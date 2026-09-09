export type WhitespaceMode = "off" | "all" | "abnormal";
export interface WhitespaceToken { offset: number; kind: "space" | "tab" | "newline" }

/** Pure display analysis. Never transforms the source text. */
export function whitespaceTokens(text: string, mode: WhitespaceMode): WhitespaceToken[] {
  if (mode === "off") return [];
  const result: WhitespaceToken[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const indent = /^[ \t]*/.exec(line)![0];
    const mixed = indent.includes(" ") && indent.includes("\t");
    const trailing = /[ \t]+$/.exec(line)?.index ?? line.length;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if ((char === " " || char === "\t") && (mode === "all" || index >= trailing || (mixed && index < indent.length))) {
        result.push({ offset: offset + index, kind: char === " " ? "space" : "tab" });
      }
    }
    offset += line.length;
    if (mode === "all" && offset < text.length) result.push({ offset, kind: "newline" });
    offset++;
  }
  return result;
}

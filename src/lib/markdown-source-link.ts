import { markdownAST } from "./gfm-parser";
import { ensureSyntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import type { EditorState } from "@codemirror/state";

/** Resolve a link at the mouse hit, independently of the editor's selection. */
export function markdownSourceLinkAt(
  state: EditorState,
  position: number,
): string | undefined {
  const tree = ensureSyntaxTree(state, position, 30);
  if (!tree) return;
  const read = (from: number, to: number) => state.sliceDoc(from, to);
  const address = (node: { from: number; to: number }) =>
    read(node.from, node.to).replace(/^<(.*)>$/, "$1") || undefined;
  for (
    let node: SyntaxNode | null = tree.resolveInner(position, 1);
    node;
    node = node.parent
  ) {
    if (node.name === "Image") return;
    if (position >= node.to) continue;
    if (node.name === "URL" && node.parent?.name === "Paragraph")
      return address(node);
    if (
      node.name !== "Link" &&
      node.name !== "Autolink" &&
      node.name !== "LinkReference"
    )
      continue;
    const url = node.getChild("URL");
    if (url) return address(url);
    if (node.name !== "Link") return;
    const label = node.getChild("LinkLabel");
    const marks = node.getChildren("LinkMark");
    if (!marks[0] || !marks[1]) return;
    const normalize = (value: string) =>
      value.trim().replace(/\s+/g, " ").toUpperCase();
    const key = normalize(
      (label && read(label.from + 1, label.to - 1)) ||
        read(marks[0].to, marks[1].from),
    );
    // Definitions can be outside the visible viewport, so parse the rest only
    // for a reference hit. Keep the interaction bounded for very large files.
    let result: string | undefined;
    ensureSyntaxTree(state, state.doc.length, 50)?.iterate({
      enter: ({ name, node: reference }) => {
        if (result) return false;
        if (name !== "LinkReference") return;
        const refLabel = reference.getChild("LinkLabel"),
          refURL = reference.getChild("URL");
        if (
          refLabel &&
          refURL &&
          normalize(read(refLabel.from + 1, refLabel.to - 1)) === key
        )
          result = address(refURL);
        return false;
      },
    });
    return result;
  }
}


/** Keep copied source verbatim. Navigation uses the same decoded URL as rendering. */
export function semanticMarkdownSourceHref(sourceHref: string): string {
  const paragraph = markdownAST(`[link](<${sourceHref}>)`).children[0];
  const link = paragraph?.type === "paragraph" ? paragraph.children[0] : undefined;
  return link?.type === "link" ? link.url : sourceHref;
}

import type { Node } from "@tiptap/pm/model";

/** Derived presentation only: no nesting, document rewrite or Markdown changes. */
export function listFollowupBlocks(doc: Node): Set<number> {
  const positions = new Set<number>();
  let followsList = false;
  doc.forEach((node, pos) => {
    if (node.type.name === "bulletList" || node.type.name === "orderedList") {
      followsList = true;
    } else if (
      followsList &&
      (node.type.name === "codeBlock" || node.type.name === "blockquote")
    ) {
      positions.add(pos);
    } else {
      followsList = false;
    }
  });
  return positions;
}

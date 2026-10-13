import {
  DOMSerializer,
  Fragment,
  type Node,
  type Schema,
} from "@tiptap/pm/model";
import { extractDocumentOutline } from "./document-outline";
import { outlineLabel, tocLevels } from "./heading-links";
export function tocClipboardEntries(doc: Node, source: string) {
  const levels = tocLevels(source);
  return extractDocumentOutline(doc)
    .filter((item) => levels.includes(item.level))
    .map((item) => ({ ...item, text: outlineLabel(item.text) }));
}
/** Visible text plus an invisible typed attribute, so internal paste retains a dynamic block. */
export function tocClipboardSerializer(schema: Schema, document: () => Node) {
  const base = DOMSerializer.fromSchema(schema);
  return new DOMSerializer(
    {
      ...base.nodes,
      codeBlock: (node) =>
        node.attrs.language === "toc"
          ? [
              "div",
              {
                "data-nr-toc": `levels: ${tocLevels(node.textContent).join(",")}`,
              },
              ["strong", "目录"],
              [
                "ol",
                ...tocClipboardEntries(document(), node.textContent).map(
                  (item) => ["li", item.text] as [string, string],
                ),
              ],
            ]
          : base.nodes.codeBlock(node),
    },
    base.marks,
  );
}
export function tocPlainFragment(fragment: Fragment, doc?: Node): Fragment {
  const nodes: Node[] = [];
  fragment.forEach((node) => {
    if (node.type.name === "codeBlock" && node.attrs.language === "toc") {
      const text = doc
        ? tocClipboardEntries(doc, node.textContent)
            .map((item) => item.text)
            .join("\n")
        : "目录";
      nodes.push(
        node.type.schema.nodes.paragraph.create(
          null,
          text ? node.type.schema.text(text) : undefined,
        ),
      );
    } else
      nodes.push(
        node.isLeaf ? node : node.copy(tocPlainFragment(node.content, doc)),
      );
  });
  return Fragment.fromArray(nodes);
}

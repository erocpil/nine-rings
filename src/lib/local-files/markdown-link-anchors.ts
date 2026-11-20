import type { Nodes } from "mdast";
import { markdownAST } from "../gfm-parser";
import { headingLinkMap } from "../heading-links";
import { fromHtml } from "hast-util-from-html";
import type { DocumentOutlineItem } from "../document-outline";

function headingText(node: Nodes): string {
  if (node.type === "image" || node.type === "imageReference") return "";
  if ("value" in node) return node.type === "html" ? "" : node.value;
  return "children" in node ? node.children.map(headingText).join("") : "";
}

/** Use source positions from the Markdown AST; rendered views use PM positions. */
export function markdownAnchorOffsets(source: string): Map<string, number> {
  const headings: DocumentOutlineItem[] = [];
  const anchors = new Map<string, number>();
  const visit = (node: Nodes) => {
    const offset = node.position?.start.offset;
    if (node.type === "heading" && offset !== undefined) {
      headings.push({ text: headingText(node).trim(), level: node.depth, pos: offset });
    }
    if (node.type === "html" && offset !== undefined && /<a\b/i.test(node.value)) {
      const collect = (child: ReturnType<typeof fromHtml>["children"][number]) => {
        if (child.type !== "element") return;
        const id = child.properties.id ?? child.properties.name;
        if (child.tagName === "a" && !child.properties.href && typeof id === "string" && !anchors.has(id)) {
          anchors.set(id, offset + (child.position?.start.offset ?? 0));
        }
        child.children.forEach(collect);
      };
      fromHtml(node.value, { fragment: true }).children.forEach(collect);
    }
    if ("children" in node) node.children.forEach(visit);
  };
  visit(markdownAST(source));
  for (const [id, heading] of headingLinkMap(headings)) {
    if (!anchors.has(id)) anchors.set(id, heading.pos);
  }
  return anchors;
}

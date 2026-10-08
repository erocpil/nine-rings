import type { Node as PMNode } from "@tiptap/pm/model";

export const FLOW_BLOCK_TEMPLATE =
  "## 明确问题\n\n*目的：说明为什么要做。*\n\n- 记录输入与约束\n- 确定完成标准\n\n## 执行与验证\n\n描述操作、条件分支和输出。";
export type FlowPart =
  | { kind: "text"; nodes: PMNode[] }
  | { kind: "stages"; stages: { heading: PMNode; body: PMNode[] }[] };

/** H2 is the conventional stage level; otherwise use the shallowest heading. */
export function flowParts(doc: PMNode): FlowPart[] {
  const nodes: PMNode[] = [];
  doc.forEach((node) => nodes.push(node));
  const levels = nodes
    .filter((node) => node.type.name === "heading")
    .map((node) => Number(node.attrs.level));
  const level = levels.includes(2) ? 2 : Math.min(...levels);
  const parts: FlowPart[] = [];
  for (const node of nodes) {
    let part = parts[parts.length - 1];
    if (node.type.name === "heading" && node.attrs.level === level) {
      if (part?.kind !== "stages") {
        part = { kind: "stages", stages: [] };
        parts.push(part);
      }
      part.stages.push({ heading: node, body: [] });
    } else if (
      part?.kind === "stages" &&
      node.type.name !== "footnotes" &&
      !(node.type.name === "heading" && node.attrs.level < level)
    ) {
      part.stages[part.stages.length - 1].body.push(node);
    } else {
      if (part?.kind !== "text") {
        part = { kind: "text", nodes: [] };
        parts.push(part);
      }
      part.nodes.push(node);
    }
  }
  return parts;
}

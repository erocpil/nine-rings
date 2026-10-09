import { DOMSerializer } from "@tiptap/pm/model";
import { parseFlowDocument } from "../components/FlowBlockContent";
import { flowParts } from "./flow-block";

/** Use the same parsed document and stage partition as the on-screen flow block. */
export function renderPrintFlows(root: HTMLElement, depth = 0): void {
  if (depth >= 3) return;
  const owner = root.ownerDocument;
  for (const pre of [
    ...root.querySelectorAll<HTMLPreElement>("pre[data-language]"),
  ].filter(
    (pre) => pre.getAttribute("data-language")?.toLowerCase() === "flow",
  )) {
    const source = pre.textContent ?? "";
    try {
      const doc = parseFlowDocument(source);
      const serializer = DOMSerializer.fromSchema(doc.type.schema);
      const container = owner.createElement("div");
      container.className = "print-flow";
      let number = 0;
      for (const part of flowParts(doc)) {
        if (part.kind === "text") {
          for (const node of part.nodes)
            container.append(
              serializer.serializeNode(node, { document: owner }),
            );
          continue;
        }
        const track = owner.createElement("div");
        track.className = "print-flow-stages";
        for (const stage of part.stages) {
          const step = owner.createElement("section");
          step.className = "print-flow-step";
          const badge = owner.createElement("span");
          badge.className = "print-flow-number";
          badge.textContent = String(++number);
          step.append(
            badge,
            serializer.serializeNode(stage.heading, { document: owner }),
          );
          for (const node of stage.body)
            step.append(serializer.serializeNode(node, { document: owner }));
          track.append(step);
        }
        container.append(track);
      }
      renderPrintFlows(container, depth + 1);
      pre.replaceWith(container);
    } catch {
      // Keep the complete source visible if a future/invalid block cannot be rendered.
    }
  }
}

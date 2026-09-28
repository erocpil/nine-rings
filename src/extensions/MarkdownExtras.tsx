import { useEffect, useState } from "react";
import { Mark, Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";

export function KaTeXFormula({ source, displayMode = false }: { source: string; displayMode?: boolean }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    let alive = true;
    void Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([katex]) => {
      if (!alive) return;
      try { setHtml(katex.default.renderToString(source, { displayMode, throwOnError: false, trust: false, strict: "ignore" })); }
      catch { setHtml(""); }
    });
    return () => { alive = false; };
  }, [source, displayMode]);
  return <span className={`nr-math ${displayMode ? "mathBlock" : "mathInline"}`}>
    {html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <code>{source}</code>}
  </span>;
}

function MathView({ node }: NodeViewProps) {
  return <NodeViewWrapper as={node.type.name === "mathBlock" ? "div" : "span"} contentEditable={false}>
    <KaTeXFormula source={String(node.attrs.source ?? "")} displayMode={node.type.name === "mathBlock"} />
  </NodeViewWrapper>;
}

export const MathInline = Node.create({
  name: "mathInline", group: "inline", inline: true, atom: true, selectable: true,
  addAttributes: () => ({ source: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-nr-math]", getAttrs: el => ({ source: (el as HTMLElement).getAttribute("data-source") ?? "" }) }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-nr-math": "inline" })],
  addNodeView: () => ReactNodeViewRenderer(MathView),
});

export const MathBlock = Node.create({
  name: "mathBlock", group: "block", atom: true, selectable: true,
  addAttributes: () => ({ source: { default: "" } }),
  parseHTML: () => [{ tag: "div[data-nr-math=block]", getAttrs: el => ({ source: (el as HTMLElement).getAttribute("data-source") ?? "" }) }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-nr-math": "block" })],
  addNodeView: () => ReactNodeViewRenderer(MathView),
});

export const InlineHighlight = Mark.create({
  name: "inlineHighlight", parseHTML: () => [{ tag: "mark" }],
  renderHTML: ({ HTMLAttributes }) => ["mark", HTMLAttributes, 0],
});

export const FootnoteReference = Mark.create({
  name: "footnoteReference", inclusive: false,
  addAttributes: () => ({ id: { default: "" } }),
  parseHTML: () => [{ tag: "sup[data-footnote-ref]", getAttrs: el => ({ id: (el as HTMLElement).getAttribute("data-footnote-ref") ?? "" }) }],
  renderHTML: ({ mark, HTMLAttributes }) => {
    const id = encodeURIComponent(String(mark.attrs.id ?? ""));
    return ["sup", mergeAttributes(HTMLAttributes, { "data-footnote-ref": mark.attrs.id }), ["a", { href: `#nr-footnote-${id}`, id: `nr-footnote-ref-${id}` }, 0]];
  },
});

export const HTMLDetails = Node.create({
  name: "htmlDetails", group: "block", content: "block+", defining: true,
  addAttributes: () => ({ summary: { default: "点击展开" }, open: { default: false, parseHTML: el => (el as HTMLElement).hasAttribute("open") } }),
  parseHTML: () => [{ tag: "details", getAttrs: el => {
    const element = el as HTMLElement;
    const summary = element.querySelector("summary")?.textContent?.trim() || "点击展开";
    return { summary, open: element.hasAttribute("open") };
  } }],
  // ProseMirror requires a content hole (0) to be the only child of its
  // immediate parent. Keep the fixed summary beside a wrapper that contains
  // the editable body, so serializing this node cannot crash editor creation.
  renderHTML: ({ node, HTMLAttributes }) => ["details", mergeAttributes(HTMLAttributes, node.attrs.open ? { open: "" } : {}), ["summary", {}, node.attrs.summary], ["div", { "data-details-content": "" }, 0]],
});

export const FootnoteDefinition = Node.create({
  name: "footnoteDefinition", content: "block+", defining: true,
  addAttributes: () => ({ id: { default: "" } }),
  parseHTML: () => [{ tag: "li[data-footnote-id]", getAttrs: el => ({ id: (el as HTMLElement).getAttribute("data-footnote-id") ?? "" }) }],
  renderHTML: ({ node, HTMLAttributes }) => ["li", mergeAttributes(HTMLAttributes, { "data-footnote-id": node.attrs.id }), 0],
});

export const Footnotes = Node.create({
  name: "footnotes", group: "block", content: "footnoteDefinition+", defining: true,
  parseHTML: () => [{ tag: "section[data-footnotes]" }],
  renderHTML: ({ HTMLAttributes }) => ["section", mergeAttributes(HTMLAttributes, { "data-footnotes": "" }), ["ol", {}, 0]],
});

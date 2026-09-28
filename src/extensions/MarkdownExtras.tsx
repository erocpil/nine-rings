import { useEffect, useState } from "react";
import { Mark, Node, mergeAttributes } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { EditorFoldIcon } from "../components/EditorFoldIcon";
import { ToolbarIcon } from "../components/ToolbarIcon";
import { openBlockWorkspace } from "../lib/block-workspace";
import { copyToClipboard } from "../lib/clipboard";

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
    return ["sup", mergeAttributes(HTMLAttributes, { "data-footnote-ref": mark.attrs.id, class: "nr-footnote-reference" }), ["a", { href: `#nr-footnote-${id}`, id: `nr-footnote-ref-${id}` }, 0]];
  },
});

function DetailsView({ node, editor, getPos }: NodeViewProps) {
  const [copied, setCopied] = useState(false);
  const [readingOpen, setReadingOpen] = useState<boolean | null>(null);
  const open = editor.isEditable ? node.attrs.open === true : readingOpen ?? node.attrs.open === true;
  const workspace = editor.view.dom.getAttribute("aria-label") === "块内容";
  const toggle = () => {
    if (!editor.isEditable) { setReadingOpen(!open); return; }
    const position = getPos();
    if (typeof position !== "number") return;
    const current = editor.state.doc.nodeAt(position);
    if (current?.type.name !== "htmlDetails") return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...current.attrs, open: !current.attrs.open }));
  };
  return <NodeViewWrapper as="details" className="nr-details" open={open || workspace}>
    <summary className="nr-details-summary" contentEditable={false} onClick={event => { event.preventDefault(); toggle(); }}>
      <span className="nr-details-fold-icon"><EditorFoldIcon expanded={open} /></span>
      <span className="nr-details-title">{String(node.attrs.summary ?? "点击展开")}</span>
      <span className="nr-details-actions">
        <button type="button" title={copied ? "已复制" : "复制折叠区块"} aria-label="复制折叠区块"
          onMouseDown={event => event.preventDefault()}
          onClick={event => { event.preventDefault(); event.stopPropagation(); void copyToClipboard(`${String(node.attrs.summary ?? "点击展开")}\n\n${node.textBetween(0, node.content.size, "\n")}`, { reportFailure: true }).then(() => setCopied(true)).catch(() => setCopied(false)); }}><ToolbarIcon name="copy" /></button>
        <button type="button" className="block-workspace-open" title="块模式" aria-label="块模式"
          onMouseDown={event => event.preventDefault()}
          onClick={event => { event.preventDefault(); event.stopPropagation(); openBlockWorkspace(editor, getPos(), event.currentTarget); }}><ToolbarIcon name="expand" /></button>
      </span>
    </summary>
    <NodeViewContent as="div" className="nr-details-content" data-details-content="" />
  </NodeViewWrapper>;
}

export const HTMLDetails = Node.create({
  name: "htmlDetails", group: "block", content: "block+", defining: true,
  addAttributes: () => ({
    summary: { default: "点击展开", renderHTML: () => ({}) },
    open: { default: false, parseHTML: el => (el as HTMLElement).hasAttribute("open"), renderHTML: () => ({}) },
  }),
  parseHTML: () => [{ tag: "details", contentElement: "[data-details-content]", getAttrs: el => {
    const element = el as HTMLElement;
    const summary = element.querySelector("summary")?.textContent?.trim() || "点击展开";
    return { summary, open: element.hasAttribute("open") };
  } }],
  // ProseMirror requires a content hole (0) to be the only child of its
  // immediate parent. Keep the fixed summary beside a wrapper that contains
  // the editable body, so serializing this node cannot crash editor creation.
  renderHTML: ({ node, HTMLAttributes }) => ["details", mergeAttributes(HTMLAttributes, node.attrs.open ? { open: "" } : {}), ["summary", {}, node.attrs.summary], ["div", { "data-details-content": "" }, 0]],
  addNodeView: () => ReactNodeViewRenderer(DetailsView, { className: "nr-details-node" }),
});

export const FootnoteDefinition = Node.create({
  name: "footnoteDefinition", content: "block+", defining: true,
  addAttributes: () => ({ id: { default: "" } }),
  parseHTML: () => [{ tag: "li[data-footnote-id]", contentElement: "[data-footnote-content]", getAttrs: el => ({ id: (el as HTMLElement).getAttribute("data-footnote-id") ?? "" }) }],
  renderHTML: ({ node, HTMLAttributes }) => {
    const id = encodeURIComponent(String(node.attrs.id ?? ""));
    return ["li", mergeAttributes(HTMLAttributes, { "data-footnote-id": node.attrs.id, id: `nr-footnote-${id}`, tabIndex: -1 }),
      ["div", { "data-footnote-content": "" }, 0],
      ["a", { href: `#nr-footnote-ref-${id}`, class: "nr-footnote-backref", "aria-label": "返回脚注引用", contenteditable: "false" }, "↩"]];
  },
});

export const Footnotes = Node.create({
  name: "footnotes", group: "block", content: "footnoteDefinition+", defining: true,
  parseHTML: () => [{ tag: "section[data-footnotes]" }],
  renderHTML: ({ HTMLAttributes }) => ["section", mergeAttributes(HTMLAttributes, { "data-footnotes": "", class: "nr-footnotes" }), ["ol", {}, 0]],
});

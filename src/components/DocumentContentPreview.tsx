import { createElement, useMemo, useState, type ReactNode } from "react";
import type { JSONContent } from "@tiptap/core";
import { deltaToProseMirror } from "../lib/delta-converter";
import "../styles/document-comparison.css";

/** Static, non-editable preview. Never inject HTML or load remote embedded resources. */
function renderNode(node: JSONContent, key: number, depth = 0): ReactNode {
  if (depth > 60) return <span key={key}>（嵌套过深，见源码差异）</span>;
  const attrs = node.attrs ?? {};
  const children = node.content?.map((child, index) => renderNode(child, index, depth + 1));
  if (node.type === "text") {
    let text: ReactNode = node.text;
    for (const mark of node.marks ?? []) {
      switch (mark.type) {
        case "bold": text = <strong>{text}</strong>; break;
        case "italic": text = <em>{text}</em>; break;
        case "strike": text = <s>{text}</s>; break;
        case "underline": text = <u>{text}</u>; break;
        case "code": text = <code>{text}</code>; break;
        case "link": text = <span className="document-preview-link" title={String(mark.attrs?.href ?? "")}>{text}</span>; break;
        case "textStyle": text = <span style={{
          color: typeof mark.attrs?.color === "string" ? mark.attrs.color : undefined,
          fontSize: Number(mark.attrs?.fontSize) > 0 ? Math.min(96, Number(mark.attrs?.fontSize)) : undefined,
        }}>{text}</span>; break;
      }
    }
    return <span key={key}>{text}</span>;
  }
  switch (node.type) {
    case "heading": return createElement(`h${Math.min(6, Math.max(1, Number(attrs.level) || 1))}`, { key }, children);
    case "paragraph": return <p key={key}>{children?.length ? children : <br />}</p>;
    case "bulletList": return <ul key={key}>{children}</ul>;
    case "orderedList": return <ol key={key} start={Number(attrs.start) || 1}>{children}</ol>;
    case "listItem": return <li key={key}>{typeof attrs.taskChecked === "boolean" && <input type="checkbox" checked={attrs.taskChecked} disabled />}{children}</li>;
    case "taskList": return <ul key={key}>{children}</ul>;
    case "taskItem": return <li key={key}><input type="checkbox" checked={attrs.checked === true} disabled />{children}</li>;
    case "blockquote": return <blockquote key={key}>{children}</blockquote>;
    case "codeBlock": return <pre key={key}><code>{children}</code></pre>;
    case "hardBreak": return <br key={key} />;
    case "horizontalRule": return <hr key={key} />;
    case "table": return <div className="document-preview-table" key={key}><table><tbody>{children}</tbody></table></div>;
    case "tableRow": return <tr key={key}>{children}</tr>;
    case "tableHeader": return <th key={key} colSpan={Number(attrs.colspan) || 1} rowSpan={Number(attrs.rowspan) || 1}>{children}</th>;
    case "tableCell": return <td key={key} colSpan={Number(attrs.colspan) || 1} rowSpan={Number(attrs.rowspan) || 1}>{children}</td>;
    case "image": return <span key={key}>[图片：{String(attrs.alt || "预览不加载图片")}]</span>;
    default: return <div key={key}>{children ?? node.text}</div>;
  }
}

export function DocumentContentPreview({ content, encrypted = false }: { content: unknown; encrypted?: boolean }) {
  const [limit, setLimit] = useState(100);
  const blocks = useMemo(() => {
    if (encrypted) return [];
    try { return deltaToProseMirror(content).content; } catch { return null; }
  }, [content, encrypted]);
  if (encrypted) return <p>正文已加密，无法在预览中显示；不会自动解密。</p>;
  if (!blocks) return <p>无法渲染该正文，请查看结构差异。</p>;
  if (!blocks.length) return <p>（空正文）</p>;
  return <div className="document-content-preview">
    {blocks.slice(0, limit).map((node, index) => renderNode(node, index))}
    {blocks.length > limit && <button type="button" className="settings-btn" onClick={() => setLimit(limit + 100)}>继续显示正文（剩余 {blocks.length - limit} 块）</button>}
  </div>;
}

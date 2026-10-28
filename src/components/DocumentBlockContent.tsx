import React from "react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { ReadingBlockState as BlockState } from "../lib/reading-block-session";
import type { SearchMatch } from "../extensions/SearchHighlights";
import type { ReadingAnnotation } from "../lib/reading-annotations";
import { editorForegroundStyle, editorBackgroundStyle } from "../lib/editor-color";
import { cjkSpacedText } from "./CjkSpacedText";
import { codeLineNumbersEnabled, saveBlockWorkspacePreferences } from "../lib/block-display-settings";
import { CODE_LANGUAGE_OPTIONS, normalizeCodeLanguage } from "../lib/code-highlight";
import { codeBlockDisplay, structuredBlockSymbol } from "../lib/structured-block-display";
import { listStyle } from "../extensions/OrderedListLayout";
import { KaTeXFormula } from "../extensions/MarkdownExtras";
import { isRelativeMarkdownLink } from "../lib/relative-document-link";
import { internalNoteId } from "../lib/internal-note-link";
import { copyToClipboard } from "../lib/clipboard";
import { ReadonlyImage } from "./ReadonlyImage";
import { BlockquoteToolbar } from "./BlockquoteToolbar";
import { EditorFoldIcon } from "./EditorFoldIcon";
import { ToolbarIcon } from "./ToolbarIcon";
import { TableOfContentsBlock } from "./TableOfContentsBlock";
import { DeferredFlowBlock } from "./DeferredFlowBlock";
import { DeferredMermaidDiagram } from "./DeferredMermaidDiagram";

/** Static strategy for windowed and source-preview projections. No database
 * shell or file service is imported by the reusable block renderer. */
function readonlyLink(href: string, title: string | undefined, content: React.ReactNode) {
  if (/^(https?:|mailto:|tel:)/i.test(href)) return <a href={href} title={title} target="_blank" rel="noopener noreferrer">{content}</a>;
  if (href.startsWith("#") || isRelativeMarkdownLink(href) || internalNoteId(href)) return <a href={href} title={title}>{content}</a>;
  return content;
}

export function renderReadonlyBlock(
  node: PMNode,
  pos: number,
  states: Map<number, BlockState>,
  update: (pos: number, value: BlockState) => void,
  match: SearchMatch | undefined,
  defaultWrap: boolean,
  followsList = false,
  spaceText = true,
  previousText = "",
  annotations: readonly ReadingAnnotation[] = [],
): React.ReactNode {
  if (node.isText) {
    const text = node.text ?? "";
    const spaced = (part: string, previous = "") => spaceText && !node.marks.some(mark => mark.type.name === "code")
      ? cjkSpacedText(part, previous) : part;
    const start = Math.max(0, (match?.from ?? Infinity) - pos);
    const end = Math.min(text.length, (match?.to ?? -1) - pos);
    const boundaries = new Set([0, text.length]);
    if (start < end) { boundaries.add(start); boundaries.add(end); }
    const overlapping = annotations.filter(item => item.from < pos + text.length && item.to > pos);
    for (const item of overlapping) {
      boundaries.add(Math.max(0, item.from - pos));
      boundaries.add(Math.min(text.length, item.to - pos));
    }
    const points = [...boundaries].sort((a, b) => a - b);
    let rendered: React.ReactNode = <>{points.slice(0, -1).map((from, index) => {
      const to = points[index + 1];
      if (to <= from) return null;
      const activeSearch = from >= start && to <= end;
      const activeAnnotations = overlapping.filter(item => item.from <= pos + from && item.to >= pos + to);
      let segment: React.ReactNode = spaced(text.slice(from, to), from ? text[from - 1] : previousText);
      if (activeSearch) segment = <mark className="search-match search-match-active">{segment}</mark>;
      for (const annotation of activeAnnotations) {
        segment = <mark className="reading-annotation-highlight" data-reading-annotation={annotation.id}>{segment}</mark>;
      }
      return <span key={from} data-reading-text-start={pos + from} data-reading-text-end={pos + to}>{segment}</span>;
    })}</>;
    for (const mark of node.marks) {
      switch (mark.type.name) {
        case "bold":
          rendered = <strong>{rendered}</strong>;
          break;
        case "italic":
          rendered = <em>{rendered}</em>;
          break;
        case "strike":
          rendered = <s>{rendered}</s>;
          break;
        case "code":
          rendered = <code>{rendered}</code>;
          break;
        case "textStyle":
          rendered = (
            <span
              style={{
                color: editorForegroundStyle(mark.attrs?.color),
                fontSize: mark.attrs.fontSize
                  ? `${Number(mark.attrs.fontSize)}px`
                  : undefined,
              }}
            >
              {rendered}
            </span>
          );
          break;
        case "link": {
          const href = String(mark.attrs.href ?? "");
          rendered = readonlyLink(href, mark.attrs.title ?? undefined, rendered);
          break;
        }
        case "htmlStyle":
          rendered = React.createElement(["sub", "sup", "ins"].includes(mark.attrs.tag) ? mark.attrs.tag : "ins", null, rendered);
          break;
        case "inlineHighlight":
          rendered = <mark style={{ backgroundColor: editorBackgroundStyle(mark.attrs.backgroundColor) }}>{rendered}</mark>;
          break;
        case "footnoteReference": {
          const id = String(mark.attrs.id ?? "");
          const occurrence = Number(mark.attrs.occurrence) || 1;
          rendered = <sup id={`nr-footnote-ref-${encodeURIComponent(id)}${occurrence > 1 ? `-${occurrence}` : ""}`} className="nr-footnote-reference" data-footnote-ref={id}><a href={`#nr-footnote-${encodeURIComponent(id)}`}>{rendered}</a></sup>;
          break;
        }
      }
    }
    return rendered;
  }
  const children: React.ReactNode[] = [];
  node.forEach((child, offset) =>
    children.push(
      <React.Fragment key={offset}>
        {renderReadonlyBlock(
          child,
          pos + offset + 1,
          states,
          update,
          match,
          defaultWrap,
          false,
          spaceText && node.type.name !== "codeBlock",
          node.isTextblock && offset > 0 && !node.childBefore(offset).node?.marks.some(mark => mark.type.name === "code")
            ? node.textBetween(offset - 1, offset) : "",
          annotations,
        )}
      </React.Fragment>,
    ),
  );
  const state = states.get(pos) ?? {};
  const explicitIndent = node.attrs.indentExplicit === true;
  const attrs = {
    "data-indent": node.attrs.indent || explicitIndent ? String(node.attrs.indent || 0) : undefined,
    "data-indent-explicit": explicitIndent ? "true" : undefined,
    "data-list-followup": followsList && !explicitIndent ? true : undefined,
  };
  switch (node.type.name) {
    case "hardBreak":
      return <br />;
    case "horizontalRule":
      return <hr {...attrs} />;
    case "paragraph":
      return <p {...attrs}>{children.length ? children : <br />}</p>;
    case "mathInline":
      return <KaTeXFormula source={String(node.attrs.source ?? "")} />;
    case "mathBlock":
      return <div {...attrs} className="nr-math-block"><KaTeXFormula source={String(node.attrs.source ?? "")} displayMode /> </div>;
    case "rawHtml": case "rawHtmlInline": {
      const source = String(node.attrs.source ?? "");
      if (/^<!--[\s\S]*-->$/.test(source.trim())) return null;
      return React.createElement(node.type.name === "rawHtml" ? "div" : "span", { ...attrs, className: "nr-raw-html" }, <code>{source}</code>);
    }
    case "htmlAnchor": return <a {...attrs} id={String(node.attrs.id)} data-document-anchor="" />;
    case "markdownImage": {
      const image = <span {...attrs} className="markdown-inline-image"><ReadonlyImage src={String(node.attrs.src || "")} alt={node.attrs.alt} title={node.attrs.title} width={node.attrs.width} /></span>;
      const link = node.marks.find(mark => mark.type.name === "link");
      return link ? readonlyLink(String(link.attrs.href ?? ""), link.attrs.title ?? undefined, image) : image;
    }
    case "htmlDetails":
      { const collapsed = state.collapsed ?? node.attrs.open !== true; return <details {...attrs} className="nr-details" open={!collapsed}>
        <summary className="nr-details-summary" onClick={event => { if (event.target instanceof Element && event.target.closest("button")) return; event.preventDefault(); update(pos, { ...state, collapsed: !collapsed }); }}>
          <span className="nr-details-fold-icon"><EditorFoldIcon scope="block" expanded={!collapsed} /></span>
          <span className="nr-details-title">{String(node.attrs.summary ?? "点击展开")}</span>
          <span className="nr-details-actions">
            <button type="button" title="复制折叠区块" aria-label="复制折叠区块" onClick={event => { event.preventDefault(); event.stopPropagation(); void copyToClipboard(`${String(node.attrs.summary ?? "点击展开")}\n\n${node.textBetween(0, node.content.size, "\n")}`); }}><ToolbarIcon name="copy" /></button>
            <button type="button" className="block-workspace-open" title="块模式" aria-label="块模式" data-workspace-position={pos}><ToolbarIcon name="expand" /></button>
          </span>
        </summary>
        <div className="nr-details-content">{children}</div>
      </details>; }
    case "footnotes":
      return <section {...attrs} className="nr-footnotes"><ol>{children}</ol></section>;
    case "footnoteDefinition":
      { const id = encodeURIComponent(String(node.attrs.id ?? "")); return <li {...attrs} id={`nr-footnote-${id}`} value={node.attrs.number ?? undefined} tabIndex={-1}><div data-footnote-content="">{children}</div>{Array.from({ length: Math.max(0, Number(node.attrs.references) || 0) }, (_, index) => <a key={index} className="nr-footnote-backref" href={`#nr-footnote-ref-${id}${index ? `-${index + 1}` : ""}`} aria-label={index ? `返回脚注引用 ${index + 1}` : "返回脚注引用"}>{index ? `↩${index + 1}` : "↩"}</a>)}</li>; }
    case "heading":
      return React.createElement(`h${node.attrs.level}`, attrs, children);
    case "bulletList":
      return <ul {...attrs} data-list-spread={node.attrs.spread ? "true" : undefined}>{children}</ul>;
    case "orderedList":
      return (
        <ol
          {...attrs}
          start={node.attrs.start}
          data-list-spread={node.attrs.spread ? "true" : undefined}
          style={
            Object.fromEntries(
              listStyle(node)
                .split(";")
                .map((item) => item.split(":")),
            ) as React.CSSProperties
          }
        >
          {children}
        </ol>
      );
    case "resizableImage":
    case "image":
      return <div {...attrs}><ReadonlyImage src={String(node.attrs.src || "")} alt={node.attrs.alt} title={node.attrs.title} width={node.attrs.width} /></div>;
    case "table":
      return <div {...attrs} className="tableWrapper"><table><tbody>{children}</tbody></table></div>;
    case "tableRow": return <tr>{children}</tr>;
    case "tableHeader": return <th colSpan={node.attrs.colspan} rowSpan={node.attrs.rowspan} style={{ textAlign: node.attrs.textAlign || undefined, backgroundColor: editorBackgroundStyle(node.attrs.backgroundColor) }}>{children}</th>;
    case "tableCell": return <td colSpan={node.attrs.colspan} rowSpan={node.attrs.rowspan} style={{ textAlign: node.attrs.textAlign || undefined, backgroundColor: editorBackgroundStyle(node.attrs.backgroundColor) }}>{children}</td>;
    case "listItem":
      return <li data-task-checked={typeof node.attrs.taskChecked === "boolean" ? String(node.attrs.taskChecked) : undefined}>{children}</li>;
    case "blockquote": {
      const collapsed = state.collapsed ?? node.attrs.collapsed === true;
      return (
        <blockquote
          {...attrs}
          className="blockquote-wrap" data-alert={node.attrs.alert || undefined}
          data-collapsed={String(collapsed)}
        >
          <BlockquoteToolbar alert={node.attrs.alert} text={node.textContent} collapsed={collapsed}
            position={pos} toggle={() => update(pos, { collapsed: !collapsed })} />
          {!collapsed && <div className="blockquote-content">{children}</div>}
        </blockquote>
      );
    }
    case "codeBlock": {
      const { collapsed, isMermaid, showDiagram, isFlow, showFlow, wrap } = codeBlockDisplay(node.attrs, state, defaultWrap);
      if (node.attrs.language === "toc") return <div {...attrs} className="toc-block-wrap"><TableOfContentsBlock source={node.textContent} collapsed={collapsed} onToggleCollapse={() => update(pos, { collapsed: !collapsed })} /></div>;
      const lineNumbers = codeLineNumbersEnabled();
      const lines = node.textContent.split("\n");
      let linePosition = pos + 1;
      return (
        <div
          {...attrs}
          className={`code-block-wrap ${isFlow ? "flow-block-wrap" : ""} ${collapsed ? "collapsed" : ""}`}
          data-code-wrap={String(wrap)}
        >
          <div className="vr-code-toolbar" contentEditable={false} data-diagram={(isMermaid && showDiagram || isFlow && showFlow) ? "true" : undefined}>
            <span className="structured-block-symbol" aria-hidden="true">{structuredBlockSymbol(node.attrs.language)}</span>
            <span className="structured-block-caption">{node.attrs.title || (isFlow ? "流程" : "代码")}</span>
            <span aria-label="代码语言">{CODE_LANGUAGE_OPTIONS.find(option => option.value === (normalizeCodeLanguage(node.attrs.language) ?? ""))?.label}</span>
            {isFlow && <button type="button" aria-label={showFlow ? "显示 Flow 源码" : "显示 Flow 流程"} aria-pressed={showFlow} onClick={() => update(pos, { diagram: !showFlow })}>{showFlow ? "源码" : "流程"}</button>}
            {isMermaid && <button type="button" aria-label={showDiagram ? "显示 Mermaid 源码" : "显示 Mermaid 图形"} aria-pressed={showDiagram} onClick={() => update(pos, { diagram: !showDiagram })}>{showDiagram ? "源码" : "图形"}</button>}
            {isMermaid && <span data-mermaid-controls hidden={!showDiagram || collapsed} />}
            <button hidden={isMermaid && showDiagram || isFlow && showFlow} type="button" aria-label={lineNumbers ? "隐藏代码行号" : "显示代码行号"} aria-pressed={lineNumbers} onClick={() => saveBlockWorkspacePreferences({ lineNumbers: !lineNumbers })}>行号</button>
            <button
              type="button"
              onClick={() => void copyToClipboard(node.textContent)}
            >
              {isFlow ? "复制流程源码" : "复制代码"}
            </button>
            <button
              type="button"
              aria-pressed={wrap}
              aria-label={wrap ? "关闭代码软换行" : "开启代码软换行"}
              hidden={isMermaid && showDiagram || isFlow && showFlow}
              onClick={() => update(pos, { wrap: !wrap })}
            >
              换行
            </button>
            <button type="button" className="block-workspace-open" data-workspace-position={pos} title={isFlow ? "放大阅读流程块" : "放大阅读代码块"} aria-label={isFlow ? "放大阅读流程块" : "放大阅读代码块"}><ToolbarIcon name="expand" /></button>
            <button
              type="button"
              aria-label={collapsed ? `展开${isFlow ? "流程" : "代码"}块` : `折叠${isFlow ? "流程" : "代码"}块`}
              aria-expanded={!collapsed}
              onClick={() => update(pos, { collapsed: !collapsed })}
            >
              <EditorFoldIcon scope="block" expanded={!collapsed} />
            </button>
          </div>
          {isFlow && <DeferredFlowBlock source={node.textContent} visible={showFlow && !collapsed} />}
          {isMermaid && <DeferredMermaidDiagram source={node.textContent} visible={showDiagram && !collapsed} />}
          {!collapsed && !showDiagram && !showFlow && (
            <div className="code-block-inner">
              <pre>
                <code>{lineNumbers ? lines.map((line, index) => {
                  const position = linePosition;
                  linePosition += line.length + 1;
                  return <span className="vr-code-line" key={index} style={{ gridTemplateColumns: `calc(${String(lines.length).length}ch + var(--code-line-number-padding, 8px)) minmax(0, 1fr)` }}>
                    <span className="vr-code-line-number" aria-hidden="true">{index + 1}</span>
                    <span>{line ? renderReadonlyBlock(node.type.schema.text(line), position, states, update, match, defaultWrap, false, false) : "\n"}</span>
                  </span>;
                }) : children}</code>
              </pre>
            </div>
          )}
        </div>
      );
    }
    default:
      return null; // The capability gate rejects unknown nodes before mounting.
  }
}

export function decorateFlowBlock(block: React.ReactNode, attrs?: Record<string, string>): React.ReactNode {
  if (!attrs || !React.isValidElement<{ className?: string }>(block)) return block;
  const { class: flowClass, ...data } = attrs;
  return React.cloneElement(block, { ...data, className: `${block.props.className ?? ""} ${flowClass}` });
}

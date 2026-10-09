import type { DocumentMetadata } from "../types/models";
import { applyCodeHighlighting } from "./code-highlight";
import { isTauriRuntime } from "./runtime";
import { renderMermaid } from "./mermaid-render";
import { tocLevels, outlineLabel } from "./heading-links";

export interface PdfDocumentInfo extends DocumentMetadata {
  documentType?: string;
  path?: string;
  tags?: string[];
  concepts?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface PdfExportOptions {
  title: string;
  contentHtml: string;
  metadata?: PdfDocumentInfo;
  onError?: (error: Error) => void;
}

const PRINT_STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: #202124;
    background: #fff;
    font: 15px/1.75 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  }
  .print-actions {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-bottom: 1px solid #ddd;
    background: rgba(255, 255, 255, 0.96);
  }
  .print-actions button {
    padding: 7px 14px;
    border: 1px solid #bbb;
    border-radius: 6px;
    background: #fff;
    color: #222;
    font: inherit;
    cursor: pointer;
  }
  .print-actions .primary { border-color: #356ae6; background: #356ae6; color: #fff; }
  .print-document { width: min(100% - 40px, 820px); margin: 48px auto 80px; }
  .document-title { margin: 0 0 12px; font-size: 32px; line-height: 1.25; }
  .document-summary { margin: 14px 0 18px; color: #4b5260; font-size: 16px; }
  .document-meta {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 5px 18px;
    margin: 18px 0 28px;
    color: #4b5260;
    font-size: 13px;
  }
  .document-meta dt { font-weight: 600; color: #202124; }
  .document-meta dd { margin: 0; overflow-wrap: anywhere; }
  .document-content h1, .document-content h2, .document-content h3,
  .document-content h4, .document-content h5, .document-content h6 {
    line-height: 1.35;
    margin: 1.45em 0 0.55em;
    break-after: avoid-page;
  }
  .document-content h1 { font-size: 28px; }
  .document-content h2 { font-size: 23px; border-bottom: 1px solid #e1e3e8; padding-bottom: 5px; }
  .document-content h3 { font-size: 19px; }
  .document-content h4 { font-size: 16px; }
  .document-content h5, .document-content h6 { font-size: 15px; font-weight: 700; }
  .document-content h6 { color: #4b5260; }
  .document-content p { margin: 0.7em 0; }
  .document-content a { color: #1d5fd1; }
  .document-content blockquote {
    margin: 1em 0;
    padding: 2px 0 2px 16px;
    border-left: 4px solid #aab2c0;
    color: #4b5260;
  }
  .document-content pre {
    margin: 1em 0;
    padding: 14px 16px;
    border-radius: 7px;
    background: #f3f4f6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    break-inside: avoid-page;
  }
  .document-content .print-mermaid { margin: 1em 0; padding: 12px; break-inside: avoid-page; text-align: center; }
  .document-content .print-mermaid svg { display: block; max-width: 100%; height: auto; margin: auto; }
  .document-content code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.9em; }
  .document-content .hljs-comment, .document-content .hljs-quote { color: #6a737d; font-style: italic; }
  .document-content :is(.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-section, .hljs-link) { color: #b42318; }
  .document-content :is(.hljs-string, .hljs-title, .hljs-name, .hljs-type, .hljs-attribute, .hljs-symbol, .hljs-bullet, .hljs-addition) { color: #18794e; }
  .document-content :is(.hljs-number, .hljs-built_in, .hljs-variable, .hljs-template-variable, .hljs-selector-class, .hljs-selector-id) { color: #175cd3; }
  .document-content :is(.hljs-meta, .hljs-regexp, .hljs-deletion) { color: #9a3412; }
  .document-content :is(.hljs-strong, .hljs-title.class_) { font-weight: 700; }
  .document-content .hljs-emphasis { font-style: italic; }
  .document-content :not(pre) > code { padding: 1px 4px; border-radius: 3px; background: #f1f2f4; }
  .document-content table { width: 100%; border-collapse: collapse; margin: 1em 0; }
  .document-content th, .document-content td { padding: 7px 9px; border: 1px solid #bfc3ca; vertical-align: top; }
  .document-content th { background: #f3f4f6; }
  .document-content img { display: block; max-width: 100%; height: auto; margin: 1em auto; break-inside: avoid-page; }
  .document-content hr { margin: 1.8em 0; border: 0; border-top: 1px solid #bfc3ca; }
  .document-content li { margin: 0.2em 0; }
  .document-content .print-toc { margin: 1em 0; padding: 14px 16px; border: 1px solid #bfc3ca; border-radius: 7px; }
  .document-content .print-toc ol { list-style: none; padding: 0; margin: 8px 0 0; }
  .document-content .print-toc li { break-inside: avoid-page; }
  .document-content .print-flow { margin: 1em 0; padding: 16px 20px; border: 1px solid #bfc3ca; border-radius: 9px; }
  .document-content .print-flow-stages { margin-left: 13px; }
  .document-content .print-flow-step { position: relative; padding: 0 0 24px 29px; border-left: 1px dashed #aab2c0; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
  .document-content .print-flow-step:last-child { padding-bottom: 0; }
  .document-content .print-flow-step > :is(h1,h2,h3,h4,h5,h6):first-of-type { margin-top: 0; border: 0; padding: 0; }
  .document-content .print-flow-number { position: absolute; top: 3px; left: -14px; width: 26px; height: 26px; border: 1px solid #356ae6; border-radius: 50%; background: #fff; color: #1d5fd1; font: 600 13px/24px sans-serif; text-align: center; }
  .document-content li[data-task-checked] { list-style: none; }
  .print-task-checkbox { margin-left: -18px; margin-right: 6px; }
  .document-content [data-html-comment="true"] { display: none; }
  @page { size: A4; margin: 18mm 17mm 20mm; }
  @media print {
    .print-actions { display: none !important; }
    .print-document { width: auto; margin: 0; }
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    a { color: inherit; }
  }
`;

function headingId(text: string, index: number, used: Set<string>): string {
  const base = text
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{Letter}\p{Number}_-]/gu, "")
    .slice(0, 64) || `section-${index + 1}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

/**
 * Open a dedicated print view. The system print dialog can save it as a PDF;
 * keeping this path HTML-based preserves selectable text, links and tables.
 */
export function exportDocumentAsPdf({ title, contentHtml, metadata, onError }: PdfExportOptions): boolean {
  // Prepare desktop content in an isolated frame, then print a dedicated native WebView.
  const printFrame = isTauriRuntime() ? document.createElement("iframe") : null;
  if (printFrame) {
    printFrame.title = "PDF 打印文档";
    printFrame.setAttribute("aria-hidden", "true");
    Object.assign(printFrame.style, {
      position: "fixed",
      width: "1px",
      height: "1px",
      right: "0",
      bottom: "0",
      border: "0",
      opacity: "0",
      pointerEvents: "none",
    });
    document.body.append(printFrame);
  }
  const printWindow = printFrame?.contentWindow ?? window.open("", "_blank");
  if (!printWindow) return false;

  const closePrintView = () => {
    if (printFrame) printFrame.remove();
    else printWindow.close();
  };

  const printDocument = printWindow.document;
  printDocument.title = `${title || "无标题"}.pdf`;
  printDocument.documentElement.lang = "zh-CN";

  const charset = printDocument.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  const viewport = printDocument.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  const style = printDocument.createElement("style");
  style.textContent = PRINT_STYLES;
  const headNodes: HTMLElement[] = [charset, viewport, style];
  for (const [name, value] of [
    ["author", metadata?.author],
    ["description", metadata?.summary],
    ["keywords", metadata?.keywords?.join(", ")],
  ] as const) {
    if (!value) continue;
    const meta = printDocument.createElement("meta");
    meta.name = name;
    meta.content = value;
    headNodes.push(meta);
  }
  printDocument.head.replaceChildren(...headNodes);

  const actions = printDocument.createElement("div");
  actions.className = "print-actions";
  const closeButton = printDocument.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "关闭";
  closeButton.addEventListener("click", closePrintView);
  const printButton = printDocument.createElement("button");
  printButton.type = "button";
  printButton.className = "primary";
  printButton.textContent = "打印 / 存储为 PDF";
  printButton.disabled = true;
  printButton.addEventListener("click", () => printWindow.print());
  actions.append(closeButton, printButton);

  const wrapper = printDocument.createElement("main");
  wrapper.className = "print-document";
  const documentTitle = printDocument.createElement("h1");
  documentTitle.className = "document-title";
  documentTitle.textContent = title.trim() || "无标题";

  const coverNodes: HTMLElement[] = [documentTitle];
  if (metadata?.summary) {
    const summary = printDocument.createElement("p");
    summary.className = "document-summary";
    summary.textContent = metadata.summary;
    coverNodes.push(summary);
  }
  const metadataRows: Array<[string, string | undefined]> = [
    ["作者", metadata?.author],
    ["组织", metadata?.organization],
    ["邮箱", metadata?.email],
    ["网站", metadata?.website],
    ["版本", metadata?.version],
    ["语言", metadata?.language],
    ["文档类型", metadata?.documentType],
    ["位置", metadata?.path],
    ["普通标签", metadata?.tags?.join("、")],
    ["概念", metadata?.concepts?.join("、")],
    ["关键词", metadata?.keywords?.join("、")],
    ["许可证", metadata?.license],
    ["版权", metadata?.copyright],
    ["创建时间", metadata?.createdAt ? new Date(metadata.createdAt).toLocaleString() : undefined],
    ["更新时间", metadata?.updatedAt ? new Date(metadata.updatedAt).toLocaleString() : undefined],
  ];
  const visibleRows = metadataRows.filter((row): row is [string, string] => Boolean(row[1]));
  if (visibleRows.length > 0) {
    const details = printDocument.createElement("dl");
    details.className = "document-meta";
    for (const [label, value] of visibleRows) {
      const term = printDocument.createElement("dt");
      term.textContent = label;
      const description = printDocument.createElement("dd");
      description.textContent = value;
      details.append(term, description);
    }
    coverNodes.push(details);
  }

  const content = printDocument.createElement("article");
  content.className = "document-content";
  const template = printDocument.createElement("template");
  template.innerHTML = contentHtml;
  template.content.querySelectorAll("script, iframe, object, embed, style, link, .code-block-copy, [data-pdf-exclude]")
    .forEach((node) => node.remove());
  template.content.querySelectorAll<HTMLElement>(".ProseMirror-activeline, .heading-fold-hidden, [data-heading-fold-hidden]")
    .forEach((element) => {
      element.classList.remove("ProseMirror-activeline", "heading-fold-hidden");
      element.removeAttribute("hidden");
      element.removeAttribute("data-heading-fold-hidden");
      if (element.style.display === "none") element.style.removeProperty("display");
    });
  template.content.querySelectorAll<HTMLElement>("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith("on")) element.removeAttribute(attribute.name);
    }
    for (const attributeName of ["href", "src"]) {
      const value = element.getAttribute(attributeName)?.trim().toLowerCase();
      if (value?.startsWith("javascript:")) element.removeAttribute(attributeName);
    }
  });
  template.content.querySelectorAll<HTMLElement>("pre[data-language] > code").forEach((code) => {
    applyCodeHighlighting(code, code.parentElement?.getAttribute("data-language"));
  });
  content.append(template.content.cloneNode(true));

  const diagramReady = (async () => {
    if ([...content.querySelectorAll('pre[data-language]')].some(pre => pre.getAttribute("data-language")?.toLowerCase() === "flow")) {
      const { renderPrintFlows } = await import("./pdf-flow");
      renderPrintFlows(content);
    }
    content.querySelectorAll<HTMLDetailsElement>("details").forEach(element => { element.open = true; });
    content.querySelectorAll<HTMLLIElement>("li[data-task-checked]").forEach(item => {
      const checkbox = printDocument.createElement("input");
      checkbox.type = "checkbox";
      checkbox.disabled = true;
      checkbox.className = "print-task-checkbox";
      checkbox.checked = item.getAttribute("data-task-checked") === "true";
      if (checkbox.checked) checkbox.setAttribute("checked", "");
      (item.querySelector("p") ?? item).prepend(checkbox);
    });
    const formulas = [...content.querySelectorAll<HTMLElement>("[data-nr-math]")];
    if (formulas.length) {
      const [katex, css] = await Promise.all([import("katex"), import("katex/dist/katex.min.css?inline")]);
      const mathStyle = printDocument.createElement("style");
      mathStyle.textContent = css.default;
      printDocument.head.append(mathStyle);
      for (const formula of formulas) formula.innerHTML = katex.default.renderToString(formula.getAttribute("source") ?? formula.getAttribute("data-source") ?? "", { displayMode: formula.getAttribute("data-nr-math") === "block", throwOnError: false, trust: false });
    }
    const diagrams = [...content.querySelectorAll<HTMLPreElement>("pre[data-language]")]
    .filter(pre => pre.getAttribute("data-language")?.toLowerCase() === "mermaid");
    await Promise.all(diagrams.map(async pre => {
    try {
      const svg = await renderMermaid(pre.textContent ?? "", {
        background: "#fff", text: "#202124", accent: "#356ae6", border: "#bfc3ca", darkMode: false,
        nodeBackground: "#e4edff", nodeBackgroundAlt: "#d1e0ff", nodeBackgroundTertiary: "#eef4ff",
      });
      const figure = printDocument.createElement("div");
      figure.className = "print-mermaid";
      figure.innerHTML = svg;
      pre.replaceWith(figure);
    } catch {
      // Preserve the source in the PDF when a diagram has invalid syntax.
    }
  }));

  // Chromium can turn semantic heading levels into the PDF viewer's clickable
  // outline/bookmark sidebar. Keep those headings in the document structure and
  // give every destination a stable id, but do not insert a visible TOC page in
  // the exported body.
  documentTitle.id = "document-title";
  const usedIds = new Set<string>([documentTitle.id]);
  const headings = [...content.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6")];
  headings.forEach((heading, index) => {
    const existingId = heading.id.trim();
    if (existingId && !usedIds.has(existingId)) {
      usedIds.add(existingId);
      return;
    }
    heading.id = headingId(heading.textContent ?? "", index, usedIds);
  });
  renderPrintToc(content);
  })();

  wrapper.append(...coverNodes, content);
  printDocument.body.replaceChildren(actions, wrapper);
  if (!printFrame) printWindow.opener = null;

  // Let fonts and images settle before opening the system dialog. The visible
  // print button remains available when a platform suppresses automatic print.
  const assetsReady = () => {
  const images = [...content.querySelectorAll<HTMLImageElement>("img")];
  const imageReady = Promise.all(images.map((image) => {
    if (image.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    });
  }));
  const fontsReady = printDocument.fonts?.ready ?? Promise.resolve();
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, 1800));
  return Promise.race([Promise.all([imageReady, fontsReady]), timeout]);
  };
  void Promise.race([diagramReady, new Promise<void>(resolve => window.setTimeout(resolve, 10_000))])
    .then(() => {
      printButton.disabled = false;
      return assetsReady();
    }).then(() => {
    if ((!printFrame && printWindow.closed) || (printFrame && !printFrame.isConnected)) return;
    if (printFrame) {
      return import("@tauri-apps/api/core").then(({ invoke }) => invoke("open_pdf_print_preview", {
        title: title.trim() || "无标题", html: printDocument.documentElement.outerHTML,
      })).finally(closePrintView);
    }
    printWindow.focus();
    printWindow.print();
  }).catch(reason => {
    closePrintView();
    const error = reason instanceof Error ? reason : new Error(String(reason));
    if (onError) onError(error);
    else window.alert(`无法导出 PDF：${error.message}`);
  });
  return true;
}

/** Materialize configured TOCs after all rendered headings have their PDF IDs. */
export function renderPrintToc(root: HTMLElement): void {
  const headings = [...root.querySelectorAll<HTMLHeadingElement>("h1,h2,h3,h4,h5,h6")];
  for (const pre of [...root.querySelectorAll<HTMLPreElement>('pre[data-language="toc"]')]) {
    const levels = tocLevels(pre.textContent ?? "");
    const nav = root.ownerDocument.createElement("nav");
    nav.className = "print-toc";
    nav.setAttribute("aria-label", "文档目录");
    const label = root.ownerDocument.createElement("strong");
    label.textContent = "目录";
    const list = root.ownerDocument.createElement("ol");
    for (const heading of headings.filter(heading => levels.includes(Number(heading.tagName.slice(1))))) {
      const item = root.ownerDocument.createElement("li");
      item.style.paddingLeft = `${(Number(heading.tagName.slice(1)) - Math.min(...levels)) * 16}px`;
      const link = root.ownerDocument.createElement("a");
      link.href = `#${encodeURIComponent(heading.id)}`;
      link.textContent = outlineLabel(heading.textContent ?? "");
      item.append(link);
      list.append(item);
    }
    nav.append(label, list);
    if (!list.childElementCount) list.textContent = "没有符合级别设置的标题";
    pre.replaceWith(nav);
  }
}

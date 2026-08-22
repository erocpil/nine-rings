import type { DocumentMetadata } from "../types/models";
import { applyCodeHighlighting } from "./code-highlight";

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
  .toc {
    margin: 42px 0 54px;
    padding: 28px 32px;
    border: 1px solid #d9dce3;
    border-radius: 10px;
    break-after: page;
  }
  .toc h2 { margin: 0 0 18px; font-size: 22px; }
  .toc-empty { color: #777; }
  .toc-list { margin: 0; padding: 0; list-style: none; }
  .toc-item { margin: 5px 0; }
  .toc-item a { color: #202124; text-decoration: none; }
  .toc-item a:hover { color: #356ae6; text-decoration: underline; }
  .toc-level-2 { padding-left: 18px; }
  .toc-level-3 { padding-left: 36px; }
  .toc-level-4 { padding-left: 54px; }
  .toc-level-5 { padding-left: 72px; }
  .toc-level-6 { padding-left: 90px; }
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
  @page { size: A4; margin: 18mm 17mm 20mm; }
  @media print {
    .print-actions { display: none !important; }
    .print-document { width: auto; margin: 0; }
    .toc { border: 0; padding: 0; }
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
export function exportDocumentAsPdf({ title, contentHtml, metadata }: PdfExportOptions): boolean {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return false;

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
  closeButton.addEventListener("click", () => printWindow.close());
  const printButton = printDocument.createElement("button");
  printButton.type = "button";
  printButton.className = "primary";
  printButton.textContent = "打印 / 存储为 PDF";
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

  const headings = [...content.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6")];
  const usedIds = new Set<string>();
  const toc = printDocument.createElement("nav");
  toc.className = "toc";
  toc.setAttribute("aria-label", "目录");
  const tocTitle = printDocument.createElement("h2");
  tocTitle.textContent = "目录";
  toc.append(tocTitle);

  if (headings.length === 0) {
    const empty = printDocument.createElement("div");
    empty.className = "toc-empty";
    empty.textContent = "正文中没有标题层级";
    toc.append(empty);
  } else {
    const list = printDocument.createElement("ol");
    list.className = "toc-list";
    headings.forEach((heading, index) => {
      const id = headingId(heading.textContent ?? "", index, usedIds);
      heading.id = id;
      const item = printDocument.createElement("li");
      item.className = `toc-item toc-level-${heading.tagName.slice(1)}`;
      const link = printDocument.createElement("a");
      link.href = `#${id}`;
      link.textContent = heading.textContent?.trim() || `第 ${index + 1} 节`;
      item.append(link);
      list.append(item);
    });
    toc.append(list);
  }

  wrapper.append(...coverNodes, toc, content);
  printDocument.body.replaceChildren(actions, wrapper);
  printWindow.opener = null;

  // Let fonts and images settle before opening the system dialog. The visible
  // print button remains available when a platform suppresses automatic print.
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
  void Promise.race([Promise.all([imageReady, fontsReady]), timeout]).then(() => {
    if (printWindow.closed) return;
    printWindow.focus();
    printWindow.print();
  });
  return true;
}

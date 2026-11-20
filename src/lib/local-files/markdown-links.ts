import { resolveRelativeNode } from "./file-model";

export type LocalMarkdownLink = { node: string; fragment?: string };
export function canFollowMarkdownLink(href: string): boolean {
  return Boolean(href) && !/^(?:https?:|mailto:|tel:|#nr-(?:heading|footnote)-)/i.test(href);
}

/** Split syntax before decoding so escaped '#' and '?' remain path characters. */
export function localMarkdownLink(fromNode: string, href: string): LocalMarkdownLink {
  const hash = href.indexOf("#");
  const path = (hash < 0 ? href : href.slice(0, hash)).split("?", 1)[0];
  const fragment = hash < 0 ? undefined : decodeURIComponent(href.slice(hash + 1)) || undefined;
  if (!path) {
    if (hash !== 0) throw new Error("链接缺少文件路径");
    return { node: fromNode, fragment };
  }
  if (/^(?:[a-z][a-z0-9+.-]*:|[\\/])/i.test(path) || /%(?:2f|5c|00|3a)/i.test(path)) {
    throw new Error("链接超出授权目录，或使用了无效的文件路径");
  }
  const node = resolveRelativeNode(fromNode, path);
  if (!/\.(?:md|markdown)$/i.test(node)) throw new Error("文档内跳转需要 Markdown 文件");
  return { node, fragment };
}

export function relativeMarkdownHref(fromNode: string, targetNode: string): string {
  const base = fromNode.split("/").slice(0, -1);
  const target = targetNode.split("/");
  let common = 0;
  while (common < base.length && common < target.length - 1 && base[common] === target[common]) common++;
  return [...base.slice(common).map(() => ".."), ...target.slice(common).map(encodeURIComponent)].join("/");
}

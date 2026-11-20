import { markdownLanguage } from "@codemirror/lang-markdown";
import type { Nodes } from "mdast";
import { markdownAST } from "../gfm-parser";
import { localMarkdownLink, relativeMarkdownHref } from "./markdown-links";

export interface MarkdownLinkDestination {
  href: string;
  line: number;
  key: number;
  range?: { from: number; to: number };
}

/** Use the shared parser for meaning and only use verified syntax spans for writes. */
export function markdownLinkDestinations(source: string): MarkdownLinkDestination[] {
  const definitions = new Map<string, Extract<Nodes, { type: "definition" }>>();
  const references = new Set<string>();
  const links: Array<Extract<Nodes, { type: "link" | "definition" }>> = [];
  const visit = (node: Nodes) => {
    if (node.type === "definition" && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
    else if (node.type === "linkReference") references.add(node.identifier);
    else if (node.type === "link") links.push(node);
    if ("children" in node) node.children.forEach(visit);
  };
  visit(markdownAST(source));
  for (const key of references) {
    const definition = definitions.get(key);
    if (definition) links.push(definition);
  }
  const tree = markdownLanguage.parser.parse(source);
  return links.flatMap(link => {
    const { start, end } = link.position ?? {};
    if (start?.offset === undefined || end?.offset === undefined || !link.url) return [];
    const from = start.offset;
    const syntax = tree.resolveInner(from, 1);
    let range: MarkdownLinkDestination["range"];
    for (let node: typeof syntax | null = syntax; node; node = node.parent) {
      if (node.from !== from || node.to !== end.offset) continue;
      if (node.name !== (link.type === "link" ? "Link" : "LinkReference")) continue;
      const url = node.getChild("URL");
      if (url) {
        const angle = source[url.from] === "<" && source[url.to - 1] === ">";
        range = { from: url.from + Number(angle), to: url.to - Number(angle) };
      }
      break;
    }
    return [{ href: link.url, line: start.line, key: from, range }];
  }).sort((a, b) => a.key - b.key);
}

export type MarkdownPathMove = { from: string; to: string };
export interface MarkdownLinkEdit { link: MarkdownLinkDestination; href: string }

const movedPath = (path: string, from: string, to: string) =>
  path === from || path.startsWith(from + "/") ? to + path.slice(from.length) : path;
const forward = (path: string, moves: readonly MarkdownPathMove[]) =>
  moves.reduce((current, move) => movedPath(current, move.from, move.to), path);
const backward = (path: string, moves: readonly MarkdownPathMove[]) =>
  moves.reduceRight((current, move) => movedPath(current, move.to, move.from), path);

export function planMarkdownLinkEdits(source: string, node: string, moves: readonly MarkdownPathMove[]): MarkdownLinkEdit[] {
  return markdownLinkDestinations(source).flatMap(link => {
    if (!link.range || link.href.startsWith("#")) return [];
    try {
      const oldNode = backward(node, moves);
      const target = localMarkdownLink(oldNode, link.href);
      const next = forward(target.node, moves);
      // A move to another directory changes outgoing relative paths as well.
      if (next === target.node && oldNode.slice(0, oldNode.lastIndexOf("/") + 1) === node.slice(0, node.lastIndexOf("/") + 1)) return [];
      const current = (() => { try { return localMarkdownLink(node, link.href).node; } catch { return null; } })();
      if (current === next) return [];
      const suffix = link.href.slice(link.href.search(/[?#]|$/));
      return [{ link, href: relativeMarkdownHref(node, next) + suffix }];
    } catch { return []; }
  });
}

/** Keep link labels, titles, reference definitions, and unrelated bytes intact. */
export function applyMarkdownLinkEdits(source: string, changes: readonly MarkdownLinkEdit[]): string {
  let result = source;
  for (const { link, href } of [...changes].sort((a, b) => b.link.key - a.link.key)) {
    if (!link.range) throw new Error("无法安全识别此链接的原始范围");
    // Markdown destination delimiters inside file names must remain literal.
    const escaped = href.replace(/[()<>\\\s]/gu, character => encodeURIComponent(character).replace(/\(/g, "%28").replace(/\)/g, "%29"));
    result = result.slice(0, link.range.from) + escaped + result.slice(link.range.to);
  }
  return result;
}

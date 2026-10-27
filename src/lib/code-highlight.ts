export {
  CODE_LANGUAGE_OPTIONS,
  type CodeLanguageOption,
} from "./code-language-options";
import bash from "highlight.js/lib/languages/bash";
import x86asm from "highlight.js/lib/languages/x86asm";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";
import { gasHighlight } from "./code-gas-highlight";

export interface SyntaxToken {
  from: number;
  to: number;
  classes: string[];
}

export const MAX_HIGHLIGHT_CODE_LENGTH = 20_000;
const MAX_HIGHLIGHT_CACHE_ENTRIES = 32;
const highlightCache = new Map<string, SyntaxToken[]>();

const lowlight = createLowlight({
  bash,
  c,
  cpp,
  csharp,
  css,
  go,
  gas: gasHighlight,
  java,
  javascript,
  json,
  makefile,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
  x86asm,
});

lowlight.registerAlias({
  javascript: ["js", "jsx", "node"],
  typescript: ["ts", "tsx"],
  xml: ["html", "svg"],
  bash: ["sh", "shell", "zsh"],
  python: ["py"],
  rust: ["rs"],
  go: ["golang"],
  cpp: ["c++", "cc", "cxx"],
  csharp: ["cs", "dotnet"],
  yaml: ["yml"],
  markdown: ["md", "mdown"],
  makefile: ["make", "mk", "gnumake"],
  gas: ["gnu-as"],
  x86asm: ["nasm", "asm"],
});

const PLAIN_TEXT_ALIASES = new Set([
  "",
  "text",
  "txt",
  "plain",
  "plaintext",
  "none",
]);
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  js: "javascript",
  jsx: "javascript",
  node: "javascript",
  ts: "typescript",
  tsx: "typescript",
  html: "xml",
  svg: "xml",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  py: "python",
  rs: "rust",
  golang: "go",
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  cs: "csharp",
  dotnet: "csharp",
  yml: "yaml",
  md: "markdown",
  mdown: "markdown",
  make: "makefile",
  mk: "makefile",
  gnumake: "makefile",
  "gnu-as": "gas",
  nasm: "x86asm",
  asm: "x86asm",
};

export function normalizeCodeLanguage(language: unknown): string | null {
  if (typeof language !== "string") return null;
  const normalized = language.trim().toLowerCase();
  if (PLAIN_TEXT_ALIASES.has(normalized)) return null;
  const canonical = LANGUAGE_ALIASES[normalized] ?? normalized;
  if (canonical === "mermaid" || canonical === "flow" || canonical === "toc")
    return canonical;
  return lowlight.registered(canonical) ? canonical : null;
}

function classNames(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? value.split(/\s+/).filter(Boolean) : [];
}

export function highlightCode(code: string, language: unknown): SyntaxToken[] {
  const normalized = normalizeCodeLanguage(language);
  if (
    !normalized ||
    normalized === "mermaid" ||
    normalized === "flow" ||
    normalized === "toc" ||
    !code ||
    code.length > MAX_HIGHLIGHT_CODE_LENGTH
  )
    return [];
  const cacheKey = `${normalized}\0${code}`;
  const cached = highlightCache.get(cacheKey);
  if (cached) {
    highlightCache.delete(cacheKey);
    highlightCache.set(cacheKey, cached);
    return cached;
  }

  const root = lowlight.highlight(normalized, code);
  const tokens: SyntaxToken[] = [];
  let offset = 0;

  const walk = (
    node: (typeof root.children)[number],
    inheritedClasses: string[],
  ) => {
    if (node.type === "text") {
      const start = offset;
      offset += node.value.length;
      if (inheritedClasses.length > 0 && offset > start) {
        tokens.push({ from: start, to: offset, classes: inheritedClasses });
      }
      return;
    }
    if (node.type !== "element") return;
    const ownClasses = classNames(node.properties?.className);
    const classes =
      ownClasses.length > 0
        ? [...inheritedClasses, ...ownClasses]
        : inheritedClasses;
    node.children.forEach((child) => walk(child, classes));
  };

  root.children.forEach((child) => walk(child, []));
  highlightCache.set(cacheKey, tokens);
  while (highlightCache.size > MAX_HIGHLIGHT_CACHE_ENTRIES) {
    const oldest = highlightCache.keys().next().value as string | undefined;
    if (!oldest) break;
    highlightCache.delete(oldest);
  }
  return tokens;
}

export function applyCodeHighlighting(
  element: HTMLElement,
  language: unknown,
): boolean {
  const source = element.textContent ?? "";
  const tokens = highlightCode(source, language);
  if (tokens.length === 0) return false;

  const document = element.ownerDocument;
  const fragment = document.createDocumentFragment();
  let offset = 0;
  for (const token of tokens) {
    if (token.from > offset)
      fragment.append(
        document.createTextNode(source.slice(offset, token.from)),
      );
    const span = document.createElement("span");
    span.className = token.classes.join(" ");
    span.textContent = source.slice(token.from, token.to);
    fragment.append(span);
    offset = token.to;
  }
  if (offset < source.length)
    fragment.append(document.createTextNode(source.slice(offset)));
  element.replaceChildren(fragment);
  return true;
}

import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";

export interface CodeLanguageOption {
  value: string;
  label: string;
}

export interface SyntaxToken {
  from: number;
  to: number;
  classes: string[];
}

export const MAX_HIGHLIGHT_CODE_LENGTH = 20_000;
const MAX_HIGHLIGHT_CACHE_ENTRIES = 32;
const highlightCache = new Map<string, SyntaxToken[]>();

export const CODE_LANGUAGE_OPTIONS: readonly CodeLanguageOption[] = [
  { value: "", label: "纯文本" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "json", label: "JSON" },
  { value: "xml", label: "HTML / XML" },
  { value: "css", label: "CSS" },
  { value: "bash", label: "Shell / Bash" },
  { value: "python", label: "Python" },
  { value: "rust", label: "Rust" },
  { value: "go", label: "Go" },
  { value: "java", label: "Java" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" },
  { value: "sql", label: "SQL" },
  { value: "yaml", label: "YAML" },
  { value: "markdown", label: "Markdown" },
] as const;

const lowlight = createLowlight({
  bash,
  c,
  cpp,
  csharp,
  css,
  go,
  java,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
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
});

const PLAIN_TEXT_ALIASES = new Set(["", "text", "txt", "plain", "plaintext", "none"]);
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  js: "javascript", jsx: "javascript", node: "javascript",
  ts: "typescript", tsx: "typescript",
  html: "xml", svg: "xml",
  sh: "bash", shell: "bash", zsh: "bash",
  py: "python", rs: "rust", golang: "go",
  "c++": "cpp", cc: "cpp", cxx: "cpp",
  cs: "csharp", dotnet: "csharp",
  yml: "yaml", md: "markdown", mdown: "markdown",
};

export function normalizeCodeLanguage(language: unknown): string | null {
  if (typeof language !== "string") return null;
  const normalized = language.trim().toLowerCase();
  if (PLAIN_TEXT_ALIASES.has(normalized)) return null;
  const canonical = LANGUAGE_ALIASES[normalized] ?? normalized;
  return lowlight.registered(canonical) ? canonical : null;
}

function classNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? value.split(/\s+/).filter(Boolean) : [];
}

export function highlightCode(code: string, language: unknown): SyntaxToken[] {
  const normalized = normalizeCodeLanguage(language);
  if (!normalized || !code || code.length > MAX_HIGHLIGHT_CODE_LENGTH) return [];
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

  const walk = (node: (typeof root.children)[number], inheritedClasses: string[]) => {
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
    const classes = ownClasses.length > 0 ? [...inheritedClasses, ...ownClasses] : inheritedClasses;
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

export function applyCodeHighlighting(element: HTMLElement, language: unknown): boolean {
  const source = element.textContent ?? "";
  const tokens = highlightCode(source, language);
  if (tokens.length === 0) return false;

  const document = element.ownerDocument;
  const fragment = document.createDocumentFragment();
  let offset = 0;
  for (const token of tokens) {
    if (token.from > offset) fragment.append(document.createTextNode(source.slice(offset, token.from)));
    const span = document.createElement("span");
    span.className = token.classes.join(" ");
    span.textContent = source.slice(token.from, token.to);
    fragment.append(span);
    offset = token.to;
  }
  if (offset < source.length) fragment.append(document.createTextNode(source.slice(offset)));
  element.replaceChildren(fragment);
  return true;
}

import { markdownAST } from "./gfm-parser";
import type { RootContent, Nodes } from "mdast";
export interface VocabularySection {
  key: string;
  title: string;
  examples: boolean;
  nodes: RootContent[];
}
export interface VocabularySense {
  key: string;
  title: string;
  sections: VocabularySection[];
}
export interface VocabularyEntry {
  key: string;
  title: string;
  intro: RootContent[];
  senses: VocabularySense[];
}
export interface VocabularySource {
  key: string;
  title: string;
  intro: RootContent[];
  entries: VocabularyEntry[];
}
export interface VocabularyStudy {
  word: string;
  pronunciation: string[];
  sources: VocabularySource[];
  recognized: boolean;
  extractedAt: string;
  source: string;
}
/** Future relationships use document/anchor identities, never view array positions. */
export interface VocabularyArticleContext {
  id: string;
  wordDocumentId: string;
  articleDocumentId: string;
  expression: string;
  quote: string;
  articleAnchorId?: string;
  sourceProvider?: string;
  sourceSenseId?: string;
}
export function vocabularyText(node: Nodes): string {
  if ("value" in node) return String(node.value);
  if (node.type === "break") return "\n";
  return "children" in node
    ? node.children.map((child) => vocabularyText(child as Nodes)).join("")
    : node.type === "image"
      ? (node.alt ?? "")
      : "";
}
function key(scope: string, title: string) {
  let hash = 2166136261;
  for (const char of `${scope}/${title}`.normalize("NFC"))
    hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  return (hash >>> 0).toString(16);
}
/** Shared GFM AST, no heading regex parser or cross-dictionary sense inference. */
export function parseVocabularyStudy(
  source: string,
  fallbackWord = "",
): VocabularyStudy {
  if (source.length > 250000) throw new Error("词汇资料超出学习视图限制");
  const root = markdownAST(source);
  const result: VocabularyStudy = {
    word: fallbackWord,
    pronunciation: [],
    sources: [],
    recognized: false,
    extractedAt: "",
    source,
  };
  let provider: VocabularySource | undefined,
    entry: VocabularyEntry | undefined,
    sense: VocabularySense | undefined,
    section: VocabularySection | undefined;
  let count = 0,
    hasWord = false;
  const occurrences = new Map<string, number>();
  const uniqueKey = (scope: string, title: string) => {
    const base = key(scope, title),
      occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return `${base}-${occurrence}`;
  };
  for (const node of root.children) {
    if (++count > 10000) throw new Error("词汇资料块数超限");
    const text = vocabularyText(node).trim();
    if (node.type === "heading" && node.depth === 1 && !hasWord && text) {
      result.word = text;
      hasWord = true;
    }
    if (node.type === "paragraph" && text.startsWith("提取时间："))
      result.extractedAt = text.slice(5);
    if (
      node.type === "paragraph" &&
      text.startsWith("音标：") &&
      !result.pronunciation.includes(text.slice(3))
    )
      result.pronunciation.push(text.slice(3));
    if (node.type === "heading" && node.depth === 2) {
      provider = undefined;
      entry = undefined;
      sense = undefined;
      section = undefined;
      if (text.includes("剑桥") || /cambridge|freecollocation/i.test(text)) {
        provider = {
          key: uniqueKey("source", text),
          title: text,
          intro: [],
          entries: [],
        };
        result.sources.push(provider);
      }
      continue;
    }
    if (!provider) continue;
    if (node.type === "heading" && node.depth === 3) {
      entry = {
        key: uniqueKey(provider.key, text),
        title: text,
        intro: [],
        senses: [],
      };
      provider.entries.push(entry);
      sense = undefined;
      section = undefined;
      continue;
    }
    if (!entry) {
      provider.intro.push(node);
      continue;
    }
    if (node.type === "heading" && node.depth === 4) {
      sense = { key: uniqueKey(entry.key, text), title: text, sections: [] };
      entry.senses.push(sense);
      section = undefined;
      continue;
    }
    if (!sense && node.type !== "heading" && node.type !== "list") {
      entry.intro.push(node);
      continue;
    }
    if (!sense) {
      sense = {
        key: uniqueKey(entry.key, "default"),
        title: "搭配与用法",
        sections: [],
      };
      entry.senses.push(sense);
    }
    const category = node.type === "heading" && node.depth >= 5;
    const exampleLabel =
      node.type === "paragraph" && /^(?:更多)?例句[：:]?$|^短语动词/.test(text);
    if (category || exampleLabel) {
      section = {
        key: uniqueKey(sense.key, text),
        title: text.replace(/[：:]$/, ""),
        examples: exampleLabel && !text.startsWith("短语动词"),
        nodes: [],
      };
      sense.sections.push(section);
      continue;
    }
    if (!section) {
      section = {
        key: uniqueKey(sense.key, "definition"),
        title: "",
        examples: false,
        nodes: [],
      };
      sense.sections.push(section);
    }
    section.nodes.push(node);
  }
  result.recognized = result.sources.some((item) => item.entries.length);
  return result;
}

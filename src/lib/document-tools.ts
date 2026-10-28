import type { Node } from "@tiptap/pm/model";
import { findSearchMatches } from "../extensions/SearchHighlights";
import { searchPatternError, type SearchOptions } from "./search-matching";

export function documentBlockOrdinal(doc: Node, position: number): number {
  return doc.childCount
    ? Math.min(
        doc.childCount,
        doc
          .resolve(Math.max(0, Math.min(doc.content.size, position)))
          .index(0) + 1,
      )
    : 0;
}
export function resolveDocumentBlockJump(
  doc: Node,
  value: string,
):
  | { position: number; number: number; error?: never }
  | { error: string; position?: never; number?: never } {
  const number = Number(value.trim());
  if (
    !/^\d+$/.test(value.trim()) ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > doc.childCount
  )
    return { error: `请输入 1–${doc.childCount} 的块号` };
  let position = 0;
  for (let index = 0; index < number - 1; index++)
    position += doc.child(index).nodeSize;
  return { position, number };
}
export function evaluateDocumentFind(
  doc: Node,
  query: string,
  options: SearchOptions,
  engine: { ready: boolean; error: string },
  preserveWhitespace = false,
) {
  const error = options.regex
    ? engine.error ||
      (!engine.ready
        ? "正在加载 Perl 正则引擎…"
        : searchPatternError(query, options))
    : "";
  if (error) return { matches: [], error };
  try {
    return {
      matches: findSearchMatches(
        doc,
        query,
        preserveWhitespace,
        options.caseSensitive === true,
        options,
      ),
      error: "",
    };
  } catch {
    return { matches: [], error: "正则匹配超出执行限制，请简化表达式。" };
  }
}

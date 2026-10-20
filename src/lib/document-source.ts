import type { DeltaOps, DocumentMetadata } from "../types/models";
import { mdToDelta } from "./md-parser";
import { deltaToMarkdown } from "./markdown-serializer";
import { plainTextToDelta } from "./plain-text-delta";

/** Raw source is authoritative for non-Markdown documents; ops is a searchable projection. */
export function readDocumentSource(content: DeltaOps): string {
  if (typeof content.metadata?.sourceText === "string") return content.metadata.sourceText;
  if (typeof content.metadata?.markdownSource === "string") return content.metadata.markdownSource;
  if (content.metadata?.sourceFormat === "text") return content.ops.map(op => typeof op.insert === "string" ? op.insert : "").join("");
  return deltaToMarkdown(content);
}

export function writeDocumentSource(source: string, language: string, previous?: DocumentMetadata): DeltaOps {
  const metadata = { ...previous, sourceLanguage: language };
  if (language === "markdown") {
    delete metadata.sourceText;
    return { ...mdToDelta(source), metadata: { ...metadata, sourceFormat: "markdown", markdownSource: source } };
  }
  delete metadata.markdownSource;
  return { ...plainTextToDelta(source), metadata: { ...metadata, sourceFormat: "text", sourceText: source } };
}

import { describe, it, expect } from "vitest";
import { readDocumentSource, writeDocumentSource } from "../../src/lib/document-source";
import { documentHasPreview, documentLanguageFromFilename } from "../../src/lib/document-language";
import { SourceNavigationSession } from "../../src/lib/markdown-source-navigation";
import { deltaToMarkdown, noteToMarkdown } from "../../src/lib/markdown-serializer";
import { isCertifiedBodyMetadata } from "../../src/lib/sync/body-metadata-policy";
import { buildTextImportInput } from "../../src/lib/markdown-import";

const raw = '# literal\n\n- item\n\treturn "<script>";  \n\n| a | b |\n| --- | --- |\n| c | d |\n\\*literal\\*';

describe("raw document authority", () => {
  it("keeps code/text literal across saving, editing, export and changing formats", () => {
    for (const language of ["", "python", "json", "flow", "mermaid"]) {
      const content = writeDocumentSource(raw, language);
      expect(readDocumentSource(content)).toBe(raw);
      expect(deltaToMarkdown(content)).toBe(raw);
      expect(noteToMarkdown("must not insert a title", content)).toBe(raw);
      expect(content.ops.every(op => !op.attributes)).toBe(true);
      const session = new SourceNavigationSession(raw, content);
      expect(session.current.document.content?.every(node => node.type === "paragraph")).toBe(true);
      expect(session.update(raw + "\n\n").read().metadata?.sourceText).toBe(raw + "\n\n");
      expect(session.update(raw).read().metadata?.sourceText).toBe(raw);
    }
    const markdown = writeDocumentSource(raw, "markdown");
    expect(markdown.metadata?.sourceText).toBeUndefined();
    expect(readDocumentSource(markdown)).toBe(raw);
    expect(readDocumentSource(writeDocumentSource(readDocumentSource(markdown), ""))).toBe(raw);
  });
  it("only exposes preview for Markdown, Flow and Mermaid; DSL previews wrap the whole raw source", () => {
    for (const language of ["markdown", "flow", "mermaid"]) expect(documentHasPreview(language)).toBe(true);
    for (const language of ["", "c", "python", "json"]) expect(documentHasPreview(language)).toBe(false);
    for (const language of ["flow", "mermaid"]) {
      const session = new SourceNavigationSession(raw, writeDocumentSource(raw, language));
      expect(session.current.previewDocument.content).toEqual([{ type: "codeBlock", attrs: { language, diagram: true }, content: [{ type: "text", text: raw }] }]);
    }
  });
  it("maps raw source positions including empty lines and literal Markdown syntax", () => {
    const source = "# first\n\n- second\n\tthird";
    const session = new SourceNavigationSession(source, writeDocumentSource(source, ""));
    const third = session.current.blockAt(source.indexOf("third"))!;
    expect(third.index).toBe(3);
    expect(session.current.offsetAt(third.position + 2)).toBe(source.indexOf("third"));
    expect(session.current.outline).toEqual([]);
  });
  it("certifies raw source and its literal projection together, including derived image gates", () => {
    const content = writeDocumentSource(raw, "python");
    expect(isCertifiedBodyMetadata(content.metadata, { ops: content.ops })).toBe(true);
    expect(isCertifiedBodyMetadata({ ...content.metadata, sourceText: "different" }, content as unknown as Record<string, unknown>)).toBe(false);
    const flow = writeDocumentSource("![local](file:///private/image.png)", "flow");
    expect(isCertifiedBodyMetadata(flow.metadata, flow as unknown as Record<string, unknown>)).toBe(false);
  });
  it("infers imported code/diagram types and preserves exact source rather than parsing Markdown", () => {
    for (const [fileName, language] of [["sample.py", "python"], ["sample.mmd", "mermaid"], ["sample.flow", "flow"], ["sample.txt", ""], ["sample.tsx", "typescript"]]) {
      expect(documentLanguageFromFilename(fileName)).toBe(language);
      const content = buildTextImportInput({ fileName, source: raw }, { date: "2026-10-20", mode: "document", storagePath: "ideas" }).content!;
      expect(content.metadata?.sourceLanguage).toBe(language);
      expect(content.metadata?.sourceText).toBe(raw);
    }
  });
});

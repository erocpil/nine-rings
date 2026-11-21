import { expect, test } from "vitest";
import {
  readDocumentSource,
  writeDocumentSource,
} from "../../src/lib/document-source";
import { markdownAST, parseGFM as mdToDelta } from "../../src/lib/gfm-parser";
import { buildMarkdownImportInput } from "../../src/lib/markdown-import";
import {
  deltaToMarkdown,
  noteToMarkdown,
} from "../../src/lib/markdown-serializer";
import { SourceNavigationDocument } from "../../src/lib/markdown-source-navigation";
import { isCertifiedDocumentMetadata } from "../../src/lib/sync/document-metadata-policy";

const header =
  "---\r\n# This is a YAML comment\r\ntitle: 外部标题  \r\ntags: [demo]\r\n...";
const source = `${header}\r\n\r\n# Body\r\n\r\nOriginal\r\n`;

test("YAML front matter stays out of the body and preserves source positions", () => {
  const ast = markdownAST(source);
  expect(ast.children.map((node) => node.type)).toEqual([
    "heading",
    "paragraph",
  ]);
  expect(ast.children[0]?.position?.start).toMatchObject({
    line: 7,
    column: 1,
    offset: source.indexOf("# Body"),
  });
  const document = SourceNavigationDocument.from(source, { ops: [] });
  expect(document.outline.map((item) => item.text)).toEqual(["Body"]);
  expect(document.offsetAt(1)).toBe(source.indexOf("# Body"));
});

test("original header stays ahead of the database title after body edits", () => {
  const imported = buildMarkdownImportInput("sample.md", source, {
    date: "",
    mode: "document",
    storagePath: "reference",
  });
  expect(imported.title).toBe("Body");
  const edited = {
    ...mdToDelta("Changed"),
    metadata: imported.content?.metadata,
  };
  expect(isCertifiedDocumentMetadata(edited.metadata!)).toBe(true);
  expect(deltaToMarkdown(edited)).toBe(`${header}\n\nChanged`);
  expect(noteToMarkdown("Body", edited)).toBe(`${header}\n\n# Body\n\nChanged`);
});

test("source edits can replace or remove the file header", () => {
  const current = writeDocumentSource(source, "markdown");
  expect(readDocumentSource(current)).toBe(source);
  const revision = SourceNavigationDocument.from(source, current);
  expect(
    revision.next("---\ntitle: New\n---\n\n# New body").read().metadata
      ?.markdownFrontMatter,
  ).toBe("---\ntitle: New\n---");
  expect(
    revision.next("# Plain").read().metadata?.markdownFrontMatter,
  ).toBeUndefined();
  expect(
    writeDocumentSource("# Plain", "markdown", current.metadata).metadata
      ?.markdownFrontMatter,
  ).toBeUndefined();
});

test("ordinary separators and incomplete headers remain Markdown", () => {
  for (const input of [
    "---\nOrdinary heading\n---\n",
    "---\ntitle: incomplete\n",
    "\n---\ntitle: ordinary\n---\n",
  ]) {
    expect(mdToDelta(input).metadata?.markdownFrontMatter).toBeUndefined();
    expect(markdownAST(input).children[0]?.type).toBe("thematicBreak");
  }
});

import { expect, test } from "vitest";
import { editorDocumentFromContent } from "../../src/lib/editor-content-model";
import { proseMirrorToDelta } from "../../src/lib/delta-converter";
import {
  codeBlockDisplay,
  blockquoteCaption,
} from "../../src/lib/structured-block-display";

test("persistence roundtrip preserves code content and display attributes", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "codeBlock",
        attrs: {
          language: "javascript",
          title: "sample",
          collapsed: true,
          wrap: false,
        },
        content: [{ type: "text", text: "a\nb" }],
      },
    ],
  };
  const stored = proseMirrorToDelta(doc);
  const result = editorDocumentFromContent(stored)!;
  expect(result.content?.[0].content?.[0].text).toBe("a\nb");
  expect(result.content?.[0].attrs).toMatchObject(doc.content[0].attrs);
  expect(editorDocumentFromContent(doc)).toBe(doc);
  expect(editorDocumentFromContent({ bad: true })).toBeNull();
});
test("readonly overrides and editor defaults use the same display rules without mutating content", () => {
  const attrs = {
    language: "mermaid",
    collapsed: true,
    title: "diagram",
    wrap: false,
  };
  expect(codeBlockDisplay(attrs)).toMatchObject({
    collapsed: true,
    wrap: false,
    isMermaid: true,
    showDiagram: true,
  });
  expect(
    codeBlockDisplay(attrs, { collapsed: false, wrap: true, diagram: false }),
  ).toMatchObject({ collapsed: false, wrap: true, showDiagram: false });
  expect(attrs.collapsed).toBe(true);
  expect(blockquoteCaption(" hello\n world ", true)).toBe("引用 hello world");
});

import { expect, test } from "vitest";
import { prepareMarkdownQuickPreview } from "../../src/lib/markdown-quick-preview";
import { renderedNodeText } from "../../src/lib/markdown-view-position";

test("resolves reference links and footnotes beyond the preview boundary", () => {
  const first = "# Heading\n\n[Link][target] and note[^kept].\n\n";
  const longBlock = "Long body ".repeat(100);
  const source = `${first}${longBlock}\n\nTrailing note[^omitted].\n\n[target]: guide.md#part\n\n[^kept]: Visible footnote\n\n[^omitted]: Hidden footnote`;
  const result = prepareMarkdownQuickPreview(source, 80);
  expect(result.offsets).toEqual([0, first.indexOf("[Link]"), 80]);
  const body = renderedNodeText(result.document);
  expect(body).toContain("Visible footnote");
  expect(body).not.toMatch(/Long body|Hidden footnote|Trailing note/);
  expect(result.document.content?.[1].content?.[0].marks).toContainEqual({
    type: "link",
    attrs: { href: "guide.md#part", title: null },
  });
});

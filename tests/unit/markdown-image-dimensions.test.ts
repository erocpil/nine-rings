import { expect, test } from "vitest";
import { mdToDelta } from "../../src/lib/md-parser";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";
import { deltaToMarkdown } from "../../src/lib/markdown-serializer";
import {
  applyMarkdownLinkEdits,
  planMarkdownLinkEdits,
} from "../../src/lib/local-files/markdown-link-repair";
import { isCertifiedInlineImage } from "../../src/lib/sync/image-body-policy";

test("pixel dimensions, alternative text and link survive the Markdown editor round trip", () => {
  const html =
    '<img src="photo.png" alt="A &#124; B" title="A &amp; B" width="320" height="160">';
  for (const source of [
    html,
    `Before [${html}](details.md) after`,
    `Picture | Description\n--- | ---\n${html} | Example`,
  ]) {
    const original = mdToDelta(source);
    const edited = proseMirrorToDelta(deltaToProseMirror(original));
    const markdown = deltaToMarkdown(edited);
    expect(markdown).toContain(html);
    expect(deltaToProseMirror(mdToDelta(markdown))).toEqual(
      deltaToProseMirror(original),
    );
  }
});

test("retains plain Markdown image syntax and ignores unsupported dimensions and styling", () => {
  expect(deltaToMarkdown(mdToDelta("![Alt](photo.png)"))).toBe(
    "![Alt](photo.png)",
  );
  const parsed = mdToDelta(
    '<img src="photo.png" alt="Alt" width="-5" height="50%" style="width: 96px">',
  );
  expect(deltaToMarkdown(parsed)).toBe("![Alt](photo.png)");
  expect(
    isCertifiedInlineImage(
      {
        src: "/ragdoll-32.png",
        alt: "Alt",
        title: null,
        width: "320px",
        height: 160,
      },
      {},
    ),
  ).toBe(true);
  expect(
    isCertifiedInlineImage(
      { src: "/ragdoll-32.png", alt: "Alt", title: null, height: "160px" },
      {},
    ),
  ).toBe(false);
});

test("file moves update an HTML image URL without changing its dimensions or quoting", () => {
  const source =
    'Before <img width="320" src=\'photos/a&amp;b.png\' height="160" alt="src=untouched"> after';
  const edits = planMarkdownLinkEdits(source, "note.md", [
    { from: "photos/a&b.png", to: "archive/a&b.png" },
  ]);
  expect(applyMarkdownLinkEdits(source, edits)).toBe(
    source.replace("photos/a&amp;b.png", "archive/a%26b.png"),
  );
});

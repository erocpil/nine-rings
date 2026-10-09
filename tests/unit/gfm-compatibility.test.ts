import { EditorState } from "@tiptap/pm/state";
import { footnoteNumberingPlugin } from "../../src/extensions/FootnoteNumbering";
import { describe, expect, it } from "vitest";
import { getSchema, type JSONContent } from "@tiptap/core";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { DocumentStarterKit } from "../../src/extensions/DocumentStarterKit";
import { DocumentLink } from "../../src/extensions/DocumentLink";
import {
  MarkdownImage,
  ResizableImage,
} from "../../src/extensions/ResizableImage";
import { CollapsibleBlockquote } from "../../src/extensions/CollapsibleBlockquote";
import {
  FootnoteDefinition,
  FootnoteReference,
  Footnotes,
  HTMLDetails,
  HTMLStyle,
  HTMLAnchor,
  RawHTML,
  RawHTMLInline,
  InlineHighlight,
  MathBlock,
  MathInline,
} from "../../src/extensions/MarkdownExtras";
import { MarkdownTaskState } from "../../src/extensions/MarkdownTaskState";
import { mdToDelta } from "../../src/lib/md-parser";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";
import { deltaToMarkdown } from "../../src/lib/markdown-serializer";
import { extractPlainText } from "../../src/lib/storage/core";
import fixtures from "../fixtures/gfm-official.json";

const schema = getSchema([
  DocumentStarterKit.configure({ blockquote: false }),
  DocumentLink,
  ResizableImage,
  MarkdownImage,
  CollapsibleBlockquote,
  Table,
  TableRow,
  TableCell,
  TableHeader,
  MarkdownTaskState,
  MathInline,
  MathBlock,
  InlineHighlight,
  HTMLStyle,
  HTMLAnchor,
  RawHTML,
  RawHTMLInline,
  FootnoteReference,
  HTMLDetails,
  FootnoteDefinition,
  Footnotes,
]);
const parse = (source: string) => deltaToProseMirror(mdToDelta(source));
const text = (node: JSONContent): string =>
  node.text ?? (node.content ?? []).map(text).join("");
const nodes = (doc: JSONContent, type: string): JSONContent[] => [
  ...(doc.type === type ? [doc] : []),
  ...(doc.content ?? []).flatMap((child) => nodes(child, type)),
];

function semantic(node: JSONContent): unknown {
  if (node.type === "paragraph" && !node.content?.length) return null;
  if (
    ["rawHtml", "rawHtmlInline"].includes(node.type ?? "") &&
    /^<!--[\s\S]*-->$/.test(String(node.attrs?.source ?? ""))
  )
    return null;
  const fields = [
    "level",
    "language",
    "meta",
    "alert",
    "summary",
    "open",
    "source",
    "id",
    "number",
    "references",
    "src",
    "alt",
    "title",
    "start",
    "taskChecked",
    "tag",
    "href",
    "textAlign",
  ];
  const attrs = Object.fromEntries(
    Object.entries(node.attrs ?? {})
      .filter(
        ([key, value]) =>
          fields.includes(key) &&
          value != null &&
          value !== false &&
          !(key === "start" && value === 1),
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const marks = (node.marks ?? [])
    .map(semantic)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const children: Array<{ type: string; text?: string; marks?: unknown[] }> =
    [];
  for (const child of (node.content ?? [])
    .map(semantic)
    .filter(Boolean) as typeof children) {
    const previous = children.at(-1);
    if (
      previous?.type === "text" &&
      child.type === "text" &&
      JSON.stringify({ ...previous, text: undefined }) ===
        JSON.stringify({ ...child, text: undefined })
    )
      previous.text = (previous.text ?? "") + child.text;
    else children.push(child);
  }
  return {
    type: node.type,
    ...(node.text ? { text: node.text } : {}),
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(marks.length ? { marks } : {}),
    ...(children.length ? { content: children } : {}),
  };
}

describe("standard GFM content integrity", () => {
  it.each(fixtures)(
    "official $id produces valid editable and saved models",
    ({ markdown, section }) => {
      const doc = parse(markdown);
      schema.nodeFromJSON(doc).check();
      schema.nodeFromJSON(deltaToProseMirror(proseMirrorToDelta(doc))).check();
      const exported = parse(deltaToMarkdown(proseMirrorToDelta(doc)));
      schema.nodeFromJSON(exported).check();
      // Arbitrary HTML is deliberately inert; standard Markdown must retain its structure and formatting.
      if (!["HTML blocks", "Raw HTML", "HTML tag filter"].includes(section))
        expect(semantic(exported)).toEqual(semantic(doc));
    },
  );
  it.each([
    "_italic_",
    "*italic*",
    "__bold__",
    "**bold**",
    "~strike~",
    "~~strike~~",
  ])("recognizes delimiters %s", (source) => {
    expect(parse(source).content[0].content?.[0].marks?.length).toBe(1);
  });
  it("preserves code-span spaces and multiline normalization", () => {
    expect(text(parse("`` a ` b ``"))).toBe("a ` b");
    expect(text(parse("`one\ntwo`"))).toBe("one two");
    expect(parse("** spaced **").content[0].content?.[0].marks).toBeUndefined();
  });
  it("recognizes setext, closing ATX markers, indented code and entities", () => {
    expect(parse("Title\n=====").content[0]).toMatchObject({
      type: "heading",
      attrs: { level: 1 },
    });
    expect(text(parse("## Title ##"))).toBe("Title");
    expect(parse("    # literal").content[0].type).toBe("codeBlock");
    expect(text(parse("&amp; &#65;"))).toBe("& A");
  });
  it.each(["first  \nsecond", "first\\\nsecond"])(
    "preserves explicit hard breaks %s",
    (source) => {
      expect(nodes(parse(source), "hardBreak")).toHaveLength(1);
      expect(
        nodes(parse(deltaToMarkdown(parse(source))), "hardBreak"),
      ).toHaveLength(1);
    },
  );
  it("keeps complex list items, tasks, empty items and marker columns", () => {
    const doc = parse(
      "3. [x] first\n\n   explanation\n\n   > quote\n\n   ```js\n   code\n   ```\n\n4. second",
    );
    const list = doc.content[0];
    expect(list.type).toBe("orderedList");
    expect(list.attrs?.start).toBe(3);
    expect(list.content?.[0].attrs?.taskChecked).toBe(true);
    expect(list.content?.[0].content?.map((node) => node.type)).toEqual([
      "paragraph",
      "paragraph",
      "blockquote",
      "codeBlock",
    ]);
    expect(
      parse(deltaToMarkdown(doc)).content[0].content?.[0].content?.map(
        (node) => node.type,
      ),
    ).toEqual(["paragraph", "paragraph", "blockquote", "codeBlock"]);
    expect(parse("-\n- second").content[0].content).toHaveLength(2);
    expect(nodes(parse("- parent\n - sibling"), "bulletList")).toHaveLength(1);
    expect(extractPlainText(proseMirrorToDelta(doc))).toContain("explanation");
  });
  it("preserves links, reference definitions and inline linked images", () => {
    const doc = parse(
      '[label][id] and [![alt](image.png "image title")](https://example.com)\n\n[id]: https://example.com/a_(b) "link title"',
    );
    expect(doc.content[0].content?.[0].marks).toContainEqual({
      type: "link",
      attrs: { href: "https://example.com/a_(b)", title: "link title" },
    });
    const image = nodes(doc, "markdownImage")[0];
    expect(image.attrs).toMatchObject({
      src: "image.png",
      alt: "alt",
      title: "image title",
    });
    expect(image.marks?.[0].type).toBe("link");
    expect(
      nodes(deltaToProseMirror(proseMirrorToDelta(doc)), "markdownImage")[0],
    ).toEqual(image);
    expect(nodes(parse(deltaToMarkdown(doc)), "markdownImage")[0]).toEqual(
      image,
    );
  });
  it("handles optional outer table pipes, column mismatch and br", () => {
    expect(parse("A | B\n--- | ---\nx | y").content[0].type).toBe("table");
    expect(parse("A | B\n---\nx | y").content[0].type).not.toBe("table");
    const doc = parse("| A |\n| - |\n| `a \\| b`<br>end |");
    expect(nodes(doc, "hardBreak")).toHaveLength(1);
    expect(nodes(parse(deltaToMarkdown(doc)), "hardBreak")).toHaveLength(1);
  });
  it("numbers named/Unicode footnotes and gives every occurrence a return target", () => {
    const doc = parse(
      "first[^中文] again[^中文] last[^other]\n\n[^other]: second\n\n[^中文]: first\n\n    another paragraph",
    );
    const refs = nodes(doc, "text")
      .flatMap((node) => node.marks ?? [])
      .filter((mark) => mark.type === "footnoteReference");
    expect(
      refs.map((mark) => [mark.attrs?.number, mark.attrs?.occurrence]),
    ).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
    ]);
    const definition = nodes(doc, "footnoteDefinition")[0];
    expect(definition.attrs).toMatchObject({ id: "中文", references: 2 });
    expect(definition.content).toHaveLength(2);
    expect(
      nodes(parse("\\[^中文]\n\n[^中文]: literal"), "text").flatMap(
        (node) => node.marks ?? [],
      ),
    ).toEqual([]);
  });
  it("updates reference labels and backlinks after deleting the first citation", () => {
    let state = EditorState.create({
      schema,
      doc: schema.nodeFromJSON(
        parse("a[^one] b[^two] c[^two]\n\n[^one]: first\n\n[^two]: second"),
      ),
      plugins: [footnoteNumberingPlugin()],
    });
    let position = 0;
    state.doc.descendants((node, pos) => {
      if (
        node.marks.some(
          (mark) =>
            mark.type.name === "footnoteReference" && mark.attrs.id === "one",
        )
      )
        position = pos;
    });
    state = state.applyTransaction(
      state.tr.delete(position, position + 1),
    ).state;
    const doc = state.doc.toJSON();
    const refs = nodes(doc, "text")
      .flatMap((node) => node.marks ?? [])
      .filter((mark) => mark.type === "footnoteReference");
    expect(
      refs.map((mark) => [mark.attrs?.number, mark.attrs?.occurrence]),
    ).toEqual([
      [1, 1],
      [1, 2],
    ]);
    expect(
      nodes(doc, "footnoteDefinition").find((node) => node.attrs?.id === "two")
        ?.attrs,
    ).toMatchObject({ number: 1, references: 2 });
    expect(
      nodes(doc, "footnoteDefinition").find((node) => node.attrs?.id === "one")
        ?.attrs?.references,
    ).toBe(0);
  });
  it("supports safe HTML, nested details and math fences without activating arbitrary HTML", () => {
    expect(
      parse("<mark>hi</mark>").content[0].content?.[0].marks?.[0].type,
    ).toBe("inlineHighlight");
    expect(
      nodes(
        parse(
          "<details>\n\n<summary>outer</summary>\n\n<details><summary>inner</summary>\n\nbody\n</details>\n</details>",
        ),
        "htmlDetails",
      ),
    ).toHaveLength(2);
    expect(parse("```math\nx^2\n```").content[0].type).toBe("mathBlock");
    expect(text(nodes(parse("$`x^2`$"), "mathInline")[0])).toBe("");
    expect(nodes(parse("$`x^2`$"), "mathInline")[0].attrs?.source).toBe("x^2");
    expect(parse("<script>alert(1)</script>").content[0].type).toBe("rawHtml");
    expect(parse("> [!WARNING]\n> caution").content[0].attrs?.alert).toBe(
      "WARNING",
    );
    expect(
      parse(deltaToMarkdown(parse("> [!NOTE]\n> note"))).content[0].attrs
        ?.alert,
    ).toBe("NOTE");
  });
});

it("maps complex list paragraphs and formulas using the same rendered/source weights", async () => {
  const { sourcePositionMap, renderedPositionMap, weightToSourceOffset } =
    await import("../../src/lib/markdown-view-position");
  const source =
    "- first\n\n  explanation\n\n  > nested\n\n  ```js\n  code\n  ```\n\nafter $x^2$\n\n![alt](image.png)";
  const map = sourcePositionMap(source);
  const rendered = renderedPositionMap(parse(source));
  expect(map.at(-1)?.weightTo).toBe(rendered.at(-1)?.to);
  expect(weightToSourceOffset(source, 5, map)).toBe(
    source.indexOf("  explanation"),
  );
});

it("preserves spaces around parenthesized formula extensions", () => {
  const doc = parse("before \\(x\\) after");
  expect(text(doc)).toBe("before  after");
  expect(nodes(doc, "mathInline")[0].attrs?.source).toBe("x");
  expect(parse(deltaToMarkdown(doc))).toEqual(doc);
});

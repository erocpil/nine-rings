import { expect, it } from "vitest";
import { fontSizePixels } from "../../src/lib/font-size";
import {
  proseMirrorToDelta,
  deltaToProseMirror,
  pxToNamed,
} from "../../src/lib/delta-converter";
import { deltaToMarkdown } from "../../src/lib/markdown-serializer";
import { mdToDelta } from "../../src/lib/md-parser";
it("rejects clipboard CSS keywords instead of promoting NaN to huge after reload", () => {
  for (const value of [
    "medium",
    "inherit",
    "initial",
    "normal",
    "1.2em",
    "100%",
    "var(--font)",
    "NaN",
    Infinity,
    0,
  ])
    expect(fontSizePixels(value)).toBeUndefined();
  expect(fontSizePixels("12pt")).toBe(16);
  expect(fontSizePixels("18px")).toBe(18);
  expect(pxToNamed(NaN)).toBe("normal");
  const delta = proseMirrorToDelta({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "还可以表示",
            marks: [
              {
                type: "textStyle",
                attrs: { fontSize: "medium", color: "#000000" },
              },
            ],
          },
        ],
      },
    ],
  });
  expect(delta.ops[0].attributes?.size).toBeUndefined();
  expect(deltaToProseMirror(delta).content?.[0].content?.[0].marks).toEqual([
    { type: "textStyle", attrs: { color: "#000000" } },
  ]);
});
it("moves edge whitespace outside strong/italic delimiters without escaping the adjacent Chinese text", () => {
  for (const type of ["bold", "italic"]) {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: " 某项努力证明是值得的。 ",
              marks: [{ type }],
            },
            { type: "text", text: "还可以表示还清债务。" },
          ],
        },
      ],
    };
    const source = deltaToMarkdown(doc);
    expect(source).not.toMatch(/&#(?:x8fd8|36824);/i);
    expect(source).not.toContain("\\*");
    expect(source).toContain(
      type === "bold"
        ? "**某项努力证明是值得的。** 还"
        : "*某项努力证明是值得的。* 还",
    );
    const loaded = mdToDelta(source);
    expect(
      loaded.ops
        .filter((op) => op.attributes?.[type])
        .map((op) => op.insert)
        .join(""),
    ).toBe("某项努力证明是值得的。");
  }
});

it("keeps unspaced Han neighbours readable using the same CJK attention rule as the parser", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "某项努力证明是值得的。",
            marks: [{ type: "bold" }],
          },
          { type: "text", text: "还可以表示还清债务。" },
        ],
      },
    ],
  };
  const source = deltaToMarkdown(doc);
  expect(source).toBe("**某项努力证明是值得的。**还可以表示还清债务。");
  expect(mdToDelta(source).ops[0].attributes?.bold).toBe(true);
});

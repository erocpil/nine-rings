import { expect, it } from "vitest";
import { validateParameterValues } from "../../src/lib/plugin-system/command-parameters";
import {
  IMAGE_FIELDS,
  imageCommandMarkdown,
} from "../../src/lib/plugin-system/image-command";
import { mdToDelta } from "../../src/lib/md-parser";
import { deltaToProseMirror } from "../../src/lib/delta-converter";
it("validates defaults, required values, enum choices and rejects unknown parameters", () => {
  const values = validateParameterValues(IMAGE_FIELDS, {});
  expect(values.src).toBe("/icon-192.svg");
  for (const bad of [
    { kind: "script" },
    { src: "" },
    { unexpected: true },
    { alt: "x".repeat(513) },
  ])
    expect(() => validateParameterValues(IMAGE_FIELDS, bad)).toThrow();
  const fields = [
    {
      id: "count",
      label: "数量",
      type: "number" as const,
      default: 1,
      min: 1,
      max: 5,
    },
    { id: "flag", label: "开关", type: "boolean" as const, default: false },
  ];
  expect(() => validateParameterValues(fields, { count: NaN })).toThrow();
  expect(() => validateParameterValues(fields, { flag: "true" })).toThrow();
});
it("all image variants preserve src, alt and title through Markdown parsing", () => {
  for (const kind of ["block", "inline", "reference", "linked"]) {
    const values = validateParameterValues(IMAGE_FIELDS, {
      kind,
      alt: "说明 [括号]",
      title: '标题 "引号"',
    });
    const markdown = imageCommandMarkdown(values);
    const doc = JSON.stringify(deltaToProseMirror(mdToDelta(markdown)));
    expect(doc).toContain("/icon-192.svg");
    expect(doc).toContain("说明 [括号]");
    expect(doc).toContain('标题 \\"引号\\"');
    if (kind === "linked")
      expect(doc).toContain("https://github.github.com/gfm/");
    if (kind === "inline") expect(doc).toContain("markdownImage");
  }
});
it("rejects executable/unsafe addresses and malformed reference labels before editor insertion", () => {
  for (const src of [
    "javascript:alert(1)",
    "file:///tmp/private",
    "data:text/html,evil",
    "<broken>",
  ])
    expect(() =>
      imageCommandMarkdown(validateParameterValues(IMAGE_FIELDS, { src })),
    ).toThrow();
  expect(() =>
    imageCommandMarkdown(
      validateParameterValues(IMAGE_FIELDS, {
        kind: "reference",
        reference: "bad]",
      }),
    ),
  ).toThrow();
});

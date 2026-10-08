import { expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { flowParts } from "../../src/lib/flow-block";
import { mdToDelta } from "../../src/lib/md-parser";
import { deltaToMarkdown } from "../../src/lib/markdown-serializer";
import { deltaToProseMirror } from "../../src/lib/delta-converter";
import { codeBlockDisplay } from "../../src/lib/structured-block-display";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: {},
    paragraph: { group: "block", content: "text*" },
    heading: {
      group: "block",
      content: "text*",
      attrs: { level: { default: 2 } },
    },
    blockquote: { group: "block", content: "paragraph+" },
    footnotes: { group: "block", content: "paragraph+" },
  },
});
const p = () => schema.node("paragraph", null, schema.text("body"));
const h = (level: number) =>
  schema.node("heading", { level }, schema.text("heading"));

it("keeps quotes and subheadings on one track, ending at parent headings and footnotes", () => {
  const doc = schema.node("doc", null, [
    h(1),
    h(2),
    p(),
    schema.node("blockquote", null, p()),
    h(3),
    p(),
    h(2),
    p(),
    h(1),
    p(),
    h(2),
    schema.node("footnotes", null, p()),
  ]);
  const parts = flowParts(doc);
  expect(parts.map((part) => part.kind)).toEqual([
    "text",
    "stages",
    "text",
    "stages",
    "text",
  ]);
  expect(
    parts[1].kind === "stages" &&
      parts[1].stages.map((stage) => stage.body.length),
  ).toEqual([4, 1]);
});
it("uses the shallowest headings when no H2 exists and leaves headingless Markdown readable", () => {
  for (const level of [1, 3, 4, 5, 6]) {
    const parts = flowParts(
      schema.node("doc", null, [h(level), p(), h(level), p()]),
    );
    expect(parts[0].kind === "stages" && parts[0].stages.length).toBe(2);
  }
  expect(flowParts(schema.node("doc", null, p()))[0].kind).toBe("text");
});
it("flow fences round-trip source and nested code without becoming document headings", () => {
  const source =
    "## Stage\n\n> Quote\n\n```js\nconst n = 1;\n```\n\n### Branch\n\n- [ ] task";
  const delta = mdToDelta(
    `before\n\n\`\`\`\`flow\n${source}\n\`\`\`\`\n\nafter`,
  );
  const doc = deltaToProseMirror(delta);
  const block = doc.content?.find((node) => node.type === "codeBlock");
  expect(block?.attrs?.language).toBe("flow");
  expect(block?.content?.[0].text).toBe(source);
  expect(deltaToProseMirror(mdToDelta(deltaToMarkdown(delta)))).toEqual(doc);
  expect(codeBlockDisplay({ language: "flow" })).toMatchObject({
    isFlow: true,
    showFlow: true,
    showDiagram: false,
  });
  expect(
    codeBlockDisplay({ language: "flow" }, { diagram: false }),
  ).toMatchObject({ showFlow: false });
});

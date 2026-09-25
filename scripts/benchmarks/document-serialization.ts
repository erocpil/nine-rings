import { performance } from "node:perf_hooks";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { DocumentStarterKit } from "../../src/extensions/DocumentStarterKit";
import { proseMirrorToDelta } from "../../src/lib/delta-converter";
import { IncrementalDocumentSerializer } from "../../src/lib/incremental-document-serializer";
import assert from "node:assert/strict";
const schema = getSchema([DocumentStarterKit]);
for (const blocks of [300, 1500, 5000]) {
  let state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(
      {},
      Array.from({ length: blocks }, (_, i) =>
        i % 5 === 0
          ? schema.nodes.codeBlock.create(
              {},
              schema.text(
                Array.from(
                  { length: 40 },
                  (_, n) => `const value${n} = ${i};`,
                ).join("\n"),
              ),
            )
          : schema.nodes.paragraph.create(
              {},
              schema.text(`段落 ${i}: ${"long document 中文内容 ".repeat(12)}`),
            ),
      ),
    ),
  });
  const serializer = new IncrementalDocumentSerializer();
  const coldStart = performance.now();
  serializer.read(state.doc);
  const coldMs = performance.now() - coldStart;
  const full: number[] = [],
    incremental: number[] = [];
  for (let i = 0; i < 30; i++) {
    state = state.apply(state.tr.insertText("x", 2));
    const a = performance.now(),
      expected = proseMirrorToDelta(state.doc.toJSON());
    full.push(performance.now() - a);
    const b = performance.now(),
      actual = serializer.read(state.doc).delta;
    incremental.push(performance.now() - b);
    assert.deepEqual(actual, expected);
  }
  const median = (values: number[]) =>
    values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  console.log(
    JSON.stringify({
      blocks,
      coldMs,
      fullMedianMs: median(full),
      incrementalMedianMs: median(incremental),
      convertedBlocks: serializer.convertedBlocks,
    }),
  );
}

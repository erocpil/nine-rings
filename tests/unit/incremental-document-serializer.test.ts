import { expect, test } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { DocumentStarterKit } from "../../src/extensions/DocumentStarterKit";
import { proseMirrorToDelta } from "../../src/lib/delta-converter";
import { IncrementalDocumentSerializer } from "../../src/lib/incremental-document-serializer";

const schema = getSchema([DocumentStarterKit]);
const paragraph = (text: string) =>
  schema.nodes.paragraph.create({}, schema.text(text));
test("incremental snapshots equal full conversion through edits, insertions, deletions, formatting and undo", () => {
  const serializer = new IncrementalDocumentSerializer();
  let state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create({}, [
      paragraph("before"),
      schema.nodes.codeBlock.create(
        { language: "mermaid" },
        schema.text("flowchart TD\nA --> B"),
      ),
      paragraph("after"),
    ]),
  });
  const original = state.doc;
  const check = () => {
    const result = serializer.read(state.doc);
    expect(result.json).toEqual(state.doc.toJSON());
    expect(result.delta).toEqual(proseMirrorToDelta(state.doc.toJSON()));
  };
  check();
  expect(serializer.convertedBlocks).toBe(3);
  state = state.apply(state.tr.insertText("!", 2));
  check();
  expect(serializer.convertedBlocks).toBe(4);
  state = state.apply(state.tr.insert(0, paragraph("added")));
  check();
  state = state.apply(state.tr.delete(0, state.doc.firstChild!.nodeSize));
  check();
  state = state.apply(state.tr.addMark(1, 3, schema.marks.bold.create()));
  check();
  expect(serializer.read(original).delta).toEqual(
    proseMirrorToDelta(original.toJSON()),
  );
  expect(serializer.read(original)).toBe(serializer.read(original));
});
test("large document only converts the changed block; old delayed readers keep their snapshot", () => {
  const serializer = new IncrementalDocumentSerializer();
  const doc = schema.nodes.doc.create(
    {},
    Array.from({ length: 1500 }, (_, i) => paragraph(`block ${i}`)),
  );
  const before = serializer.read(doc);
  const state = EditorState.create({ schema, doc });
  const next = state.tr.insertText("新", 4).doc;
  serializer.read(next);
  expect(serializer.convertedBlocks).toBe(1501);
  expect(serializer.read(doc)).toBe(before);
  expect(before.delta).toEqual(proseMirrorToDelta(doc.toJSON()));
});

test("nested lists and quote snapshots match the existing persistence contract", () => {
  const serializer = new IncrementalDocumentSerializer();
  const item = schema.nodes.listItem.create({}, [
    paragraph("中文😀"),
    schema.nodes.bulletList.create({}, [
      schema.nodes.listItem.create({}, paragraph("nested")),
    ]),
  ]);
  let state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create({}, [
      schema.nodes.orderedList.create({ start: 15 }, [item]),
      schema.nodes.blockquote.create({}, [
        paragraph("first"),
        paragraph("second"),
      ]),
    ]),
  });
  for (let i = 0; i < 20; i++) {
    state = state.apply(state.tr.insertText("字", 4));
    expect(serializer.read(state.doc).delta).toEqual(
      proseMirrorToDelta(state.doc.toJSON()),
    );
  }
});

import { expect, test } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { DocumentStarterKit } from "../../src/extensions/DocumentStarterKit";
import { workspaceTransaction } from "../../src/lib/block-workspace-sync";

function fixture() {
  const schema = getSchema([DocumentStarterKit]);
  const localSchema = getSchema([DocumentStarterKit]);
  const code = schema.nodes.codeBlock.create({}, schema.text("original"));
  const prefix = schema.nodes.paragraph.create({}, schema.text("before"));
  const suffix = schema.nodes.paragraph.create({}, schema.text("after"));
  const source = EditorState.create({
    schema,
    doc: schema.nodes.doc.create({}, [prefix, code, suffix]),
  });
  const local = EditorState.create({
    schema: localSchema,
    doc: localSchema.nodeFromJSON({ type: "doc", content: [code.toJSON()] }),
  });
  return { source, local, code, position: prefix.nodeSize };
}
test("workspace translates a separate-schema edit and keeps neighbouring blocks intact", () => {
  const { source, local, code, position } = fixture();
  const tr = workspaceTransaction(
    source,
    position,
    code,
    local.tr.insertText("!", 2),
  );
  expect(tr.doc.child(0).eq(source.doc.child(0))).toBe(true);
  expect(tr.doc.child(1).textContent).toBe("o!riginal");
  expect(tr.doc.child(2).eq(source.doc.child(2))).toBe(true);
});
test("same-block external changes reject stale edits without modifying source", () => {
  const { source, local, code, position } = fixture();
  const newer = source.apply(source.tr.insertText("remote", position + 1));
  expect(() =>
    workspaceTransaction(newer, position, code, local.tr.insertText("!", 2)),
  ).toThrow("原块已更新");
  expect(newer.doc.child(1).textContent).toBe("remoteoriginal");
});
test("changes before the block can be mapped without invalidating its baseline", () => {
  const { source, local, code, position } = fixture();
  const external = source.tr.insertText("prefix", 1);
  const newer = source.apply(external);
  const tr = workspaceTransaction(
    newer,
    external.mapping.map(position, 1),
    code,
    local.tr.insertText("!", 2),
  );
  expect(tr.doc.child(0).textContent).toBe("prefixbefore");
  expect(tr.doc.child(1).textContent).toBe("o!riginal");
});
test("a stale local mirror is rejected even when the source base is current", () => {
  const { source, local, position } = fixture();
  const newer = source.apply(source.tr.insertText("remote", position + 1));
  expect(() =>
    workspaceTransaction(
      newer,
      position,
      newer.doc.child(1),
      local.tr.insertText("!", 2),
    ),
  ).toThrow("原块已更新");
});
test("workspace cannot replace the block with another type", () => {
  const { source, local, code, position } = fixture();
  expect(() =>
    workspaceTransaction(
      source,
      position,
      code,
      local.tr.setNodeMarkup(0, local.schema.nodes.paragraph),
    ),
  ).toThrow("边界");
});

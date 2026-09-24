import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Step, StepMap } from "@tiptap/pm/transform";

/** Compare against the immutable block snapshot on which the draft was based.
 * Changes elsewhere are harmless; edits of this block require a fresh base. */
export function blockBaselineMatches(doc: PMNode, position: number, base: PMNode): boolean {
  if (position < 0 || position >= doc.content.size) return false;
  const current = doc.nodeAt(position);
  return !!current && current.eq(base);
}

/** Build atomically, validating both the base and the complete result before
 * dispatch. The workspace cannot modify adjacent blocks via a boundary step. */
export function workspaceTransaction(
  source: EditorState, position: number, base: PMNode, local: Transaction,
): Transaction {
  const before = local.before.firstChild && source.schema.nodeFromJSON(local.before.firstChild.toJSON());
  if (!blockBaselineMatches(source.doc, position, base) || !before?.eq(base))
    throw new Error("原块已更新，请重新载入后编辑。");
  const expectedBlock = local.doc.firstChild && source.schema.nodeFromJSON(local.doc.firstChild.toJSON());
  if (local.doc.childCount !== 1 || expectedBlock?.type !== base.type)
    throw new Error("块工作区不能改变块的边界。");
  const result = source.tr;
  for (const step of local.steps) {
    const mapped = Step.fromJSON(source.schema, step.toJSON()).map(StepMap.offset(position));
    if (!mapped) throw new Error("编辑位置已失效。");
    result.step(mapped);
  }
  const expected = source.tr.replaceWith(position, position + base.nodeSize, expectedBlock).doc;
  if (!result.doc.eq(expected)) throw new Error("编辑超出当前块范围。");
  return result;
}

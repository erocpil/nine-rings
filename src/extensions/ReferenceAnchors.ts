import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { DocumentReferenceAnchor } from "../types/models";

interface Snapshot { doc: PMNode; anchors: DocumentReferenceAnchor[] }
interface State { anchors: DocumentReferenceAnchor[]; history: Snapshot[] }
export const referenceAnchorPluginKey = new PluginKey<State>("referenceAnchors");

export function referenceAnchorPlugin(initial: DocumentReferenceAnchor[], onChange?: (anchors: DocumentReferenceAnchor[], doc: PMNode, docChanged: boolean) => void) {
  return new Plugin<State>({
    key: referenceAnchorPluginKey,
    state: {
      init: (_, state) => ({ anchors: initial.filter(anchor => Number.isInteger(anchor.from) && Number.isInteger(anchor.to) && anchor.from >= 0 && anchor.to >= anchor.from && anchor.to <= state.doc.content.size), history: [] }),
      apply(tr, previous, old, next) {
        const added = tr.getMeta(referenceAnchorPluginKey) as DocumentReferenceAnchor | DocumentReferenceAnchor[] | undefined;
        if (!added && previous.anchors.length === 0) return previous;
        if (!tr.docChanged && !added) return previous;
        const restored = tr.docChanged ? previous.history.find(snapshot => snapshot.doc.eq(next.doc)) : undefined;
        let anchors = tr.docChanged ? previous.anchors.map(anchor => {
          const archived = restored?.anchors.find(item => item.id === anchor.id);
          if (archived) return archived;
          const from = tr.mapping.mapResult(anchor.from, 1);
          const to = tr.mapping.mapResult(anchor.to, anchor.to === anchor.from ? 1 : -1);
          // Moving a block is a delete + insert transaction. Follow an unchanged
          // unique block, but never guess between duplicate copies or revive a
          // target that was deleted in an earlier edit.
          if (!anchor.deleted && (from.deletedAcross || to.pos <= from.pos)) {
            const resolved = old.doc.resolve(anchor.from);
            const blockStart = resolved.depth ? resolved.before(1) : anchor.from;
            const block = old.doc.nodeAt(blockStart);
            const candidates: number[] = [];
            if (block) next.doc.forEach((node, pos) => { if (node.eq(block)) candidates.push(pos); });
            if (candidates.length === 1) return { ...anchor, from: candidates[0] + anchor.from - blockStart, to: candidates[0] + anchor.to - blockStart };
          }
          return { ...anchor, from: from.pos, to: Math.max(from.pos, to.pos), ...(anchor.deleted || from.deletedAcross || (anchor.to > anchor.from && to.pos <= from.pos) ? { deleted: true } : {}) };
        }) : previous.anchors;
        if (added) {
          const additions = Array.isArray(added) ? added : [added];
          anchors = [...anchors.filter(item => !additions.some(addition => addition.id === item.id)), ...additions];
        }
        return { anchors, history: tr.docChanged ? [{ doc: old.doc, anchors: previous.anchors }, ...previous.history].slice(0, 12) : previous.history };
      },
    },
    view(view) {
      let previous = referenceAnchorPluginKey.getState(view.state)?.anchors;
      let previousDoc = view.state.doc;
      return { update(view) {
        const docChanged = previousDoc !== view.state.doc;
        previousDoc = view.state.doc;
        const anchors = referenceAnchorPluginKey.getState(view.state)?.anchors;
        if (anchors && anchors !== previous) { previous = anchors; onChange?.(anchors, view.state.doc, docChanged); }
      } };
    },
  });
}

export const ReferenceAnchors = Extension.create<{ initial: DocumentReferenceAnchor[]; onChange?: (anchors: DocumentReferenceAnchor[], doc: PMNode, docChanged: boolean) => void }>({
  name: "referenceAnchors",
  addOptions() { return { initial: [] }; },
  addProseMirrorPlugins() { return [referenceAnchorPlugin(this.options.initial, this.options.onChange)]; },
});

export function createReferenceAnchor(editor: Editor, kind: "block" | "position", position?: number): DocumentReferenceAnchor {
  const { doc, selection } = editor.state;
  const anchor = referenceAnchorAt(doc, kind, position ?? selection.from, position ?? selection.to);
  const existing = referenceAnchorPluginKey.getState(editor.state)?.anchors.find(item => !item.deleted && item.kind === anchor.kind && item.from === anchor.from && item.to === anchor.to);
  if (existing) return existing;
  editor.view.dispatch(editor.state.tr.setMeta(referenceAnchorPluginKey, anchor).setMeta("addToHistory", false));
  return anchor;
}

export function referenceAnchorAt(doc: PMNode, kind: "block" | "position", start: number, end = start): DocumentReferenceAnchor {
  let from = start, to = end;
  if (kind === "block") {
    const resolved = doc.resolve(from);
    from = resolved.depth ? resolved.before(1) : from;
    to = from + (doc.nodeAt(from)?.nodeSize ?? 0);
  }
  const targetKind = kind === "block" ? "block" : from === to ? "position" : "range";
  const preview = (from === to ? doc.resolve(from).parent.textContent : doc.textBetween(from, to, " ")).replace(/\s+/g, " ").trim().slice(0, 80) || "引用位置";
  const anchor: DocumentReferenceAnchor = { id: crypto.randomUUID(), kind: targetKind, from, to, preview };
  return anchor;
}

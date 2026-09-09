import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node } from "@tiptap/pm/model";

export const headingFoldAnchorsKey = new PluginKey<DecorationSet>(
  "headingFoldAnchors",
);

/** ProseMirror owns the hosts, so controls are not parsed as document text. */
export function headingFoldAnchors(hosts: Map<number, HTMLElement>) {
  let sequence = 0;
  type Anchor = { key: number; pos: number; host?: HTMLElement };
  const anchors = new WeakMap<Node, Anchor[]>();
  const build = (doc: Node) => {
    const decorations: Decoration[] = [];
    const occurrences = new Map<Node, number>();
    hosts.clear();
    doc.forEach((node, pos) => {
      if (node.type.name !== "heading") return;
      const occurrence = occurrences.get(node) ?? 0;
      occurrences.set(node, occurrence + 1);
      const records = anchors.get(node) ?? [];
      const anchor = records[occurrence] ?? { key: ++sequence, pos };
      records[occurrence] = anchor;
      anchors.set(node, records);
      anchor.pos = pos;
      if (anchor.host) hosts.set(pos, anchor.host);
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: "editor-fold-anchor",
        }),
      );
      decorations.push(
        Decoration.widget(
          pos + 1,
          () => {
            const host = document.createElement("span");
            host.className = "editor-fold-host";
            host.setAttribute("data-pdf-exclude", "");
            host.contentEditable = "false";
            anchor.host = host;
            hosts.set(anchor.pos, host);
            return host;
          },
          {
            key: `heading-fold-host-${anchor.key}`,
            side: -1,
            ignoreSelection: true,
            stopEvent: () => true,
            destroy: (dom) => {
              if (hosts.get(anchor.pos) === dom) hosts.delete(anchor.pos);
              if (anchor.host === dom) anchor.host = undefined;
            },
          },
        ),
      );
    });
    return DecorationSet.create(doc, decorations);
  };
  return new Plugin<DecorationSet>({
    key: headingFoldAnchorsKey,
    state: {
      init: (_, state) => build(state.doc),
      apply: (tr, current) => (tr.docChanged ? build(tr.doc) : current),
    },
    props: { decorations: (state) => headingFoldAnchorsKey.getState(state) },
  });
}

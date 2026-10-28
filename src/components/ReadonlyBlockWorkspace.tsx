import { useMemo } from "react";
import { useEditor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { markdownReadingExtensions } from "./FlowBlockContent";
import { BlockWorkspace } from "./BlockWorkspace";

/** A bounded, disposable read-only adapter for the existing block workspace.
 * Only the current block and its neighbours are projected; no file writes or
 * database identity are exposed to the workspace editor. */
export function ReadonlyBlockWorkspace({ doc, position, trigger, onClose, onNavigate, highlightActiveLine }: {
  doc: PMNode; position: number; trigger: HTMLElement; onClose: () => void;
  onNavigate: (position: number) => void; highlightActiveLine: boolean;
}) {
  const projection = useMemo(() => {
    const target = doc.nodeAt(position)!;
    const peers: Array<{ node: PMNode; position: number }> = [];
    doc.descendants((node, at) => {
      if (node.type.name === target.type.name && (target.type.name !== "codeBlock" || node.attrs.language === target.attrs.language)) peers.push({ node, position: at });
    });
    const index = Math.max(0, peers.findIndex(peer => peer.position === position));
    const neighbours = peers.slice(Math.max(0, index - 1), index + 2);
    let offset = 0;
    const ranges = neighbours.map(peer => { const range = { from: offset, to: offset + peer.node.nodeSize, original: peer.position }; offset = range.to; return range; });
    return { content: { type: "doc", content: neighbours.map(peer => peer.node.toJSON()) }, ranges, position: ranges.find(range => range.original === position)?.from ?? 0 };
  }, [doc, position]);
  const extensions = useMemo(markdownReadingExtensions, []);
  const editor = useEditor({ extensions, content: projection.content, editable: false, injectCSS: false });
  const request = useMemo(() => ({ position: projection.position, trigger }), [projection.position, trigger]);
  return editor && <BlockWorkspace source={editor} readonly highlightActiveLine={highlightActiveLine} request={request} onClose={onClose}
    onNavigate={at => {
      const range = projection.ranges.find(range => range.from <= at && at < range.to);
      if (range) onNavigate(range.original + at - range.from);
    }} />;
}

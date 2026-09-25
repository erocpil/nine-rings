import type { Node } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/core";
import type { DeltaOps } from "../types/models";
import { proseMirrorToDelta } from "./delta-converter";

type Projection = { json: JSONContent; delta: DeltaOps };

/** Per editor session. Node identity is the invalidation key, including attrs
 * and marks. Weak references do not retain discarded undo history/documents. */
export class IncrementalDocumentSerializer {
  private blocks = new WeakMap<Node, Projection>();
  private documents = new WeakMap<Node, Projection>();
  convertedBlocks = 0;

  read(doc: Node): Projection {
    const known = this.documents.get(doc);
    if (known) return known;
    const content: JSONContent[] = [],
      ops: DeltaOps["ops"] = [];
    doc.forEach((block) => {
      let cached = this.blocks.get(block);
      if (!cached) {
        const json = block.toJSON() as JSONContent;
        cached = {
          json,
          delta: proseMirrorToDelta({ type: "doc", content: [json] }),
        };
        this.blocks.set(block, cached);
        this.convertedBlocks++;
      }
      content.push(cached.json);
      // Avoid argument-count limits on very large code/list blocks.
      for (const op of cached.delta.ops) ops.push(op);
    });
    const json: JSONContent = { type: doc.type.name };
    if (Object.keys(doc.attrs).length) json.attrs = doc.attrs;
    if (doc.marks.length) json.marks = doc.marks.map((mark) => mark.toJSON());
    if (doc.childCount) json.content = content;
    const result = { json, delta: { ops } };
    this.documents.set(doc, result);
    return result;
  }
}

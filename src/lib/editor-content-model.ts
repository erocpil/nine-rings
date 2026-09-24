import type { JSONContent } from "@tiptap/core";
import { deltaToProseMirror, isDelta, isProseMirror } from "./delta-converter";

/** Delta is authoritative at rest; the source EditorState is authoritative
 * during editing. Readonly/workspace views must derive from that state.
 * Accept legacy PM snapshots only at the import/hydration boundary. */
export function editorDocumentFromContent(content: unknown): JSONContent | null {
  if (isProseMirror(content)) return content;
  if (isDelta(content)) return deltaToProseMirror(content);
  return null;
}

import { Extension, type Editor } from "@tiptap/core";
import {
  readingBlockSession,
  type ReadingBlockState,
} from "../lib/reading-block-session";

const editorSessions = new WeakMap<Editor, Map<number, ReadingBlockState>>();

export const ReadingBlockSession = Extension.create<{
  noteId: string;
  version: string;
  sensitive: boolean;
  states?: Map<number, ReadingBlockState>;
}>({
  name: "readingBlockSession",
  addOptions: () => ({ noteId: "", version: "", sensitive: false }),
  onBeforeCreate() {
    const { noteId, version, sensitive, states } = this.options;
    const blocks = states ?? (sensitive
      ? new Map<number, ReadingBlockState>()
      : readingBlockSession(noteId, version));
    editorSessions.set(this.editor, blocks);
  },
});

export function editorReadingBlocks(editor: Editor) {
  return editorSessions.get(editor);
}

import type { JSONContent } from "@tiptap/core";
import { deltaToProseMirror } from "../delta-converter";
import { writeDocumentSource } from "../document-source";

interface LocalMarkdownViewSwitch {
  rendered: boolean;
  readSource(): string;
  position: {
    toRendered(source: string, doc: JSONContent): void;
    toSource(source: string, doc: JSONContent, sourceTop?: number, selection?: number): void;
  };
  readRenderedSelection(): number | undefined;
  prepareSource?(source: string): void;
  persist(): void;
}

export function prepareLocalMarkdownView({
  rendered, readSource, position, readRenderedSelection, prepareSource, persist,
}: LocalMarkdownViewSwitch): void {
  const source = readSource();
  const doc = deltaToProseMirror(writeDocumentSource(source, "markdown"));
  const selection = rendered ? undefined : readRenderedSelection();
  if (!rendered) prepareSource?.(source);
  persist();
  if (rendered) position.toRendered(source, doc);
  else position.toSource(source, doc, undefined, selection);
}

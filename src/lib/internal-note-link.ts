/** Links to a document's stable ID, independent of its title or folder. */
export function internalNoteId(href: string): string | null {
  return /^nr-note:\/\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(href)?.[1] ?? null;
}

/** Links to a document's stable ID, independent of its title or folder. */
export function internalNoteId(href: string): string | null {
  return /^nr-note:\/\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:#nr-ref-[0-9a-f-]+)?$/i.exec(href)?.[1] ?? null;
}

export function internalReferenceId(href: string): string | null {
  return internalNoteId(href) ? /#nr-ref-([0-9a-f-]+)$/i.exec(href)?.[1] ?? null : null;
}

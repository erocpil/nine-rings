type ProseMirrorJson = Record<string, unknown>;

interface EditorSessionEntry {
  revision: string;
  document: ProseMirrorJson;
}

// Two entries cover the common A → B → A workflow without keeping multiple
// live TipTap editors (and their DOM/event state) resident on memory-limited iOS.
const MAX_EDITOR_SESSIONS = 2;
const sessions = new Map<string, EditorSessionEntry>();

export function getCachedEditorDocument(noteId: string, revision: string): ProseMirrorJson | null {
  const entry = sessions.get(noteId);
  if (!entry || entry.revision !== revision) return null;
  sessions.delete(noteId);
  sessions.set(noteId, entry);
  return entry.document;
}

export function cacheEditorDocument(noteId: string, revision: string, document: ProseMirrorJson): void {
  sessions.delete(noteId);
  sessions.set(noteId, { revision, document });
  while (sessions.size > MAX_EDITOR_SESSIONS) {
    const oldest = sessions.keys().next().value as string | undefined;
    if (!oldest) break;
    sessions.delete(oldest);
  }
}

/** Keep an already converted document valid when autosave only advances updated_at. */
export function promoteCachedEditorDocument(noteId: string, toRevision: string): void {
  const entry = sessions.get(noteId);
  if (!entry || !toRevision) return;
  sessions.set(noteId, { revision: toRevision, document: entry.document });
}

export function clearEditorSessionCache(): void {
  sessions.clear();
}

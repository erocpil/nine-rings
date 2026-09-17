/** View-only overrides: never write readonly display preferences into content. */
export type ReadingBlockState = {
  collapsed?: boolean;
  wrap?: boolean;
  lineNumbers?: boolean;
};
const sessions = new Map<
  string,
  { version: string; blocks: Map<number, ReadingBlockState> }
>();

export function readingBlockSession(
  noteId: string,
  version: string,
): Map<number, ReadingBlockState> {
  let session = sessions.get(noteId);
  if (!session || session.version !== version) {
    session = { version, blocks: new Map() };
    sessions.set(noteId, session);
  }
  return session.blocks;
}

export function clearReadingBlockSessions(): void {
  sessions.clear();
}

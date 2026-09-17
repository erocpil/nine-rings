import { patchReadingState, readReadingState } from "./reading-state";
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

class PersistentBlocks extends Map<number, ReadingBlockState> {
  changed?: () => void;
  override set(key: number, value: ReadingBlockState): this {
    super.set(key, value);
    this.changed?.();
    return this;
  }
  override delete(key: number): boolean {
    const result = super.delete(key);
    this.changed?.();
    return result;
  }
  override clear(): void {
    super.clear();
    this.changed?.();
  }
}

export function readingBlockSession(
  noteId: string,
  version: string,
): Map<number, ReadingBlockState> {
  let session = sessions.get(noteId);
  if (!session || session.version !== version) {
    const saved = readReadingState(noteId).blocks;
    const blocks = new PersistentBlocks(
      saved?.revision === version ? saved.entries : [],
    );
    session = { version, blocks };
    sessions.set(noteId, session);
    blocks.changed = () => {
      if (sessions.get(noteId)?.blocks === blocks)
        patchReadingState(noteId, {
          blocks: { revision: version, entries: [...blocks] },
        });
    };
  }
  return session.blocks;
}

export function clearReadingBlockSessions(): void {
  sessions.clear();
}

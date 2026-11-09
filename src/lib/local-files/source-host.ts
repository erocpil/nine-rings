import type { LocalFileSnapshot } from "./file-model";
import type { LocalDraftStore } from "./recovery";

/** File-content capability only. Directory mutations remain a separate port. */
export interface LocalSourceHost {
  assertActive(): void;
  read(rootId: string, node: string): Promise<LocalFileSnapshot>;
  write(rootId: string, node: string, source: string, base: LocalFileSnapshot): Promise<LocalFileSnapshot>;
  canSaveOriginal(rootId: string): boolean;
  drafts: LocalDraftStore;
}

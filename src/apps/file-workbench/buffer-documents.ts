import { invoke } from "@tauri-apps/api/core";
import type { LocalSourceHost } from "../../lib/local-files/source-host";
import type { BrowserDirectoryProvider } from "../../lib/local-files/browser-contract";
import type { LocalFileSnapshot } from "../../lib/local-files/file-model";
export interface BufferRecord {
  id: string; name: string; source: string; version: number; path: string | null;
  baseSource: string; baseRevision: string; createdAt: number; bom: boolean; lineEnding: LocalFileSnapshot["lineEnding"];
}
export interface BufferDocumentPort {
  create(): Promise<void>;
  discard(id: string): Promise<void>;
  read(id: string): Promise<BufferRecord>;
  checkpoint(id: string, version: number, source: string): Promise<BufferRecord>;
  snapshot(id: string): Promise<LocalFileSnapshot>;
  save(id: string, source: string, base: LocalFileSnapshot): Promise<{ record: BufferRecord; snapshot: LocalFileSnapshot } | null>;
}
export const bufferDocumentPort: BufferDocumentPort = {
  create: () => invoke("workbench_new_document"),
  discard: id => invoke("workbench_buffer_discard", { id }),
  read: id => invoke("workbench_buffer_read", { id }),
  checkpoint: (id, version, source) => invoke("workbench_buffer_checkpoint", { id, version, source }),
  snapshot: id => invoke("workbench_buffer_snapshot", { id }),
  save: (id, source, base) => invoke("workbench_buffer_save", { id, source, revision: base.revision, bom: base.bom, lineEnding: base.lineEnding }),
};
export class BufferSaveCancelled extends Error {}
/** One ordered lane for autosave, explicit save and close. Recovery documents
 * are separate from disk-file drafts and never evicted to satisfy that quota. */
export function createBufferDocumentHost(initial: BufferRecord, source: LocalSourceHost, provider: BrowserDirectoryProvider,
  changed: (value: BufferRecord) => void, port: BufferDocumentPort = bufferDocumentPort) {
  let value = initial;
  let pending: Promise<unknown> = Promise.resolve();
  const lane = <T,>(operation: () => Promise<T>): Promise<T> => {
    const next = pending.catch(() => {}).then(operation);
    pending = next; return next;
  };
  const accept = (next: BufferRecord) => { value = next; changed(next); };
  const checkpoint = async (text: string) => {
    if (text !== value.source) accept(await port.checkpoint(value.id, value.version, text));
  };
  const host: LocalSourceHost = {
    assertActive: source.assertActive,
    read: () => lane(() => port.snapshot(value.id)),
    canSaveOriginal: () => true,
    saveCopy: source.saveCopy,
    write: (_root, _node, text, base) => lane(async () => {
      await checkpoint(text);
      const result = await port.save(value.id, text, base);
      if (!result) throw new BufferSaveCancelled();
      accept(result.record); return result.snapshot;
    }),
    drafts: {
      list: async () => [],
      read: () => lane(async () => value.path && value.source !== value.baseSource
        ? { identity: `workbench-buffer:${value.id}`, source: value.source, baseSource: value.baseSource, baseRevision: value.baseRevision,
          bom: value.bom, lineEnding: value.lineEnding, savedAt: Date.now() } : null),
      write: draft => lane(() => checkpoint(draft.source)),
      // Clearing a disk draft must not delete the persistent document itself.
      remove: () => lane(async () => { if (value.path) await checkpoint(value.baseSource); }),
    },
  };
  return { host, provider: { ...provider, details: async () => ({ path: value.path ?? undefined, size: new TextEncoder().encode(value.source).byteLength, modifiedMs: 0, readonly: false }) },
    settled: () => pending };
}

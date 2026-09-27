/** Primary-key restoration and stale request isolation. */
import assert from "node:assert/strict";
import type { Note } from "../src/types/models";
import { api } from "../src/lib/api";
import { useNotesStore } from "../src/stores/useNotesStore";

async function main() {
  const restored: Note = {
    id: "last-document", date: "2026-08-20", title: "上次文档",
    content: { ops: [{ insert: "正文\n" }] }, tags: [], pinned: false,
    readonly: false, sort_order: 0, created_at: "2026-08-20T00:00:00Z",
    updated_at: "2026-08-20T00:00:00Z", storagePath: "projects/startup",
  };
  const originalGet = api.notes.get, originalSearch = api.docs.search;
  let primaryLoads = 0, listLoads = 0;
  api.notes.get = async () => { primaryLoads++; return restored; };
  api.docs.search = async () => { listLoads++; return [restored]; };
  try {
    await useNotesStore.getState().initialize(restored.id);
    assert.equal(primaryLoads, 1);
    assert.equal(listLoads, 0, "last document restoration does not scan all documents");
    assert.equal(useNotesStore.getState().selectedNote?.id, restored.id);
    assert.equal(useNotesStore.getState().startupReady, true);
    await useNotesStore.getState().refreshNotes();
    assert.equal(listLoads, 1);
    assert.equal(useNotesStore.getState().selectedNote?.id, restored.id);
    await useNotesStore.getState().initialize(undefined, false);
    assert.equal(useNotesStore.getState().selectedNote, null, "explicit folder target remains open");
    assert.equal(listLoads, 1);
    api.notes.get = async () => null;
    const newer = { ...restored, id: "newer", updated_at: "2026-08-22T00:00:00Z" };
    api.docs.search = async () => [restored, newer];
    await useNotesStore.getState().initialize("missing");
    assert.equal(useNotesStore.getState().selectedNote?.id, newer.id);
    let release!: (note: Note) => void;
    api.notes.get = async id => id === "slow" ? new Promise<Note>(resolve => { release = resolve; }) : newer;
    const slow = useNotesStore.getState().initialize("slow");
    await useNotesStore.getState().initialize(newer.id);
    release(restored);
    await slow;
    assert.equal(useNotesStore.getState().selectedNote?.id, newer.id, "late restoration cannot replace newer selection");
    let releaseList!: (notes: Note[]) => void;
    api.docs.search = () => new Promise(resolve => { releaseList = resolve; });
    const refresh = useNotesStore.getState().refreshNotes();
    await useNotesStore.getState().initialize(newer.id);
    releaseList([restored]);
    await refresh;
    assert.deepEqual(useNotesStore.getState().notes, [], "stale refresh cannot replace a newer session");
  } finally { api.notes.get = originalGet; api.docs.search = originalSearch; }
  console.log("Document startup and stale request isolation passed");
}
main().catch(error => { console.error(error); process.exit(1); });

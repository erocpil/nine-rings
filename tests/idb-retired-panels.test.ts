/** Removing an unreleased store must preserve document data on a real v4 upgrade. */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { IDB_STORES, IDB_DATABASE_VERSION } from '../src/types/schema_gen';
import { idbAdapter } from '../src/lib/storage/idb';
import { withDB } from '../src/lib/storage/db';

const doc = {
  id: 'kept-document', date: '2026-09-27', title: '保留文档', storagePath: 'projects/retained',
  content: { ops: [{ insert: '最新正文\n' }] }, tags: ['keep'], readonly: true, pinned: true,
  created_at: '2026-09-27T00:00:00Z', updated_at: '2026-09-27T00:00:00Z', sort_order: 0,
};
await new Promise<void>((resolve, reject) => {
  const request = indexedDB.open('nine_rings', 4);
  request.onupgradeneeded = () => {
    const db = request.result;
    for (const [name, definition] of Object.entries(IDB_STORES)) {
      const store = db.createObjectStore(name, { keyPath: definition.keyPath });
      for (const index of definition.indexes) store.createIndex(index.name, index.keyPath);
    }
    db.createObjectStore('daily_pages', { keyPath: 'date' });
    request.transaction!.objectStore('notes').put(doc);
    request.transaction!.objectStore('note_versions').put({ id: 'kept-version', note_id: doc.id, title: doc.title, content: doc.content, saved_at: doc.updated_at });
  };
  request.onsuccess = () => { request.result.close(); resolve(); };
  request.onerror = () => reject(request.error);
});
assert.deepEqual((await idbAdapter.getNote(doc.id))?.content, doc.content);
assert.equal((await idbAdapter.getNoteVersions(doc.id)).length, 1);
await withDB(async db => {
  assert.equal(db.version, IDB_DATABASE_VERSION);
  assert.equal(db.objectStoreNames.contains('daily_pages'), false);
  assert.equal(db.objectStoreNames.contains('protected_paths'), true);
});
const exported = JSON.parse(await idbAdapter.exportData());
assert.equal('daily_pages' in exported, false);
assert.equal(exported.notes[0].id, doc.id);
assert.equal(exported.notes[0].readonly, true);
console.log('IndexedDB v4 upgrade preserves documents and versions; retired store removed');

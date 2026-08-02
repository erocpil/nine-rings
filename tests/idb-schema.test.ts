/** Verify that the browser database opened by idb.ts matches schema/note.yaml. */
import "fake-indexeddb/auto";

import { idbAdapter } from "../src/lib/storage/idb";
import {
  IDB_DATABASE_VERSION,
  IDB_STORES,
} from "../src/types/schema_gen";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    return;
  }
  failed++;
  console.error(`  FAIL: ${message}`);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("nine_rings", IDB_DATABASE_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

await idbAdapter.getAllNotes();
const db = await openDatabase();

const actualStores = Array.from(db.objectStoreNames).sort();
const expectedStores = Object.keys(IDB_STORES).sort();
assert(
  JSON.stringify(actualStores) === JSON.stringify(expectedStores),
  `stores differ: actual=${actualStores} expected=${expectedStores}`,
);

for (const [storeName, definition] of Object.entries(IDB_STORES)) {
  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  assert(store.keyPath === definition.keyPath, `${storeName} keyPath matches`);

  const actualIndexes = Array.from(store.indexNames).sort();
  const expectedIndexes = definition.indexes.map((index) => index.name).sort();
  assert(
    JSON.stringify(actualIndexes) === JSON.stringify(expectedIndexes),
    `${storeName} indexes match`,
  );

  for (const expected of definition.indexes) {
    const actualKeyPath = store.index(expected.name).keyPath;
    assert(
      JSON.stringify(actualKeyPath) === JSON.stringify(expected.keyPath),
      `${storeName}.${expected.name} keyPath matches`,
    );
  }
}

db.close();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

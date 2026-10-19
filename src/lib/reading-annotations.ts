import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

const DATABASE = "nine_rings_reading_annotations";
const VERSION = 1;
const STORE = "annotations";
const NOTE_INDEX = "noteId";

export interface ReadingAnnotation {
  id: string;
  noteId: string;
  from: number;
  to: number;
  exact: string;
  prefix: string;
  suffix: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

interface TextRun { from: number; to: number; textFrom: number; textTo: number }
export interface ReadingTextMap { text: string; runs: TextRun[] }

let openPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (openPromise) return openPromise;
  const task = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex(NOTE_INDEX, NOTE_INDEX, { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); openPromise = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("阅读标注存储打开失败"));
    request.onblocked = () => reject(new Error("阅读标注存储正被另一个窗口升级"));
  });
  openPromise = task;
  void task.catch(() => { if (openPromise === task) openPromise = null; });
  return task;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error("阅读标注保存失败"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("阅读标注读取失败"));
  });
}

export function buildReadingTextMap(doc: ProseMirrorNode): ReadingTextMap {
  let text = "";
  const runs: TextRun[] = [];
  let previousTextblock: ProseMirrorNode | null = null;
  doc.descendants((node, position) => {
    if (!node.isText) {
      if (node.isTextblock) {
        if (previousTextblock) text += "\n";
        previousTextblock = node;
      } else if (node.isLeaf && node.type.name === "hardBreak") {
        const textFrom = text.length;
        text += "\n";
        runs.push({ from: position, to: position + node.nodeSize, textFrom, textTo: text.length });
      }
      return true;
    }
    // A text node is part of the currently visited textblock. Its PM range is
    // retained so selections can be translated without touching document text.
    const value = node.text ?? "";
    const textFrom = text.length;
    text += value;
    runs.push({ from: position, to: position + node.nodeSize, textFrom, textTo: text.length });
    return false;
  });
  return { text, runs };
}

export function readingPositionToOffset(map: ReadingTextMap, position: number): number {
  let nearest = 0;
  for (const run of map.runs) {
    if (position >= run.from && position <= run.to) return run.textFrom + Math.min(run.to - run.from, position - run.from);
    if (run.to < position) nearest = run.textTo;
    else if (run.from > position) return run.textFrom;
  }
  return nearest;
}

export function readingOffsetToPosition(map: ReadingTextMap, offset: number): number {
  const target = Math.max(0, Math.min(map.text.length, offset));
  for (const run of map.runs) {
    if (target >= run.textFrom && target <= run.textTo) return run.from + Math.min(run.to - run.from, target - run.textFrom);
  }
  return map.runs.length ? map.runs[map.runs.length - 1].to : 0;
}

export function quoteForRange(map: ReadingTextMap, from: number, to: number) {
  const start = readingPositionToOffset(map, from);
  const end = readingPositionToOffset(map, to);
  const exact = map.text.slice(start, end);
  return {
    exact,
    prefix: map.text.slice(Math.max(0, start - 32), start),
    suffix: map.text.slice(end, end + 32),
  };
}

export function createReadingAnnotation(
  noteId: string,
  doc: ProseMirrorNode,
  from: number,
  to: number,
): ReadingAnnotation {
  const start = Math.max(0, Math.min(doc.content.size, Math.min(from, to)));
  const end = Math.max(0, Math.min(doc.content.size, Math.max(from, to)));
  const quote = quoteForRange(buildReadingTextMap(doc), start, end);
  if (!quote.exact.trim()) throw new Error("请选择包含文字的范围");
  const now = new Date().toISOString();
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `reading-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    noteId, from: start, to: end, ...quote, note: "", createdAt: now, updatedAt: now,
  };
}

export async function listReadingAnnotations(noteId: string): Promise<ReadingAnnotation[]> {
  const db = await openDatabase();
  const tx = db.transaction(STORE, "readonly");
  const done = transactionDone(tx);
  const values = await requestResult(tx.objectStore(STORE).index(NOTE_INDEX).getAll(noteId));
  await done;
  return (values as ReadingAnnotation[]).sort((a, b) => a.from - b.from || a.createdAt.localeCompare(b.createdAt));
}

export async function putReadingAnnotation(annotation: ReadingAnnotation): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE, "readwrite");
  const done = transactionDone(tx);
  tx.objectStore(STORE).put(annotation);
  await done;
}

export async function deleteReadingAnnotation(id: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE, "readwrite");
  const done = transactionDone(tx);
  tx.objectStore(STORE).delete(id);
  await done;
}

export async function deleteReadingAnnotations(ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openDatabase();
  const tx = db.transaction(STORE, "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore(STORE);
  ids.forEach(id => store.delete(id));
  await done;
}

export function reanchorReadingAnnotations(doc: ProseMirrorNode, annotations: readonly ReadingAnnotation[]) {
  const map = buildReadingTextMap(doc);
  const updates: ReadingAnnotation[] = [];
  const removed: string[] = [];
  for (const item of annotations) {
    if (item.from >= 0 && item.to > item.from && item.to <= doc.content.size
      && doc.textBetween(item.from, item.to, "\n", "\uFFFC") === item.exact) {
      updates.push(item);
      continue;
    }
    if (!item.exact) { removed.push(item.id); continue; }
    const occurrences: number[] = [];
    let cursor = 0;
    while ((cursor = map.text.indexOf(item.exact, cursor)) !== -1) {
      occurrences.push(cursor);
      cursor += Math.max(1, item.exact.length);
    }
    const scored = occurrences.map(start => {
      const end = start + item.exact.length;
      const prefix = map.text.slice(Math.max(0, start - item.prefix.length), start);
      const suffix = map.text.slice(end, end + item.suffix.length);
      return { start, end, score: commonSuffix(prefix, item.prefix) + commonPrefix(suffix, item.suffix) };
    }).sort((a, b) => b.score - a.score);
    if (!scored.length || (scored[1] && scored[0].score === scored[1].score)) {
      removed.push(item.id);
      continue;
    }
    const match = scored[0];
    const from = readingOffsetToPosition(map, match.start);
    const to = readingOffsetToPosition(map, match.end);
    if (to <= from) { removed.push(item.id); continue; }
    updates.push({ ...item, from, to, updatedAt: new Date().toISOString() });
  }
  return { updates, removed };
}

function commonSuffix(left: string, right: string): number {
  let count = 0;
  while (count < left.length && count < right.length && left[left.length - count - 1] === right[right.length - count - 1]) count++;
  return count;
}

function commonPrefix(left: string, right: string): number {
  let count = 0;
  while (count < left.length && count < right.length && left[count] === right[count]) count++;
  return count;
}

import { corpusResource, vocabularyResourceKey, type VocabularyCorpusEntry, type VocabularyPackage } from "./contracts";
import { boundedText, digest, validateVocabularyPackage } from "./package";
export const CORPUS_CHANGED = "nr:vocabulary-corpus-changed";
type Summary = Omit<VocabularyCorpusEntry, "source"> & { bucket: string };
export interface CorpusManifest {
  id: string; revision: number; name: string; hash: string;
  entries: Summary[]; shards: Record<string, string>;
}
interface Shard { id: string; hash: string; bytes: ArrayBuffer; gzip: boolean }
const request = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
});
function completed(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = event => reject((event.target as IDBRequest | null)?.error ?? tx.error ?? new Error("词库存储失败"));
  });
}
async function open(): Promise<IDBDatabase> {
  const req = indexedDB.open("nine-rings-vocabulary", 1);
  req.onupgradeneeded = () => {
    req.result.createObjectStore("corpora", { keyPath: "id" });
    req.result.createObjectStore("shards", { keyPath: "id" });
  };
  return request(req);
}
/** Cached decoded shards only; the index never requires loading all Markdown bodies. */
const cache = new Map<string, VocabularyCorpusEntry[]>();
async function decode(shard: Shard) {
  const cached = cache.get(shard.hash);
  if (cached) { cache.delete(shard.hash); cache.set(shard.hash, cached); return cached; }
  const blob = new Blob([shard.bytes]);
  const stream = shard.gzip ? blob.stream().pipeThrough(new DecompressionStream("gzip")) : blob.stream();
  const text = await boundedText(stream);
  if (await digest(text) !== shard.hash) throw new Error("词库分片校验失败，请重新导入原始词库");
  const entries = JSON.parse(text) as VocabularyCorpusEntry[];
  if (text.length <= 1_000_000) cache.set(shard.hash, entries);
  while (cache.size > 4) cache.delete(cache.keys().next().value!);
  return entries;
}
export async function listCorpora(): Promise<CorpusManifest[]> {
  const db = await open();
  try { return await request(db.transaction("corpora").objectStore("corpora").getAll()); }
  finally { db.close(); }
}
export async function importCorpus(input: VocabularyPackage, expectedHash?: string | null): Promise<void> {
  const pack = validateVocabularyPackage(input);
  const buckets = new Map<string, VocabularyCorpusEntry[]>();
  const summaries: Summary[] = [];
  for (const e of [...pack.entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    // Stable hash partition: changing one entry does not shift unrelated shards.
    const bucket = (await digest(e.id)).slice(0, 1);
    const rows = buckets.get(bucket) ?? [];
    rows.push(e); buckets.set(bucket, rows);
    const { source: _source, ...summary } = e;
    summaries.push({ ...summary, bucket });
  }
  const shards: Shard[] = [];
  for (const [bucket, entries] of buckets) {
    const text = JSON.stringify(entries);
    const blob = new Blob([text]);
    const gzip = typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
    shards.push({ id: `${pack.id}:${bucket}`, hash: await digest(text), gzip,
      bytes: gzip ? await new Response(blob.stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer() : await blob.arrayBuffer() });
  }
  const manifest: CorpusManifest = {
    id: pack.id, revision: pack.revision, name: pack.name, entries: summaries,
    shards: Object.fromEntries(shards.map(s => [s.id.split(":")[1], s.hash])),
    hash: await digest(JSON.stringify({ ...pack, entries: [...pack.entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) })),
  };
  const db = await open();
  try {
    const tx = db.transaction(["corpora", "shards"], "readwrite");
    const done = completed(tx);
    const store = tx.objectStore("corpora");
    const existing = store.get(pack.id);
    let conflict = false;
    let stale = false;
    existing.onsuccess = () => {
      const previous = existing.result as CorpusManifest | undefined;
      if (expectedHash !== undefined && (previous?.hash ?? null) !== expectedHash) {
        stale = true; tx.abort(); return;
      }
      if (previous && (previous.revision > pack.revision || (previous.revision === pack.revision && previous.hash !== manifest.hash))) {
        conflict = true; tx.abort(); return;
      }
      for (const bucket of Object.keys(previous?.shards ?? {})) tx.objectStore("shards").delete(`${pack.id}:${bucket}`);
      for (const shard of shards) tx.objectStore("shards").put(shard);
      store.put(manifest);
    };
    try { await done; } catch (e) { if (stale) throw new Error("词库已在其它操作中变更，请重新预览后导入"); if (conflict) throw new Error("词库版本过旧或同一版本内容不同，请提高 revision 后重试"); throw e; }
  } finally { db.close(); }
  notifyCorpusChanged(pack.id);
}
function notifyCorpusChanged(id: string) {
  cache.clear();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED, { detail: id }));
    try { localStorage.setItem("nr:vocabularyCorpusRevision", JSON.stringify({ id, nonce: crypto.randomUUID() })); } catch { /* Already committed. */ }
  }
}
/** Confirmation is bound to the exact installed version, including across windows. */
export async function removeCorpus(id: string, expectedHash: string): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction(["corpora", "shards"], "readwrite");
    const done = completed(tx);
    const store = tx.objectStore("corpora");
    let stale = false;
    const lookup = store.get(id);
    lookup.onsuccess = () => {
      const current = lookup.result as CorpusManifest | undefined;
      if (!current || current.hash !== expectedHash) { stale = true; tx.abort(); return; }
      for (const bucket of Object.keys(current.shards)) tx.objectStore("shards").delete(`${id}:${bucket}`);
      store.delete(id);
    };
    try { await done; } catch (error) { if (stale) throw new Error("词库已变更，请刷新后重新确认卸载"); throw error; }
  } finally { db.close(); }
  notifyCorpusChanged(id);
}
export async function previewCorpusImport(input: VocabularyPackage, markdownZip = false) {
  const pack = validateVocabularyPackage(input);
  const manifest = (await listCorpora()).find(c => c.id === pack.id);
  const previous = manifest ? await exportCorpus(pack.id) : null;
  const before = new Map(previous?.entries.map(e => [e.id, e]) ?? []);
  let added = 0, changed = 0, unchanged = 0;
  for (const entry of pack.entries) {
    const old = before.get(entry.id);
    // A raw archive has no revision or reliable per-entry import date.
    if (markdownZip && old) entry.addedAt = old.addedAt;
    if (!old) added++;
    else if (JSON.stringify(old) === JSON.stringify(entry)) unchanged++;
    else changed++;
    before.delete(entry.id);
  }
  const removed = before.size;
  const same = !!previous && !added && !changed && !removed && previous.name === pack.name;
  if (previous && markdownZip) pack.revision = previous.revision + (same ? 0 : 1);
  if (previous && (pack.revision < previous.revision || (pack.revision === previous.revision && !same))) {
    throw new Error("词库版本过旧或同一版本内容不同，请提高 revision 后重试");
  }
  // exportCorpus and manifest reads can race another window; reject before showing an inaccurate preview.
  const current = (await listCorpora()).find(c => c.id === pack.id);
  if ((current?.hash ?? null) !== (manifest?.hash ?? null)) throw new Error("词库已变更，请重新预览导入");
  return { pack, expectedHash: manifest?.hash ?? null, added, changed, removed, unchanged, unchangedPackage: same && pack.revision === previous?.revision };
}
export async function readCorpusEntry(key: string): Promise<VocabularyCorpusEntry> {
  const ref = corpusResource(key);
  if (!ref) throw new Error("词条身份无效");
  const db = await open();
  let shard: Shard | undefined;
  let manifest: CorpusManifest | undefined;
  try {
    const tx = db.transaction(["corpora", "shards"]);
    manifest = await request(tx.objectStore("corpora").get(ref.corpusId));
    const summary = manifest?.entries.find(e => e.id === ref.entryId);
    if (!summary) throw new Error("词条已不在当前词库版本中");
    shard = await request(tx.objectStore("shards").get(`${ref.corpusId}:${summary.bucket}`));
    if (!shard || shard.hash !== manifest?.shards[summary.bucket]) throw new Error("词库分片缺失");
  } finally { db.close(); }
  const entry = (await decode(shard!)).find(e => e.id === ref.entryId);
  if (!entry) throw new Error("词库索引与正文不一致");
  return { ...entry };
}
export async function exportCorpus(id: string): Promise<VocabularyPackage> {
  const db = await open();
  let manifest: CorpusManifest;
  let shards: Shard[];
  try {
    const tx = db.transaction(["corpora", "shards"]);
    const stored = await request<CorpusManifest | undefined>(tx.objectStore("corpora").get(id));
    if (!stored) throw new Error("词库不存在");
    manifest = stored;
    shards = await Promise.all(Object.keys(stored.shards).map(bucket => request<Shard>(tx.objectStore("shards").get(`${id}:${bucket}`))));
  } finally { db.close(); }
  for (const shard of shards) {
    if (!shard || manifest.shards[shard.id.split(":")[1]] !== shard.hash) throw new Error("词库分片与索引不一致");
  }
  const entries = (await Promise.all(shards.map(decode))).flat().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pack = validateVocabularyPackage({ format: "nine-rings-vocabulary", version: 1, id, revision: manifest.revision, name: manifest.name, entries });
  if (await digest(JSON.stringify(pack)) !== manifest.hash) throw new Error("词库整体校验失败");
  return pack;
}
export async function corpusSummaries(root: string) {
  return (await listCorpora()).flatMap(c => c.entries.map(e => ({
    id: vocabularyResourceKey({ kind: "corpus", corpusId: c.id, entryId: e.id }), title: e.word,
    storagePath: `${root}/词库-${c.id}${e.group ? "/" + e.group : ""}`,
    created_at: e.addedAt, updated_at: e.addedAt,
  })));
}

/** Stable identity shared by tree, navigation, personal records and future article links. */
export type VocabularyResourceRef =
  | { kind: "document"; documentId: string }
  | { kind: "corpus"; corpusId: string; entryId: string };
export interface VocabularyCorpusEntry {
  id: string;
  word: string;
  group: string;
  source: string;
  addedAt: string;
}
export interface VocabularyPackage {
  format: "nine-rings-vocabulary";
  version: 1;
  id: string;
  revision: number;
  name: string;
  entries: VocabularyCorpusEntry[];
}
/** Corpus updates must never overwrite these user-owned entities. */
export interface VocabularyPersonalRecord {
  id: string;
  resource: VocabularyResourceRef;
  notes: string;
  updatedAt: string;
}
export interface VocabularyArticleLink {
  id: string;
  resource: VocabularyResourceRef;
  article: { documentId: string; anchorId?: string };
  quote: string;
  expression: string;
  sourceProvider?: string;
  sourceSenseId?: string;
  createdAt: string;
}
/** Future host service: links are separate entities; article deletion leaves a resolvable missing target. */
export interface VocabularyArticleLinkService {
  listForEntry(resource: VocabularyResourceRef): Promise<VocabularyArticleLink[]>;
  listForArticle(documentId: string): Promise<VocabularyArticleLink[]>;
  put(link: VocabularyArticleLink): Promise<void>;
  remove(id: string): Promise<void>;
}
export function vocabularyResourceKey(ref: VocabularyResourceRef): string {
  return ref.kind === "document" ? ref.documentId : `vocab:${ref.corpusId}:${ref.entryId}`;
}
export function corpusResource(key: string): Extract<VocabularyResourceRef, { kind: "corpus" }> | null {
  const match = /^vocab:([a-zA-Z0-9_-]{1,40}):([a-zA-Z0-9_-]{1,64})$/.exec(key);
  return match ? { kind: "corpus", corpusId: match[1], entryId: match[2] } : null;
}
export interface VocabularyResourceSummary {
  id: string;
  title: string | null;
  storagePath?: string;
  created_at: string;
  updated_at: string;
}
export interface VocabularyResourceContent {
  /** Legacy field name: opaque navigation key, not necessarily a document ID. */
  documentId: string;
  title: string;
  source: string;
  resource: VocabularyResourceRef;
}
export interface VocabularyResourceService {
  list(): Promise<VocabularyResourceSummary[]>;
  read(key: string): Promise<VocabularyResourceContent>;
}
export function isVocabularyResource(value: unknown, key: string): value is VocabularyResourceRef {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.kind === "document") return Object.keys(v).length === 2 && typeof v.documentId === "string" && v.documentId === key && !key.startsWith("vocab:");
  const ref = corpusResource(key);
  return !!ref && Object.keys(v).length === 3 && v.kind === "corpus" && v.corpusId === ref.corpusId && v.entryId === ref.entryId;
}

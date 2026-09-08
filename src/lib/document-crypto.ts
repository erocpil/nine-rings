import type { DeltaOps } from "../types/models";

export interface EncryptedContent {
  version: 1;
  protectionId: string;
  salt: string;
  iterations: number;
  iv: string;
  data: string;
}
export interface DocumentKey {
  protectionId: string;
  salt: string;
  iterations: number;
  key: CryptoKey;
}
export interface ProtectedPath {
  id: string;
  path: string;
  verifier: DeltaOps;
  createdAt: string;
  updatedAt: string;
}
const ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function isEncrypted(content: unknown): content is DeltaOps & { encrypted: EncryptedContent } {
  return !!content && typeof content === "object" && "encrypted" in content;
}
function encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4) throw new Error("加密数据格式无效");
  return Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0));
}
export function validateEncryptedContent(content: unknown): asserts content is DeltaOps & { encrypted: EncryptedContent } {
  if (!isEncrypted(content)) throw new Error("不是加密文档");
  const e = content.encrypted;
  if (!e || e.version !== 1 || typeof e.protectionId !== "string" || !e.protectionId ||
      e.iterations !== ITERATIONS || decode(e.salt).length !== 16 || decode(e.iv).length !== 12 || decode(e.data).length < 16 ||
      !Array.isArray(content.ops) || content.ops.length || Object.keys(content).some(k => !["ops", "encrypted"].includes(k))) {
    throw new Error("不支持或损坏的加密数据，请使用支持此版本的应用");
  }
}
function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) throw new Error("此环境不支持安全加密，请使用 HTTPS PWA 或新版桌面应用");
  return crypto.subtle;
}
async function derive(password: string, protectionId: string, salt: string): Promise<DocumentKey> {
  const raw = encoder.encode(password);
  try {
    const material = await subtle().importKey("raw", raw, "PBKDF2", false, ["deriveKey"]);
    const key = await subtle().deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: decode(salt), iterations: ITERATIONS }, material,
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    return { protectionId, salt, iterations: ITERATIONS, key };
  } finally { raw.fill(0); }
}
export async function createDocumentKey(password: string): Promise<DocumentKey> {
  if (password.length < 8 || password.length > 1024) throw new Error("密码须为 8～1024 个字符，建议使用长密码；空格不会被忽略");
  subtle();
  return derive(password, crypto.randomUUID(), encode(crypto.getRandomValues(new Uint8Array(16))));
}
export async function unlockDocument(content: DeltaOps, password: string): Promise<{ content: DeltaOps; key: DocumentKey }> {
  validateEncryptedContent(content);
  const key = await derive(password, content.encrypted.protectionId, content.encrypted.salt);
  return { key, content: await decryptDocument(content, key) };
}
export async function encryptDocument(content: DeltaOps, key: DocumentKey): Promise<DeltaOps> {
  if (isEncrypted(content)) throw new Error("正文已经加密，不能重复加密");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const raw = encoder.encode(JSON.stringify(content));
  try {
    const encrypted = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(`nine-rings:document:v1:${key.protectionId}`), tagLength: 128 }, key.key, raw);
    return { ops: [], encrypted: { version: 1, protectionId: key.protectionId, salt: key.salt, iterations: key.iterations, iv: encode(iv), data: encode(new Uint8Array(encrypted)) } };
  } finally { raw.fill(0); }
}
export async function decryptDocument(content: DeltaOps, key: DocumentKey): Promise<DeltaOps> {
  validateEncryptedContent(content);
  const e = content.encrypted;
  if (e.protectionId !== key.protectionId || e.salt !== key.salt) throw new Error("文档密码已更改，请重新打开并验证");
  let bytes: Uint8Array | undefined;
  try {
    bytes = new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: decode(e.iv), additionalData: encoder.encode(`nine-rings:document:v1:${e.protectionId}`), tagLength: 128 }, key.key, decode(e.data)));
    const value = JSON.parse(decoder.decode(bytes));
    if (!value || (!Array.isArray(value.ops) && value.type !== "doc") || isEncrypted(value)) throw new Error();
    return value as DeltaOps;
  } catch { throw new Error("密码错误或加密数据损坏，原数据未修改"); }
  finally { bytes?.fill(0); }
}

// Pending autosaves may retain a key until they finish; neither passwords nor
// decrypted Notes are stored in global lists, localStorage or search workers.
const sessions = new Map<string, { owner: symbol; key: DocumentKey }>();
export function openDocumentSession(noteId: string, key: DocumentKey): () => void {
  const owner = Symbol();
  sessions.set(noteId, { owner, key });
  return () => { if (sessions.get(noteId)?.owner === owner) sessions.delete(noteId); };
}
export function documentSessionKey(noteId: string): DocumentKey | undefined { return sessions.get(noteId)?.key; }

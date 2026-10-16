import type { VocabularyPackage } from "./contracts";
export const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder();
export async function digest(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))].map(v => v.toString(16).padStart(2, "0")).join("");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("词库结构无效");
  return value as Record<string, unknown>;
}
function only(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(k => !keys.includes(k))) throw new Error("词库包含当前版本不支持的字段");
}
export function validateVocabularyPackage(value: unknown): VocabularyPackage {
  const p = object(value);
  only(p, ["format", "version", "id", "revision", "name", "entries"]);
  if (p.format !== "nine-rings-vocabulary" || p.version !== 1
    || typeof p.id !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(p.id)
    || !Number.isSafeInteger(p.revision) || Number(p.revision) < 1
    || typeof p.name !== "string" || !p.name.trim() || p.name.length > 128
    || !Array.isArray(p.entries) || !p.entries.length || p.entries.length > 50000) throw new Error("词库格式、身份或条目数无效");
  const ids = new Set<string>();
  let bytes = 0;
  for (const value of p.entries) {
    const e = object(value);
    only(e, ["id", "word", "group", "source", "addedAt"]);
    if (typeof e.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(e.id) || ids.has(e.id)
      || typeof e.word !== "string" || !e.word.trim() || e.word.length > 512
      || typeof e.source !== "string" || e.source.length > 250000
      || typeof e.group !== "string" || e.group.length > 512
      || (e.group !== "" && e.group.split("/").some(p => !p || p === "." || p === ".." || (p.includes("\\") || [...p].some(c => c.charCodeAt(0) < 32))))
      || typeof e.addedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(e.addedAt) || !Number.isFinite(Date.parse(e.addedAt))) throw new Error("词条字段、稳定 ID、分组或日期无效");
    ids.add(e.id);
    bytes += encoder.encode(JSON.stringify(e)).byteLength;
    if (bytes > MAX_PACKAGE_BYTES) throw new Error("词库解压后超过 64 MB");
  }
  const pack = value as VocabularyPackage;
  return {
    format: "nine-rings-vocabulary", version: 1, id: pack.id, revision: pack.revision, name: pack.name,
    entries: pack.entries.map(e => ({ id: e.id, word: e.word, group: e.group, source: e.source, addedAt: e.addedAt })),
  };
}
export async function boundedText(stream: ReadableStream<Uint8Array>, limit = MAX_PACKAGE_BYTES): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("词库解压后超过大小限制");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel(); reader.releaseLock(); }
}
export async function readVocabularyPackage(file: Blob): Promise<VocabularyPackage> {
  if (file.size > MAX_PACKAGE_BYTES) throw new Error("词库文件超过 64 MB");
  let header: Uint8Array;
  try { header = new Uint8Array(await file.slice(0, 4).arrayBuffer()); }
  catch { throw new Error("无法读取所选词库文件，请重新选择本机文件后重试"); }
  if (!header.length) throw new Error("词库文件为空");
  if (header[0] === 0x50 && header[1] === 0x4b &&
    ((header[2] === 3 && header[3] === 4) || (header[2] === 5 && header[3] === 6) || (header[2] === 7 && header[3] === 8))) {
    return (await import("./zip-package")).readVocabularyZip(file);
  }
  const compressed = header[0] === 31 && header[1] === 139;
  if (compressed && typeof DecompressionStream === "undefined") throw new Error("当前环境不支持 gzip，请导入未压缩 JSON 词库");
  let text: string;
  try {
    const stream = compressed ? file.stream().pipeThrough(new DecompressionStream("gzip")) : file.stream();
    text = await boundedText(stream);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new Error(compressed
      ? "gzip 词库解压或读取失败，请重新选择文件；若仍失败，请使用打包工具生成未压缩的 .nrvocab.json 后导入"
      : "无法按 UTF-8 读取词库，请选择 .nrvocab.json 或 .nrvocab.json.gz 文件");
  }
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw new Error("文件不是有效的词库 JSON，请使用独立词库打包工具生成；普通 Markdown 文档请从文档导入入口导入"); }
  return validateVocabularyPackage(value);
}

import { Unzip, UnzipInflate } from "fflate";
import { digest, MAX_PACKAGE_BYTES, validateVocabularyPackage } from "./package";
import type { VocabularyCorpusEntry, VocabularyPackage } from "./contracts";

/** Decode bounded ZIP members in memory; never extract paths to the filesystem. */
export async function readVocabularyZip(file: Blob): Promise<VocabularyPackage> {
  const files: { name: string; text: string; complete: boolean }[] = [];
  let total = 0;
  let failure: Error | null = null;
  const archive = new Unzip(entry => {
    if (failure) return;
    const name = entry.name.replace(/\\/g, "/");
    if (name.startsWith("__MACOSX/") || name.endsWith("/")) return;
    if (!/\.(md|json|gz)$/i.test(name)) return;
    if (name.startsWith("/") || /^[a-z]:/i.test(name) || name.split("/").some(p => !p || p === "..")) {
      failure = new Error("ZIP 中包含无效路径"); return;
    }
    if (name.split("/").some(p => p.startsWith("."))) return;
    if (files.some(f => f.name === name) || files.length >= 50000) { failure = new Error("ZIP 中存在重复文件或文件过多"); return; }
    const target = { name, text: "", complete: false }; files.push(target);
    const chunks: Uint8Array[] = [];
    entry.ondata = (error, data, final) => {
      if (failure) { entry.terminate(); return; }
      if (error) { failure = new Error("ZIP 解压失败，请检查压缩包是否完整或已加密"); return; }
      total += data.length;
      if (total > MAX_PACKAGE_BYTES) { failure = new Error("ZIP 解压内容超过 64 MB"); entry.terminate(); return; }
      if (/\.gz$/i.test(name)) { failure = new Error("ZIP 内的 gzip 词库请先取出，再直接导入 .gz 文件"); entry.terminate(); return; }
      chunks.push(data);
      if (final) {
        target.complete = true;
        try {
          const decoder = new TextDecoder("utf-8", { fatal: true });
          target.text = chunks.map(c => decoder.decode(c, { stream: true })).join("") + decoder.decode();
        } catch { failure = new Error(`ZIP 文件不是 UTF-8 文本：${name}`); }
      }
    };
    entry.start();
  });
  archive.register(UnzipInflate);
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    for (let offset = 0; offset < bytes.length && !failure; offset += 16384) {
      archive.push(bytes.subarray(offset, offset + 16384), offset + 16384 >= bytes.length);
    }
  } catch { throw new Error("无法解压 ZIP，请检查文件是否完整或已加密"); }
  if (failure) throw failure;
  if (files.some(f => !f.complete)) throw new Error("ZIP 内容不完整，请重新获取压缩包");
  const packages = files.filter(f => /\.json$/i.test(f.name));
  if (packages.length === 1 && !files.some(f => /\.md$/i.test(f.name))) {
    try { return validateVocabularyPackage(JSON.parse(packages[0].text.replace(/^\uFEFF/, ""))); }
    catch (e) { throw new Error(`ZIP 内词库 JSON 无效：${String(e)}`); }
  }
  const markdown = files.filter(f => /\.md$/i.test(f.name)).sort((a, b) => a.name < b.name ? -1 : 1);
  if (!markdown.length) throw new Error("ZIP 中没有 Markdown 词汇或独立词库 JSON");
  const root = markdown[0].name.split("/")[0];
  const sharedRoot = markdown.every(f => f.name.startsWith(root + "/"));
  const filename = "name" in file && typeof file.name === "string" ? file.name.replace(/\.zip$/i, "") : "词库";
  const name = sharedRoot ? root : filename;
  const id = /^[A-Za-z0-9_-]{1,40}$/.test(name) ? name : `zip-${(await digest(name)).slice(0, 24)}`;
  const entries: VocabularyCorpusEntry[] = [];
  const seen = new Set<string>();
  for (const item of markdown) {
    const path = sharedRoot ? item.name.slice(root.length + 1) : item.name;
    const word = /^#\s+(.+)$/m.exec(item.text)?.[1].trim() || path.split("/").pop()!.replace(/\.md$/i, "");
    const entryId = (await digest(word.normalize("NFC").toLowerCase())).slice(0, 32);
    if (seen.has(entryId)) throw new Error(`ZIP 中有重复词头“${word}”，请合并资料后再导入`);
    seen.add(entryId);
    const captured = /(?:抓取整理时间|提取时间)[：:]\s*(\S+)/.exec(item.text)?.[1];
    const addedAt = captured && Number.isFinite(Date.parse(captured)) ? new Date(captured).toISOString() : "1970-01-01T00:00:00Z";
    entries.push({ id: entryId, word, group: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "", source: item.text, addedAt });
  }
  return validateVocabularyPackage({ format: "nine-rings-vocabulary", version: 1, id, revision: 1, name, entries });
}

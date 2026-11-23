import { Inflate } from "fflate";
import { fileSegments } from "./file-model";

export const MAX_ZIP_BYTES = 32 * 1024 * 1024;
export const MAX_ZIP_ENTRY_BYTES = 8 * 1024 * 1024;
export interface BrowserZipEntry {
  path: string;
  directory: boolean;
  size: number;
  method: number;
  offset: number;
  compressed: number;
  crc: number;
}

const ZIP_END = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function zipTextHasControls(text: string, allowWhitespace = false) {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (allowWhitespace && (code === 9 || code === 10 || code === 13)) continue;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function indexBrowserZip(data: Uint8Array): BrowserZipEntry[] {
  if (data.length < 22 || data.length > MAX_ZIP_BYTES) throw new Error("ZIP 文件无效或超过 32 MiB");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  let end = data.length - 22;
  const lower = Math.max(0, end - 65535);
  while (end >= lower && (u32(end) !== ZIP_END || end + 22 + u16(end + 20) !== data.length)) end--;
  if (end < lower) throw new Error("未找到完整的 ZIP 目录");
  const count = u16(end + 10);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || count > 3000) throw new Error("仅支持最多 3000 项的单卷 ZIP");
  const start = u32(end + 16);
  if (start + u32(end + 12) !== end) throw new Error("ZIP 目录长度无效");
  const entries = new Map<string, BrowserZipEntry>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let cursor = start;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || u32(cursor) !== CENTRAL) throw new Error("ZIP 条目头损坏");
    const flag = u16(cursor + 8), method = u16(cursor + 10), crc = u32(cursor + 16);
    const compressed = u32(cursor + 20), size = u32(cursor + 24), nameSize = u16(cursor + 28);
    const local = u32(cursor + 42), attributes = u32(cursor + 38);
    const next = cursor + 46 + nameSize + u16(cursor + 30) + u16(cursor + 32);
    if (next > end || !nameSize || nameSize > 4096 || u16(cursor + 34) || local + 30 > start) throw new Error("ZIP 条目范围无效");
    const name = decoder.decode(data.subarray(cursor + 46, cursor + 46 + nameSize));
    const directory = name.endsWith("/");
    const path = directory ? name.slice(0, -1) : name;
    const segments = fileSegments(path);
    if (!segments.length || segments.length > 32 || zipTextHasControls(path) || entries.has(path)) throw new Error("ZIP 包含无效或重复的条目路径");
    if (((attributes >>> 16) & 0xf000) === 0xa000) throw new Error("ZIP 包含符号链接");
    if ((flag & 0x41) || (method !== 0 && method !== 8)) throw new Error("不支持加密或非 Store/Deflate ZIP");
    if (u32(local) !== LOCAL || u16(local + 6) !== flag || u16(local + 8) !== method) throw new Error("ZIP 本地条目头与目录不符");
    const localNameSize = u16(local + 26);
    const offset = local + 30 + localNameSize + u16(local + 28);
    if (offset + compressed > start || (method === 0 && compressed !== size) ||
      decoder.decode(data.subarray(local + 30, local + 30 + localNameSize)) !== name) throw new Error("ZIP 条目数据范围无效");
    entries.set(path, { path, directory, size, method, offset, compressed, crc });
    cursor = next;
  }
  if (cursor !== end) throw new Error("ZIP 目录内容不完整");
  for (const entry of entries.values()) {
    const parts = entry.path.split("/");
    for (let count = 1; count < parts.length; count++) {
      const parent = parts.slice(0, count).join("/");
      const existing = entries.get(parent);
      if (existing && !existing.directory) throw new Error("ZIP 文件与目录路径冲突");
      if (!existing) {
        if (entries.size >= 3000) throw new Error("ZIP 目录项过多");
        entries.set(parent, { path: parent, directory: true, size: 0, method: 0, offset: 0, compressed: 0, crc: 0 });
      }
    }
  }
  return [...entries.values()].sort((a, b) => Number(b.directory) - Number(a.directory) || a.path.localeCompare(b.path));
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  for (let bit = 0; bit < 8; bit++) index = (index >>> 1) ^ (index & 1 ? 0xedb88320 : 0);
  return index;
});

export function extractBrowserZipEntry(data: Uint8Array, entry: BrowserZipEntry): Uint8Array<ArrayBuffer> {
  if (entry.directory || entry.size > MAX_ZIP_ENTRY_BYTES) throw new Error("单个解压文件最多 8 MiB");
  const input = data.subarray(entry.offset, entry.offset + entry.compressed);
  const output = new Uint8Array(entry.size);
  let offset = 0;
  const append = (chunk: Uint8Array) => {
    if (offset + chunk.length > output.length) throw new Error("ZIP 实际大小超出目录记录");
    output.set(chunk, offset); offset += chunk.length;
  };
  if (entry.method === 0) append(input);
  else {
    const inflate = new Inflate(append);
    for (let start = 0; start < input.length; start += 4096) inflate.push(input.subarray(start, start + 4096), start + 4096 >= input.length);
  }
  let checksum = 0xffffffff;
  for (const byte of output) checksum = (checksum >>> 8) ^ crcTable[(checksum ^ byte) & 0xff];
  if (offset !== entry.size || ((checksum ^ 0xffffffff) >>> 0) !== entry.crc) throw new Error("ZIP 条目大小或 CRC 校验失败");
  return output;
}

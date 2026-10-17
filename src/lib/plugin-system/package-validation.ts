import semver from "semver";
import { runtimeKind } from "../runtime";
import packageInfo from "../../../package.json";
import { Inflate } from "fflate";
import schemaCheck from "./generated-package-validator.js";
import { parseSyncJson } from "../sync/strict-json";
import { validateThemeResource, type ThemeResource } from "./theme-resources";

export const PACKAGE_LIMITS = Object.freeze({
  compressed: 2 * 1024 * 1024,
  decoded: 4 * 1024 * 1024,
  file: 512 * 1024,
  files: 32,
  themes: 8,
  installed: 8,
});
export const PLUGIN_API_VERSION = "0.1.0";
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
const invalid = (reason: string): never => {
  throw Error(`插件包无效：${reason}`);
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export function safePackagePath(path: string): string {
  // Deliberately ASCII-only: no normalization ambiguity, platform drive/ADS, encoded traversal or case collision.
  if (
    path.length > 160 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(path) ||
    path
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    return invalid("资源路径不安全");
  return path;
}
export async function packageDigest(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
/** Preflight central + local headers before inflation; reject ZIP64, encryption, symlinks and overlap. */
export function readPluginArchive(
  bytes: Uint8Array,
): Record<string, Uint8Array> {
  if (bytes.length > PACKAGE_LIMITS.compressed || bytes.length < 22)
    return invalid("ZIP 超过预算或已损坏");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true),
    u32 = (offset: number) => view.getUint32(offset, true);
  let end = bytes.length - 22;
  // No trailing bytes; allow standard bounded ZIP comments.
  while (end >= Math.max(0, bytes.length - 65557) && u32(end) !== 0x06054b50)
    end--;
  if (
    end < 0 ||
    u32(end) !== 0x06054b50 ||
    end + 22 + u16(end + 20) !== bytes.length ||
    u16(end + 4) ||
    u16(end + 6)
  )
    return invalid("ZIP 目录不完整");
  const count = u16(end + 10),
    central = u32(end + 16);
  if (
    !count ||
    count > PACKAGE_LIMITS.files ||
    u16(end + 8) !== count ||
    central + u32(end + 12) !== end
  )
    return invalid("ZIP 文件数或目录无效");
  let position = central,
    total = 0;
  const names = new Set<string>(),
    ranges: [number, number][] = [];
  const files: Record<string, Uint8Array> = Object.create(null);
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || u32(position) !== 0x02014b50)
      return invalid("ZIP 目录损坏");
    const flags = u16(position + 8),
      method = u16(position + 10),
      packed = u32(position + 20),
      size = u32(position + 24),
      nameSize = u16(position + 28),
      extra = u16(position + 30),
      comment = u16(position + 32),
      local = u32(position + 42);
    if (
      position + 46 + nameSize + extra + comment > end ||
      flags & ~0x808 ||
      ![0, 8].includes(method) ||
      u16(position + 34) ||
      ((u32(position + 38) >>> 16) & 0xf000) === 0xa000 ||
      size > PACKAGE_LIMITS.file ||
      packed > PACKAGE_LIMITS.compressed ||
      (method === 0 && packed !== size)
    )
      return invalid("ZIP 特性或资源大小不受支持");
    const name = safePackagePath(
      decoder.decode(bytes.subarray(position + 46, position + 46 + nameSize)),
    );
    if (names.has(name.toLowerCase())) return invalid("资源路径重复");
    names.add(name.toLowerCase());
    total += size;
    if (
      total > PACKAGE_LIMITS.decoded ||
      local + 30 > central ||
      u32(local) !== 0x04034b50 ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method
    )
      return invalid("ZIP 本地头无效或超过解压预算");
    const localName = u16(local + 26),
      localExtra = u16(local + 28),
      start = local + 30 + localName + localExtra,
      finish = start + packed;
    if (
      finish > central ||
      decoder.decode(bytes.subarray(local + 30, local + 30 + localName)) !==
        name ||
      ranges.some(([a, b]) => local < b && finish > a)
    )
      return invalid("ZIP 资源重叠或名称不一致");
    if (
      !(flags & 8) &&
      (u32(local + 18) !== packed ||
        u32(local + 22) !== size ||
        u32(local + 14) !== u32(position + 16))
    )
      return invalid("ZIP 本地大小或校验值不一致");
    const output = new Uint8Array(size);
    let produced = 0;
    if (method === 0) {
      output.set(bytes.subarray(start, finish));
      produced = size;
    } else {
      // Tiny compressed chunks bound temporary output even when the directory lies about decoded size.
      const inflate = new Inflate((chunk) => {
        if (produced + chunk.length > size)
          return invalid("ZIP 解压超过声明预算");
        output.set(chunk, produced);
        produced += chunk.length;
      });
      for (let offset = start; offset < finish; offset += 128)
        inflate.push(
          bytes.subarray(offset, Math.min(offset + 128, finish)),
          offset + 128 >= finish,
        );
    }
    if (produced !== size || crc32(output) !== u32(position + 16))
      return invalid("ZIP 大小或 CRC 校验不一致");
    ranges.push([local, finish]);
    files[name] = output;
    position += 46 + nameSize + extra + comment;
  }
  if (position !== end) return invalid("ZIP 目录边界无效");
  return files;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function packageJson(source: string): unknown {
  try {
    return parseSyncJson(source);
  } catch {
    return invalid("JSON 损坏、包含重复键或不安全数字");
  }
}
export interface ValidatedPluginPackage {
  id: string;
  name: string;
  description: string;
  version: string;
  digest: string;
  themes: readonly ThemeResource[];
  files: Record<string, string>;
}
function localized(value: unknown): string {
  return typeof value === "string"
    ? value
    : object(value) && typeof value.default === "string"
      ? value.default
      : "";
}
/** Admission is deliberately limited to the shipped theme interpreter. Other contribution gates stay closed. */
export async function validatePluginPackage(
  files: Record<string, Uint8Array>,
  appVersion = packageInfo.version,
  platform: "web" | "tauri" = runtimeKind(),
): Promise<ValidatedPluginPackage> {
  const entries = Object.entries(files);
  if (!entries.length || entries.length > PACKAGE_LIMITS.files)
    return invalid("资源数量无效");
  let total = 0;
  const paths = new Set<string>(),
    text: Record<string, string> = Object.create(null),
    hashes: Record<string, string> = Object.create(null);
  for (const [path, bytes] of entries) {
    safePackagePath(path);
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.length > PACKAGE_LIMITS.file ||
      paths.has(path.toLowerCase())
    )
      return invalid("资源超限或路径重复");
    total += bytes.length;
    paths.add(path.toLowerCase());
    if (total > PACKAGE_LIMITS.decoded) return invalid("资源总量超限");
    if (!path.endsWith(".json")) return invalid("当前仅允许声明式 JSON 资源");
    text[path] = decoder.decode(bytes);
    hashes[path] = await packageDigest(bytes);
  }
  const manifest = packageJson(text["manifest.json"] ?? "");
  if (!schemaCheck(manifest) || !object(manifest))
    return invalid("manifest 不符合严格 schema");
  if (
    ["entry", "permissions", "activationEvents"].some((key) =>
      Object.prototype.hasOwnProperty.call(manifest, key),
    )
  )
    return invalid("L0 不允许脚本入口、权限或激活事件");
  if (
    Array.isArray(manifest.platforms) &&
    !manifest.platforms.includes(platform)
  )
    return invalid("插件不支持当前平台");
  const id = manifest.id as string,
    version = manifest.version as string;
  if (
    id.startsWith("nine-rings.") ||
    !/^[a-z][a-z0-9.-]{0,63}$/.test(id) ||
    !semver.valid(version)
  )
    return invalid("插件 ID 或版本无效，官方命名空间不可覆盖");
  const engines = manifest.engines as Record<string, string>;
  for (const [key, current] of [
    ["nineRingsPluginApi", PLUGIN_API_VERSION],
    ["app", appVersion],
  ] as const) {
    const range = engines[key];
    if (
      (key === "nineRingsPluginApi" || range !== undefined) &&
      (!semver.validRange(range) || !semver.satisfies(current, range))
    )
      return invalid("宿主版本不兼容");
  }
  const contributes = manifest.contributes as Record<string, unknown>;
  if (
    Object.keys(contributes).some((key) => key !== "themes") ||
    !Array.isArray(contributes.themes) ||
    !contributes.themes.length ||
    contributes.themes.length > PACKAGE_LIMITS.themes
  )
    return invalid("当前安装仅开放成对主题资源，其它贡献点尚未开放");
  const integrity = manifest.integrity as
    { algorithm: string; files: Record<string, string> } | undefined;
  if (
    !integrity ||
    integrity.algorithm !== "sha256" ||
    Object.keys(integrity.files).length !== entries.length - 1 ||
    Object.keys(integrity.files).some(
      (path) =>
        path === "manifest.json" || hashes[path] !== integrity.files[path],
    )
  )
    return invalid("必须完整核验 manifest 之外的全部资源");
  const themes: ThemeResource[] = [],
    used = new Set<string>();
  for (const entry of contributes.themes) {
    if (!object(entry) || typeof entry.resource !== "string")
      return invalid("主题须使用成对资源文件");
    const path = safePackagePath(entry.resource);
    if (!text[path] || path === "manifest.json" || used.has(path))
      return invalid("主题资源缺失或重复");
    used.add(path);
    const resource = validateThemeResource(packageJson(text[path]));
    if (
      resource.id !== `${id}/${entry.id}` ||
      resource.name !== localized(entry.name) ||
      themes.some((theme) => theme.id === resource.id)
    )
      return invalid("主题 ID、名称或归属不一致");
    themes.push(resource);
  }
  if (used.size !== entries.length - 1) return invalid("包中包含未声明资源");
  // The confirmation fingerprint covers manifest bytes as well as all resource bytes; integrity alone is not trust.
  const digest = await packageDigest(
    encoder.encode(
      JSON.stringify(
        Object.entries(hashes).sort(([a], [b]) => (a < b ? -1 : 1)),
      ),
    ),
  );
  return {
    id,
    name: localized(manifest.name),
    description: localized(manifest.description),
    version,
    digest,
    themes,
    files: text,
  };
}
export async function readPluginFile(file: File) {
  if (file.size > PACKAGE_LIMITS.compressed) return invalid("压缩包超过 2 MiB");
  return validatePluginPackage(
    readPluginArchive(new Uint8Array(await file.arrayBuffer())),
  );
}

export function validatePackageUpdate(previous: string, next: string) {
  if (
    !semver.valid(previous) ||
    !semver.valid(next) ||
    !semver.gt(next, previous)
  )
    return invalid("更新须提升版本号；同版不同内容或降级不能覆盖已安装包");
}

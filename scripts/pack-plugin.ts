/** Pack a local declarative resource directory. Never install, overwrite output, or follow symlinks. */
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { parseSyncJson } from "../src/lib/sync/strict-json";
import { packageDigest, safePackagePath, validatePluginPackage, PACKAGE_LIMITS } from "../src/lib/plugin-system/package-validation";

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw Error("用法：node --import tsx scripts/pack-plugin.ts <插件目录> <输出.nrplugin.zip>");
const root = resolve(source), output = resolve(destination);
if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw Error("插件目录须为真实目录");
const files: Record<string, Uint8Array> = Object.create(null);
let count = 0, total = 0;
async function walk(directory: string, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    safePackagePath(name);
    if (++count > PACKAGE_LIMITS.files * 2 || entry.isSymbolicLink()) throw Error("目录项超限或包含符号链接");
    const path = join(directory, entry.name), stat = await lstat(path);
    if (stat.isSymbolicLink()) throw Error("不跟随符号链接");
    if (stat.isDirectory()) await walk(path, name + "/");
    else if (stat.isFile()) {
      if (stat.size > PACKAGE_LIMITS.file) throw Error("资源文件过大");
      const bytes = new Uint8Array(await readFile(path));
      total += bytes.length;
      if (total > PACKAGE_LIMITS.decoded) throw Error("资源总量超限");
      files[name] = bytes;
    } else throw Error("只允许普通文件与目录");
  }
}
await walk(root);
const manifest = parseSyncJson(new TextDecoder("utf-8", { fatal: true }).decode(files["manifest.json"])) as { integrity: { algorithm: string; files: Record<string, string> }; [key: string]: unknown };
manifest.integrity = { algorithm: "sha256", files: {} };
for (const [path, bytes] of Object.entries(files)) if (path !== "manifest.json") manifest.integrity.files[path] = await packageDigest(bytes);
files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2) + "\n");
const target = Array.isArray(manifest.platforms) && !manifest.platforms.includes("web") && manifest.platforms.includes("tauri") ? "tauri" : "web";
const validated = await validatePluginPackage(files, undefined, target);
const archive = zipSync(files);
if (archive.length > PACKAGE_LIMITS.compressed) throw Error("压缩包超过安装预算");
await writeFile(output, archive, { flag: "wx" });
console.log(`${validated.id} ${validated.version} · ${validated.themes.length} 份主题 · ${validated.content.length} 份模板/片段 · ${validated.gutters.length} 个编号目标 · ${validated.statusBar ? 1 : 0} 份状态栏展示 · ${archive.length} bytes\nSHA-256 ${validated.digest}\n${output}`);

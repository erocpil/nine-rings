/** Device-local plugin bytes/trust, kept out of document backups. No filesystem extraction. */
import type { ValidatedPluginPackage } from "./package-validation";
export interface InstalledPluginPackage {
  id: string;
  name: string;
  version: string;
  digest: string;
  files: Record<string, string>;
  enabled: boolean;
  trustedDigest: string;
  installedAt: string;
}
const DATABASE = "nine-rings-plugin-packages";
const CHANGE = "nr:plugin-packages-change";
const SIGNAL_KEY = "nr:plugin-packages-revision";
export function subscribePluginPackages(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === SIGNAL_KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGE, listener);
    window.removeEventListener("storage", storage);
  };
}
function changed() {
  window.dispatchEvent(new Event(CHANGE));
  try {
    localStorage.setItem(SIGNAL_KEY, crypto.randomUUID());
  } catch {
    /* Local listener still receives durable changes. */
  }
}
async function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("packages", { keyPath: "id" });
    let abandoned = false;
    request.onsuccess = () => {
      if (abandoned) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(Error("无法打开本机插件存储"));
    request.onblocked = () => {
      abandoned = true;
      reject(Error("插件存储升级被其它窗口占用，请关闭其它窗口后重试"));
    };
  });
}
export async function listPluginPackages(): Promise<InstalledPluginPackage[]> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("packages", "readonly"),
        request = tx.objectStore("packages").getAll();
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(Error("读取本机插件失败"));
      tx.onerror = () => {};
    });
  } finally {
    db.close();
  }
}
async function mutate(
  id: string,
  expectedDigest: string | null,
  update: (
    current: InstalledPluginPackage | undefined,
    all: InstalledPluginPackage[],
  ) => InstalledPluginPackage | null,
) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("packages", "readwrite"),
        store = tx.objectStore("packages"),
        request = store.getAll();
      let failure: unknown;
      request.onsuccess = () => {
        try {
          const all = request.result as InstalledPluginPackage[],
            current = all.find((row) => row.id === id);
          if ((current?.digest ?? null) !== expectedDigest)
            throw Error("插件已在其它窗口变化，请重新审查");
          const next = update(current, all);
          if (next) store.put(next);
          else store.delete(id);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(failure ?? Error("保存插件失败，本次修改未生效"));
      tx.onerror = () => {};
    });
  } finally {
    db.close();
  }
  changed();
}
export async function installPluginPackage(
  candidate: ValidatedPluginPackage,
  expectedDigest: string | null,
  consent: boolean,
) {
  if (consent !== true) throw Error("需要明确确认来源及安装差异");
  // Revalidate exact bytes again at confirmation; a preview object is never executable authority.
  const { validatePluginPackage, validatePackageUpdate, PACKAGE_LIMITS } =
    await import("./package-validation");
  const encoder = new TextEncoder();
  const validated = await validatePluginPackage(
    Object.fromEntries(
      Object.entries(candidate.files).map(([path, text]) => [
        path,
        encoder.encode(text),
      ]),
    ),
  );
  if (validated.digest !== candidate.digest || validated.id !== candidate.id)
    throw Error("插件预览内容已变化，请重新选择文件");
  await mutate(validated.id, expectedDigest, (current, all) => {
    if (!current && all.length >= PACKAGE_LIMITS.installed)
      throw Error("最多安装 8 个声明式插件包");
    // Keep eight theme slots reserved for builtin resources regardless of activation order.
    const others = all.filter((row) => row.id !== validated.id);
    if (
      others.reduce(
        (sum, row) =>
          sum +
          (JSON.parse(row.files["manifest.json"]).contributes.themes?.length ??
            0),
        validated.themes.length,
      ) > 24
    )
      throw Error("已安装主题资源超过 24 份预算");
    if (current) {
      if (current.digest === validated.digest) return current;
      validatePackageUpdate(current.version, validated.version);
    }
    return {
      id: validated.id,
      name: validated.name,
      version: validated.version,
      digest: validated.digest,
      files: validated.files,
      enabled: false,
      trustedDigest: validated.digest,
      installedAt: new Date().toISOString(),
    };
  });
}
export function setPluginPackageEnabled(
  record: InstalledPluginPackage,
  enabled: boolean,
) {
  return mutate(record.id, record.digest, (current) => {
    if (!current || current.trustedDigest !== current.digest)
      throw Error("插件尚未确认来源，请重新安装并审查");
    return { ...current, enabled };
  });
}
export function removePluginPackage(record: InstalledPluginPackage) {
  return mutate(record.id, record.digest, () => null);
}

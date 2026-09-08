import { isTauriRuntime } from "./runtime";

const BACKED_UP_LOCAL_SETTINGS = [
  "nine-rings:templates",
  "nr:github-sync",
  "nr:focusMode",
  "nr:sidebarHidden",
  "nr:sidebarTab",
  "nr:todoSplit",
  "nr:sidebarW",
  "nr:sortMode",
  "nr:sidebarShowAll",
  "nr:codeLineNumbers",
  "nr:currentDate",
  "nr:lastNote",
  "nr:workspaceTarget",
  "nr:activeTag",
  "nr:docTreeCollapsed",
  "nr:documentFavorites",
  "nr:docTreeScrollTop",
  "nr:sidebarScrollToday",
  "nr:sidebarScrollAll",
] as const;

const DOCUMENT_POSITION_PREFIXES = ["selectionPos:", "scrollPos:"] as const;
export const BACKUP_DEVICE_ID_KEY = "nr:backup-device-id";

export interface FrontendSettingsBackup {
  version: 1;
  values: Record<string, unknown>;
}

export interface BackupMetadata {
  version: 1;
  exportedAt: string;
  device: {
    id: string;
    name: string;
    runtime: "web" | "tauri";
    platform: string;
    userAgent?: string;
  };
}

type SettingsReadStorage = Pick<Storage, "getItem" | "setItem">;
type SettingsWriteStorage = Pick<Storage, "setItem">;

function defaultReadStorage(): SettingsReadStorage {
  return typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => undefined };
}

function defaultWriteStorage(): SettingsWriteStorage {
  return typeof localStorage !== "undefined" ? localStorage : { setItem: () => undefined };
}

function readStoredValue(storage: Pick<Storage, "getItem">, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredValue(
  storage: Pick<Storage, "setItem">,
  key: string,
  value: string,
): void {
  try {
    storage.setItem(key, value);
  } catch {
    // ignore
  }
}

function newDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const random = Math.random().toString(36).slice(2, 10);
  return `dev-${Date.now().toString(36)}-${random}`;
}

export function getOrCreateDeviceId(
  storage: Pick<Storage, "getItem" | "setItem">,
): string {
  const existing = readStoredValue(storage, BACKUP_DEVICE_ID_KEY);
  if (existing) return existing;
  const created = newDeviceId();
  writeStoredValue(storage, BACKUP_DEVICE_ID_KEY, created);
  return created;
}

function collectBackupMetadata(storage: SettingsReadStorage = defaultReadStorage()): BackupMetadata {
  const runtime = isTauriRuntime() ? "tauri" : "web";
  const platform =
    typeof navigator === "undefined" ? "未知平台" : navigator.platform || "未知平台";
  const label = `${runtime} / ${platform}`;
  const userAgent =
    typeof navigator === "undefined" ? undefined : navigator.userAgent;
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    device: {
      id: getOrCreateDeviceId(storage),
      name: label,
      runtime,
      platform,
      userAgent: userAgent ? userAgent.slice(0, 200) : undefined,
    },
  };
}

function sensitiveKey(key: string): boolean {
  return /(token|password|secret|credential|authorization)/i.test(key);
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (!sensitiveKey(key)) sanitized[key] = sanitize(child);
    }
    return sanitized;
  }
  return value;
}

function parseStoredValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function serializeStoredValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function validNoteId(value: string | null): value is string {
  return Boolean(value && /^[a-zA-Z0-9_-]{1,128}$/.test(value));
}

function isDocumentPositionKey(key: string): boolean {
  return DOCUMENT_POSITION_PREFIXES.some((prefix) => {
    if (!key.startsWith(prefix)) return false;
    return validNoteId(key.slice(prefix.length));
  });
}

export function collectFrontendSettings(storage: SettingsReadStorage = defaultReadStorage()): FrontendSettingsBackup {
  const values: Record<string, unknown> = {};
  for (const key of BACKED_UP_LOCAL_SETTINGS) {
    const raw = storage.getItem(key);
    if (raw === null) continue;
    const parsed = parseStoredValue(raw);
    // GitHub 配置必须是合法对象；脏字符串可能混有旧版明文 Token，宁可跳过。
    if (key === "nr:github-sync" && (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) continue;
    values[key] = sanitize(parsed);
  }
  // 阅读位置只需跟随最后打开的文档；避免把所有历史文档的临时位置无限写入备份。
  const lastNoteId = storage.getItem("nr:lastNote");
  if (validNoteId(lastNoteId)) {
    for (const prefix of DOCUMENT_POSITION_PREFIXES) {
      const key = `${prefix}${lastNoteId}`;
      const raw = storage.getItem(key);
      if (raw !== null) values[key] = sanitize(parseStoredValue(raw));
    }
  }
  return { version: 1, values };
}

export function restoreFrontendSettings(
  backup: unknown,
  storage: SettingsWriteStorage = defaultWriteStorage(),
): number {
  if (!backup || typeof backup !== "object") return 0;
  const values = (backup as Partial<FrontendSettingsBackup>).values;
  if (!values || typeof values !== "object" || Array.isArray(values)) return 0;
  const allowed = new Set<string>(BACKED_UP_LOCAL_SETTINGS);
  let restored = 0;
  for (const [key, rawValue] of Object.entries(values)) {
    if ((!allowed.has(key) && !isDocumentPositionKey(key)) || sensitiveKey(key)) continue;
    const value = sanitize(rawValue);
    if (value === undefined) continue;
    storage.setItem(key, serializeStoredValue(value));
    restored += 1;
  }
  return restored;
}

export function addFrontendSettingsToBackup(
  json: string,
  storage: SettingsReadStorage = defaultReadStorage(),
): string {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Backup root must be a JSON object");
  }
  parsed.user_settings = collectFrontendSettings(storage);
  parsed.backup_metadata = collectBackupMetadata(storage);
  return JSON.stringify(parsed, null, 2);
}

/** Stage fallible local settings before committing documents; roll back on failure. */
export async function withFrontendSettings<T>(
  backup: unknown,
  commit: (count: number) => Promise<T>,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = typeof localStorage !== "undefined"
    ? localStorage : { getItem: () => null, setItem: () => {}, removeItem: () => {} },
): Promise<T> {
  const previous = new Map<string, string | null>();
  try {
    const count = restoreFrontendSettings(backup, {
      setItem(key, value) {
        if (!previous.has(key)) previous.set(key, storage.getItem(key));
        storage.setItem(key, value);
      },
    });
    return await commit(count);
  } catch (error) {
    for (const [key, value] of previous) {
      if (storage.getItem(key) === value) continue;
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    }
    throw error;
  }
}

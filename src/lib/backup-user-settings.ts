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
] as const;

export interface FrontendSettingsBackup {
  version: 1;
  values: Record<string, unknown>;
}

type SettingsReadStorage = Pick<Storage, "getItem">;
type SettingsWriteStorage = Pick<Storage, "setItem">;

function defaultReadStorage(): SettingsReadStorage {
  return typeof localStorage !== "undefined" ? localStorage : { getItem: () => null };
}

function defaultWriteStorage(): SettingsWriteStorage {
  return typeof localStorage !== "undefined" ? localStorage : { setItem: () => undefined };
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
    if (!allowed.has(key) || sensitiveKey(key)) continue;
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
  const trimmed = json.trimEnd();
  if (!trimmed.endsWith("}")) throw new Error("Backup root must be a JSON object");
  const prefix = trimmed.slice(0, -1).trimEnd();
  const settings = JSON.stringify(collectFrontendSettings(storage), null, 2)
    .replace(/\n/g, "\n  ");
  return `${prefix}${prefix.endsWith("{") ? "" : ","}\n  "user_settings": ${settings}\n}`;
}

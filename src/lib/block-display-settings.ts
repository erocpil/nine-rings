const KEY = "nr:codeBlockHeightPercent";
const EVENT = "nine-rings:block-display-change";
export const BLOCK_WORKSPACE_DISPLAY_EVENT = "nine-rings:block-workspace-display-change";
export type WorkspacePreferences = { fontSize?: number; tabSize?: number; whitespace?: "off" | "all" | "abnormal"; lineNumbers?: boolean; wrap?: boolean };
const WORKSPACE_KEY = "nr:blockWorkspaceDisplay";
export function blockWorkspacePreferences(): WorkspacePreferences {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(WORKSPACE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const value = parsed as Record<string, unknown>;
    const preferences: WorkspacePreferences = {};
    if (typeof value.fontSize === "number" && value.fontSize >= 12 && value.fontSize <= 32) preferences.fontSize = value.fontSize;
    if (typeof value.tabSize === "number" && [2, 4, 8].includes(value.tabSize)) preferences.tabSize = value.tabSize;
    if (value.whitespace === "off" || value.whitespace === "all" || value.whitespace === "abnormal") preferences.whitespace = value.whitespace;
    if (typeof value.lineNumbers === "boolean") preferences.lineNumbers = value.lineNumbers;
    if (typeof value.wrap === "boolean") preferences.wrap = value.wrap;
    return preferences;
  } catch { return {}; }
}
export function saveBlockWorkspacePreferences(patch: WorkspacePreferences) {
  try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ ...blockWorkspacePreferences(), ...patch })); }
  catch { /* Display controls remain usable if local storage is unavailable. */ }
  window.dispatchEvent(new Event(BLOCK_WORKSPACE_DISPLAY_EVENT));
}
export function codeBlockHeightPercent() {
  const value = Number(localStorage.getItem(KEY));
  return [40, 60, 80, 100].includes(value) ? value : 60;
}
function apply() {
  document.documentElement.style.setProperty("--code-block-height", `calc(var(--app-viewport-height, 100dvh) * ${codeBlockHeightPercent() / 100})`);
}
export function setCodeBlockHeightPercent(value: number) {
  if (![40, 60, 80, 100].includes(value)) return;
  localStorage.setItem(KEY, String(value));
  apply();
  window.dispatchEvent(new Event(EVENT));
}

/** Commit both display preferences before notifying any live editor. */
export function commitBlockDisplaySettings(preferences: WorkspacePreferences, height: number) {
  if (![40, 60, 80, 100].includes(height)) throw new Error("无效的代码块高度");
  const previous = [WORKSPACE_KEY, KEY].map(key => [key, localStorage.getItem(key)] as const);
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(preferences));
    localStorage.setItem(KEY, String(height));
  } catch (error) {
    try {
      for (const [key, value] of previous) {
        if (localStorage.getItem(key) === value) continue;
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    } catch {
      throw new Error("本机显示设置保存及回滚失败，请检查存储权限并重新打开设置核对。");
    }
    throw error;
  }
  apply();
  window.dispatchEvent(new Event(BLOCK_WORKSPACE_DISPLAY_EVENT));
  window.dispatchEvent(new Event(EVENT));
}
export function watchBlockDisplaySettings() {
  apply();
  window.addEventListener("storage", apply);
  return () => window.removeEventListener("storage", apply);
}

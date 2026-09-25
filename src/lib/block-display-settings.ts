const KEY = "nr:codeBlockHeightPercent";
const EVENT = "nine-rings:block-display-change";
export const BLOCK_WORKSPACE_DISPLAY_EVENT = "nine-rings:block-workspace-display-change";
export type WorkspacePreferences = { mermaidDisplay?: "fit" | "scroll"; fontSize?: number; tabSize?: number; whitespace?: "off" | "all" | "abnormal"; lineNumbers?: boolean; wrap?: boolean; listFollowupIndent?: boolean };
const WORKSPACE_KEY = "nr:blockWorkspaceDisplay";
const CODE_LINE_NUMBERS_KEY = "nr:codeLineNumbers";
export function codeLineNumbersEnabled(): boolean {
  try {
    const saved = localStorage.getItem(CODE_LINE_NUMBERS_KEY);
    if (saved !== null) return saved === "true";
    return JSON.parse(localStorage.getItem(WORKSPACE_KEY) ?? "{}").lineNumbers === true;
  } catch { return false; }
}
export function blockWorkspacePreferences(): WorkspacePreferences {
  const preferences: WorkspacePreferences = { lineNumbers: codeLineNumbersEnabled() };
  try {
    const legacyTab = Number(localStorage.getItem("nr:vim-config")?.match(/(?:^|\n)\s*set\s+tabstop=(\d+)/)?.[1]);
    if (Number.isInteger(legacyTab) && legacyTab >= 1 && legacyTab <= 16) preferences.tabSize = legacyTab;
    const parsed: unknown = JSON.parse(localStorage.getItem(WORKSPACE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return preferences;
    const value = parsed as Record<string, unknown>;
    if (typeof value.fontSize === "number" && value.fontSize >= 12 && value.fontSize <= 32) preferences.fontSize = value.fontSize;
    if (typeof value.tabSize === "number" && Number.isInteger(value.tabSize) && value.tabSize >= 1 && value.tabSize <= 16) preferences.tabSize = value.tabSize;
    if (value.whitespace === "off" || value.whitespace === "all" || value.whitespace === "abnormal") preferences.whitespace = value.whitespace;
    if (value.mermaidDisplay === "fit" || value.mermaidDisplay === "scroll") preferences.mermaidDisplay = value.mermaidDisplay;
    if (typeof value.wrap === "boolean") preferences.wrap = value.wrap;
    if (typeof value.listFollowupIndent === "boolean") preferences.listFollowupIndent = value.listFollowupIndent;
    return preferences;
  } catch { return preferences; }
}
export function saveBlockWorkspacePreferences(patch: WorkspacePreferences) {
  try {
    if (patch.lineNumbers !== undefined) localStorage.setItem(CODE_LINE_NUMBERS_KEY, String(patch.lineNumbers));
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ ...blockWorkspacePreferences(), ...patch }));
  }
  catch { /* Display controls remain usable if local storage is unavailable. */ }
  apply();
  window.dispatchEvent(new Event(BLOCK_WORKSPACE_DISPLAY_EVENT));
}
export function codeBlockHeightPercent() {
  const value = Number(localStorage.getItem(KEY));
  return [40, 60, 80, 100].includes(value) ? value : 60;
}
function apply() {
  const scrollDiagrams = blockWorkspacePreferences().mermaidDisplay === "scroll";
  document.documentElement.style.setProperty("--mermaid-inline-max-width", scrollDiagrams ? "none" : "100%");
  document.documentElement.style.setProperty("--mermaid-inline-max-height", scrollDiagrams ? "60dvh" : "none");
  document.documentElement.style.setProperty("--list-followup-indent-enabled", blockWorkspacePreferences().listFollowupIndent === false ? "0" : "1");
  document.documentElement.style.setProperty("--code-tab-size", String(blockWorkspacePreferences().tabSize ?? 4));
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
  const previous = [WORKSPACE_KEY, KEY, CODE_LINE_NUMBERS_KEY].map(key => [key, localStorage.getItem(key)] as const);
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(preferences));
    localStorage.setItem(KEY, String(height));
    if (preferences.lineNumbers !== undefined) localStorage.setItem(CODE_LINE_NUMBERS_KEY, String(preferences.lineNumbers));
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

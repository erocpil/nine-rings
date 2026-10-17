import { THEME_PLUGIN_ID } from "./builtin-theme-resources";

export interface ThemePreference {
  enabled: boolean;
  themeId: string;
  typography: boolean;
}
export const THEME_SETTINGS_KEY = "nr:pluginTheme";
const CHANGE = "nr:plugin-theme-change";
export const DEFAULT_THEME_PREFERENCE: Readonly<ThemePreference> =
  Object.freeze({
    enabled: false,
    themeId: `${THEME_PLUGIN_ID}/paper`,
    typography: false,
  });
function validate(value: unknown): ThemePreference {
  const v = value as ThemePreference;
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some(
      (key) => !["enabled", "themeId", "typography"].includes(key),
    ) ||
    typeof v.enabled !== "boolean" ||
    typeof v.typography !== "boolean" ||
    typeof v.themeId !== "string" ||
    !/^[a-z][a-z0-9.-]{0,95}\/[a-z][a-z0-9-]{0,47}$/.test(v.themeId)
  )
    throw Error("主题偏好无效");
  // Missing resources retain their identity and fall back; never silently select another theme.
  return { enabled: v.enabled, themeId: v.themeId, typography: v.typography };
}
export function readThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_SETTINGS_KEY);
    if (raw) return validate(JSON.parse(raw));
  } catch {
    /* Host fallback for corrupt/unavailable local preferences. */
  }
  return { ...DEFAULT_THEME_PREFERENCE };
}
export function themePreferenceSnapshot() {
  try {
    return localStorage.getItem(THEME_SETTINGS_KEY);
  } catch {
    return null;
  }
}
export function subscribeThemePreference(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === THEME_SETTINGS_KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGE, listener);
    window.removeEventListener("storage", storage);
  };
}
export function saveThemePreference(value: ThemePreference) {
  localStorage.setItem(THEME_SETTINGS_KEY, JSON.stringify(validate(value)));
  window.dispatchEvent(new Event(CHANGE));
}

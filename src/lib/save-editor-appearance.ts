import type { AppConfig } from "../types/models";
import { commitBlockDisplaySettings, type WorkspacePreferences } from "./block-display-settings";

export interface BlockDisplayDraft { preferences: WorkspacePreferences; height: number }

/** Keep the draft intact on failure; publish neither half of a failed apply. */
export async function saveEditorAppearance(
  store: { get: () => Promise<AppConfig>; set: (changes: Partial<AppConfig>) => Promise<AppConfig> },
  changes: Partial<AppConfig>,
  display?: BlockDisplayDraft,
): Promise<AppConfig> {
  const before = await store.get();
  const saved = await store.set(changes);
  if (!display) return saved;
  try {
    commitBlockDisplaySettings(display.preferences, display.height);
  } catch (error) {
    const rollback = Object.fromEntries(Object.keys(changes).map(key => [key, before[key as keyof AppConfig]]));
    try { await store.set(rollback); }
    catch { throw new Error("显示设置保存失败，排版配置也未能回滚；请重新打开设置核对后重试。"); }
    throw error;
  }
  return saved;
}

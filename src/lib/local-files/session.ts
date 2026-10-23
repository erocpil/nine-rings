import type { EditorState } from "@codemirror/state";
/** Device-session only; never exported with documents or sync settings. */
export const localFileSessions = new Map<
  string,
  { state: EditorState; scrollTop: number; scrollLeft: number; source: string }
>();
export let localFileSessionEpoch = 0;
export function clearLocalFileSessions(rootId?: string) {
  localFileSessionEpoch++;
  if (!rootId) localFileSessions.clear();
  else
    for (const key of localFileSessions.keys())
      if (key.startsWith(rootId + ":")) localFileSessions.delete(key);
}

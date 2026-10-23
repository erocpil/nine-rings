import type { EditorState } from "@codemirror/state";
/** Device-session only; never exported with documents or sync settings. */
export const localFileSessions = new Map<
  string,
  { state: EditorState; scrollTop: number; scrollLeft: number; source: string }
>();
export let localFileSessionEpoch = 0;
const dirtyLocalFiles = new Set<string>();
export function isLocalFileDirty(identity: string) { return dirtyLocalFiles.has(identity); }
export function setLocalFileDirty(identity: string, dirty: boolean) {
  if (dirty) dirtyLocalFiles.add(identity);
  else dirtyLocalFiles.delete(identity);
}
export function clearLocalFileSessions(rootId?: string) {
  localFileSessionEpoch++;
  if (!rootId) { localFileSessions.clear(); dirtyLocalFiles.clear(); }
  else {
    for (const key of localFileSessions.keys())
      if (key.startsWith(rootId + ":")) localFileSessions.delete(key);
    for (const key of dirtyLocalFiles)
      if (key.startsWith(rootId + ":")) dirtyLocalFiles.delete(key);
  }
}

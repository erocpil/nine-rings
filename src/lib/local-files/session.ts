import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
/** Device-session only; never exported with documents or sync settings. */
export const localFileSessions = new Map<
  string,
  { state: EditorState; scrollTop: number; scrollLeft: number; source: string; scrollSnapshot?: ReturnType<EditorView["scrollSnapshot"]> }
>();
export let localFileSessionEpoch = 0;
/** A path mutation must not let an unmount recreate the former path's cached session. */
export function invalidateLocalFileSessionMounts() { localFileSessionEpoch++; }
const dirtyLocalFiles = new Set<string>();
const checkpoints = new Map<string, () => Promise<void>>();
const savers = new Map<string, () => Promise<boolean>>();
export const LOCAL_FILE_SESSIONS_CHANGED = "nr:local-file-sessions-changed";
export function announceLocalFileSessions() { if (typeof window !== "undefined") window.dispatchEvent(new Event(LOCAL_FILE_SESSIONS_CHANGED)); }
export function dirtyLocalFileIdentities() { return [...dirtyLocalFiles]; }
export function registerLocalFileSaver(identity: string, save: () => Promise<boolean>) {
  savers.set(identity, save);
  return () => { if (savers.get(identity) === save) savers.delete(identity); };
}
export function saveMountedLocalFile(identity: string): Promise<boolean> | null {
  return savers.get(identity)?.() ?? null;
}
export function registerLocalFileCheckpoint(identity: string, checkpoint: () => Promise<void>) {
  checkpoints.set(identity, checkpoint);
  return () => { if (checkpoints.get(identity) === checkpoint) checkpoints.delete(identity); };
}
export async function checkpointLocalFile(identity: string) {
  const checkpoint = checkpoints.get(identity);
  if (checkpoint) await checkpoint();
  else if (dirtyLocalFiles.has(identity)) throw new Error("当前文件的恢复草稿尚未就绪，请稍后关闭。");
}
export async function checkpointLocalFilePath(rootId: string, node: string) {
  const prefix = `${rootId}:${node}`;
  for (const identity of checkpoints.keys())
    if (identity === prefix || identity.startsWith(node ? `${prefix}/` : prefix)) await checkpointLocalFile(identity);
}
export function isLocalFileDirty(identity: string) { return dirtyLocalFiles.has(identity); }
export function setLocalFileDirty(identity: string, dirty: boolean) {
  if (dirtyLocalFiles.has(identity) === dirty) return;
  if (dirty) dirtyLocalFiles.add(identity);
  else dirtyLocalFiles.delete(identity);
  announceLocalFileSessions();
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

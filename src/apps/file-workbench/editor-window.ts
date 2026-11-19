import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { BrowserFileOpen } from "../../lib/local-files/browser-contract";
export interface WorkbenchEditorSession { id: string; file: BrowserFileOpen & { bufferId?: string; bufferPath?: string; untitled?: boolean }; openRevision?: number }
export interface WorkbenchEditorState { files: WorkbenchEditorSession[]; current: string | null; revision: number; closing: { token: number; quit: boolean } | null }
export interface WorkbenchEditorPort {
  read(): Promise<WorkbenchEditorState>;
  listen(changed: () => void): Promise<() => void>;
  select(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  confirm(token: number, id: string): Promise<void>;
  finish(token: number, cancelled: boolean): Promise<void>;
  showBrowser(id?: string): Promise<void>;
  listenQuit?(request: () => void): Promise<() => void>;
  quit?(): Promise<void>;
}
export const editorWindowPort: WorkbenchEditorPort = {
  read: () => invoke("workbench_editor_state"),
  listen: changed => listen("workbench:editor-changed", changed),
  select: id => invoke("workbench_editor_select", { id }),
  remove: id => invoke("workbench_editor_remove", { id }),
  confirm: (token, id) => invoke("workbench_editor_confirm_file", { token, id }),
  finish: (token, cancelled) => invoke("workbench_editor_finish_close", { token, cancelled }),
  showBrowser: id => invoke("workbench_show_browser", { id: id ?? null }),
  listenQuit: request => listen("workbench:confirm-quit", request),
  quit: () => invoke("workbench_editor_request_quit"),
};
export const openWorkbenchEditor = (file: BrowserFileOpen) => invoke<void>("workbench_open_editor", { rootId: file.rootId, node: file.node.id, location: file.location ?? null });
export const showWorkbenchEditor = () => invoke<void>("workbench_show_editor");
export const workbenchWindowRole = () => invoke<"browser" | "editor" | undefined>("workbench_window_role");
export const notifyEditorSaved = (rootId: string, node: string) => invoke<void>("workbench_editor_saved", { rootId, node });

/** Events are wakeups; monotonically revised backend snapshots own the session list. */
export async function watchWorkbenchEditor(port: WorkbenchEditorPort, update: (state: WorkbenchEditorState) => void, error: (cause: unknown) => void) {
  let live = true, revision = -1;
  const refresh = async () => {
    try { const state = await port.read(); if (live && state.revision > revision) { revision = state.revision; update(state); } }
    catch (cause) { if (live) error(cause); }
  };
  const unlisten = await port.listen(() => { void refresh(); });
  await refresh();
  return () => { live = false; unlisten(); };
}

export interface WorkbenchEditorPresence { present: boolean; revision: number }
export const readEditorPresence = () => invoke<WorkbenchEditorPresence>("workbench_editor_presence");

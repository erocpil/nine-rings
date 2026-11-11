import { createQuitConfirmation, QUIT_CONFIRMATION_MS } from "../../lib/quit-confirmation";
export type WorkbenchCloseRequest = (afterLeave?: () => void) => void;
export interface WorkbenchCloseTransport {
  listen(request: () => void): Promise<() => void>;
  listenQuit?(request: () => void): Promise<() => void>;
  ready(): Promise<void>;
  confirm(): Promise<void>;
}
/** Actual exit never bypasses the active source host's leave decision; hiding keeps it mounted. */
export async function installWorkbenchClose(
  request: (confirm: () => void) => void,
  onError: (cause: unknown) => void,
  transport?: WorkbenchCloseTransport,
  onHint: (message: string) => void = () => {},
) {
  const port = transport ?? {
    async listen(callback) { const { listen } = await import("@tauri-apps/api/event"); return listen("workbench:request-close", callback); },
    async listenQuit(callback) { const { listen } = await import("@tauri-apps/api/event"); return listen("workbench:confirm-quit", callback); },
    async ready() { const { invoke } = await import("@tauri-apps/api/core"); await invoke("workbench_ready"); },
    async confirm() { const { invoke } = await import("@tauri-apps/api/core"); await invoke("workbench_confirm_close"); },
  } satisfies WorkbenchCloseTransport;
  let active = true;
  const unlisten = await port.listen(() => {
    if (!active) return;
    request(() => { if (active) void port.confirm().catch(onError); });
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(timer); onHint(""); };
  const confirmation = createQuitConfirmation({
    hint: () => { onHint("再次按下 ⌘Q 退出（2 秒内）"); clearTimeout(timer); timer = setTimeout(clear, QUIT_CONFIRMATION_MS); },
    clear,
    save: async () => {},
    // The source host remains responsible for save/discard/cancel and job guards.
    quit: async () => { if (active) request(() => { if (active) void port.confirm().catch(onError); }); },
    error: onError,
  });
  const reset = () => { confirmation.reset(); clear(); };
  let unlistenQuit: (() => void) | undefined;
  try {
    unlistenQuit = await port.listenQuit?.(() => { if (active) void confirmation.request(); });
    await port.ready();
  } catch (cause) { active = false; unlisten(); unlistenQuit?.(); clear(); throw cause; }
  const focusEvents = typeof window === "undefined" ? undefined : window;
  focusEvents?.addEventListener("blur", reset);
  return () => { active = false; unlisten(); unlistenQuit?.(); focusEvents?.removeEventListener("blur", reset); clear(); };
}

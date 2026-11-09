export type WorkbenchCloseRequest = (afterLeave?: () => void) => void;
export interface WorkbenchCloseTransport {
  listen(request: () => void): Promise<() => void>;
  ready(): Promise<void>;
  confirm(): Promise<void>;
}
/** Native close/quit never bypasses the active source host's leave decision. */
export async function installWorkbenchClose(
  request: (confirm: () => void) => void,
  onError: (cause: unknown) => void,
  transport?: WorkbenchCloseTransport,
) {
  const port = transport ?? {
    async listen(callback) { const { listen } = await import("@tauri-apps/api/event"); return listen("workbench:request-close", callback); },
    async ready() { const { invoke } = await import("@tauri-apps/api/core"); await invoke("workbench_ready"); },
    async confirm() { const { invoke } = await import("@tauri-apps/api/core"); await invoke("workbench_confirm_close"); },
  } satisfies WorkbenchCloseTransport;
  let active = true;
  const unlisten = await port.listen(() => {
    if (!active) return;
    request(() => { if (active) void port.confirm().catch(onError); });
  });
  try { await port.ready(); }
  catch (cause) { active = false; unlisten(); throw cause; }
  return () => { active = false; unlisten(); };
}

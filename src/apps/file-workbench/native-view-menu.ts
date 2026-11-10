import type { createBrowserViewMenu, BrowserViewMenuState } from "../../lib/local-files/browser-view-menu";
export interface ViewMenuTransport {
  listen(toggle: () => void): Promise<() => void>;
  update(state: BrowserViewMenuState): Promise<void>;
}
/** Subscribe before publishing state; serialize updates so a late IPC cannot
 * re-enable an old pane's checkbox after opening an editor or switching panes. */
export async function installWorkbenchViewMenu(menu: ReturnType<typeof createBrowserViewMenu>, onError: (cause: unknown) => void, transport?: ViewMenuTransport) {
  const port: ViewMenuTransport = transport ?? {
    async listen(toggle) {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen("workbench:toggle-hidden", toggle);
      return () => { void Promise.resolve(unlisten()).catch(onError); };
    },
    async update(state) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("workbench_set_view_menu", { ...state });
    },
  };
  let live = true, queue = Promise.resolve();
  const sync = () => { queue = queue.then(async () => { if (live) await port.update(menu.getSnapshot()); }).catch(onError); };
  const unlisten = await port.listen(() => { if (!live) return; menu.toggleHidden(); if (!menu.getSnapshot().enabled) sync(); });
  const initial = menu.getSnapshot();
  try { await port.update(initial); }
  catch (cause) { live = false; unlisten(); throw cause; }
  const unsubscribe = menu.subscribe(sync); if (menu.getSnapshot() !== initial) sync();
  return () => { live = false; unsubscribe(); unlisten(); };
}

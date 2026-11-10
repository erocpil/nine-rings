export interface BrowserViewMenuState { readonly enabled: boolean; readonly showHidden: boolean }
/** Trusted host menu adapter; the browser retains ownership of pane state. */
export interface BrowserViewMenuPort {
  update(state: BrowserViewMenuState): void;
  onToggleHidden(listener: () => void): () => void;
}
export function createBrowserViewMenu() {
  let state: BrowserViewMenuState = Object.freeze({ enabled: false, showHidden: false });
  const listeners = new Set<() => void>(), commands = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update(next: BrowserViewMenuState) {
      if (state.enabled === next.enabled && state.showHidden === next.showHidden) return;
      state = Object.freeze({ enabled: next.enabled, showHidden: next.showHidden });
      for (const notify of listeners) notify();
    },
    onToggleHidden(listener: () => void) { commands.add(listener); return () => { commands.delete(listener); }; },
    toggleHidden() { if (state.enabled) for (const command of commands) command(); },
  };
}

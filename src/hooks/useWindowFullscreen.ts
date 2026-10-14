import { useEffect, useState } from "react";
import { isTauriRuntime } from "../lib/runtime";
import { FULLSCREEN_CHANGED_EVENT } from "../lib/fullscreen";
/** Observe actual fullscreen, including native menu/keyboard transitions. */
export function useWindowFullscreen(enabled: boolean): boolean {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setFullscreen(false);
      return;
    }
    let disposed = false,
      revision = 0;
    const releases: (() => void)[] = [];
    if (!isTauriRuntime()) {
      const sync = () => setFullscreen(Boolean(document.fullscreenElement));
      sync();
      document.addEventListener("fullscreenchange", sync);
      return () => document.removeEventListener("fullscreenchange", sync);
    }
    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        if (disposed) return;
        const appWindow = getCurrentWindow();
        const sync = async () => {
          const id = ++revision;
          const value = await appWindow.isFullscreen();
          if (!disposed && id === revision) setFullscreen(value);
        };
        const refresh = () => void sync().catch(() => {});
        window.addEventListener(FULLSCREEN_CHANGED_EVENT, refresh);
        releases.push(() =>
          window.removeEventListener(FULLSCREEN_CHANGED_EVENT, refresh),
        );
        refresh();
        for (const subscribe of [
          () => appWindow.onResized(refresh),
          () => appWindow.onFocusChanged(refresh),
        ]) {
          try {
            const unlisten = await subscribe();
            if (disposed) unlisten();
            else releases.push(unlisten);
          } catch {
            /* Keep remaining native/browser signals active. */
          }
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      for (const release of releases) release();
    };
  }, [enabled]);
  return enabled && fullscreen;
}

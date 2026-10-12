import { useEffect, useRef, useSyncExternalStore } from "react";
import { mainViews } from "../lib/plugin-system/main-view-registry";

/** Saving is a host navigation gate, never a capability delegated to the renderer. */
export function usePluginMainView(
  flush: () => Promise<unknown>,
  reportError: (error: unknown) => void,
) {
  const state = useSyncExternalStore(
    mainViews.subscribe,
    mainViews.getSnapshot,
  );
  const callbacks = useRef({ flush, reportError });
  callbacks.current = { flush, reportError };
  useEffect(() => {
    const pending = state.pending;
    if (!pending) return;
    let cancelled = false;
    void callbacks.current
      .flush()
      .then(() => {
        if (!cancelled) mainViews.accept(pending.id);
      })
      .catch((error) => {
        if (!cancelled && mainViews.getSnapshot().pending?.id === pending.id) {
          mainViews.reject(pending.id);
          callbacks.current.reportError(error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [state.pending]);
  return state;
}

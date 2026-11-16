import { useEffect, useState } from "react";
import type { LocalFileDetails } from "../lib/local-files/file-model";

/** Optional disk metadata must never block opening, saving or editing a file. */
export function useLocalFileDetails(
  identity: string,
  load: (signal: AbortSignal) => Promise<LocalFileDetails>,
  revision: unknown,
  active = true,
) {
  const [state, setState] = useState<{
    identity: string;
    details: LocalFileDetails;
  } | null>(null);
  useEffect(() => {
    if (!active) return;
    let live = true,
      request: AbortController | undefined;
    const refresh = () => {
      request?.abort();
      const current = new AbortController();
      request = current;
      void load(current.signal)
        .then((details) => {
          if (live && !current.signal.aborted) setState({ identity, details });
        })
        .catch(() => {
          if (live && !current.signal.aborted) setState(null);
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      request?.abort();
      window.removeEventListener("focus", refresh);
    };
  }, [identity, load, revision, active]);
  return state?.identity === identity ? state.details : undefined;
}

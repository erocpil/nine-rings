import { useEffect, useRef } from "react";
import type { localDirectoryProvider } from "../lib/local-files/browser-provider";
import type { FileNode, FilePage, LocalFileFingerprint } from "../lib/local-files/service";
import type { LocalFileListOptions } from "../lib/local-files/tree";
import { readBrowserRefresh } from "../lib/local-files/browser-refresh";
const foreground = () => document.visibilityState !== "hidden" && document.hasFocus();

interface Snapshot {
  ready: boolean; nodes: FileNode[]; visibleIds: string[];
  apply: (page: FilePage, properties: Record<string, LocalFileFingerprint>) => void;
}
export function useFileBrowserRefresh({ enabled, identity, rootId, node, options, provider, snapshot, canRead, onError }: {
  enabled: boolean; identity: string; rootId: string; node: string; options: LocalFileListOptions;
  provider: ReturnType<typeof localDirectoryProvider>; snapshot: Snapshot;
  canRead: () => boolean; onError: (message: string) => void;
}) {
  const latest = useRef({ snapshot, canRead, onError });
  latest.current = { snapshot, canRead, onError };
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let running = false, failed = false;
    const check = async () => {
      if (running || controller.signal.aborted || !foreground() || !latest.current.snapshot.ready || !latest.current.canRead()) return;
      const before = latest.current.snapshot;
      running = true;
      try {
        const result = await readBrowserRefresh(provider, rootId, node, options, before.nodes.length, before.visibleIds, controller.signal);
        if (controller.signal.aborted || !foreground() || !latest.current.snapshot.ready || latest.current.snapshot.nodes !== before.nodes || !latest.current.canRead()) return;
        failed = false;
        latest.current.snapshot.apply(result.page, result.properties);
      } catch (reason) {
        if (!controller.signal.aborted && !failed) { failed = true; latest.current.onError(`目录自动检查失败，可手动刷新：${String(reason)}`); }
      } finally { running = false; }
    };
    const focus = () => { void check(); };
    // Leave an idle gap after each sweep; large loaded folders are checked less
    // often instead of repeatedly scanning all their pages every five seconds.
    let timer: number;
    const tick = async () => {
      await check();
      if (!controller.signal.aborted) timer = window.setTimeout(() => { void tick(); }, Math.max(5000, Math.ceil(Math.min(10000, latest.current.snapshot.nodes.length) / 200) * 1000));
    };
    timer = window.setTimeout(() => { void tick(); }, 250);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
    // identity includes every enumeration option; callbacks use the latest UI snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, identity, provider]);
}

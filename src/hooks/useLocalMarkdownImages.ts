import { useLayoutEffect, useMemo } from "react";
import type { BrowserDirectoryProvider } from "../lib/local-files/browser-contract";
import { isBrowserImagePath, isDirectMarkdownImageSource, releaseBrowserPreview } from "../lib/local-files/browser-preview";
import { resolveRelativeNode } from "../lib/local-files/file-model";

/** The displayed document owns the reads and object URLs, never the Markdown source. */
export function useLocalMarkdownImages(provider: BrowserDirectoryProvider, rootId: string, node?: string, reload?: number) {
  const scope = useMemo(() => {
    let controller: AbortController | undefined;
    const pending = new Map<string, Promise<string>>();
    const urls = new Set<string>();
    return {
      activate() {
        const current = new AbortController();
        controller = current;
        return () => {
          current.abort();
          pending.clear();
          for (const value of urls) releaseBrowserPreview({ kind: "image", value });
          urls.clear();
        };
      },
      async resolve(src: string) {
        if (isDirectMarkdownImageSource(src)) return null;
        if (!node || !controller || controller.signal.aborted || /^[#\\]/.test(src) || /%(?:2f|5c|00|3a)/i.test(src.split(/[?#]/, 1)[0])) return "";
        let target: string;
        try { target = resolveRelativeNode(node, src); }
        catch { return ""; }
        if (!isBrowserImagePath(target)) return "";
        const cached = pending.get(target);
        if (cached) return cached;
        const { signal } = controller;
        const request = provider.preview(rootId, target, signal).then(preview => {
          if (signal.aborted) {
            releaseBrowserPreview(preview);
            return "";
          }
          if (preview.kind !== "image") return "";
          urls.add(preview.value);
          return preview.value;
        }, () => "");
        pending.set(target, request);
        return request;
      },
    };
  }, [provider, rootId, node]);
  useLayoutEffect(() => scope.activate(), [scope, reload]);
  return scope.resolve;
}

import { useLayoutEffect, type RefObject } from "react";
import type { CommandAnchor } from "../lib/editor-command-surface";
import { mountFloatingDocumentTool } from "../lib/floating-document-tool";
export function useFloatingDocumentTool(
  panel: RefObject<HTMLElement>,
  viewport: RefObject<HTMLElement>,
  anchor?: CommandAnchor | null,
) {
  useLayoutEffect(() => {
    if (!panel.current || !viewport.current) return;
    return mountFloatingDocumentTool(
      panel.current,
      viewport.current,
      anchor,
      false,
    );
  }, [panel, viewport, anchor]);
}

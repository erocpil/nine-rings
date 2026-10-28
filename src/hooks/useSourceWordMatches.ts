import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { SourceEditorHandle } from "../lib/source-editor-handle";
import {
  sourceWordState,
  selectSourceWordAt,
  groupSourceWordMatchesByLine,
} from "../lib/source-word-occurrences";

/** Subscribe to one source editor, never to global events from another file.
 * The editor owns matching/highlighting; the host decides how to show a panel. */
export function useSourceWordMatches(
  handle: SourceEditorHandle | null,
  enabled: boolean,
  onOpen: (offset: number) => void,
) {
  const open = useRef(onOpen);
  open.current = onOpen;
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!handle || !enabled) return () => {};
      const root = handle.view.dom;
      root.addEventListener("nr:source-word-update", notify);
      handle.addEventListener("select", notify);
      return () => {
        root.removeEventListener("nr:source-word-update", notify);
        handle.removeEventListener("select", notify);
      };
    },
    [handle, enabled],
  );
  const snapshot = useCallback(
    () => (handle && enabled ? sourceWordState(handle.view) : null),
    [handle, enabled],
  );
  const state = useSyncExternalStore(subscribe, snapshot, () => null);
  useEffect(() => {
    if (!handle || !enabled) return;
    const request = (event: Event) => {
      const from = (event as CustomEvent<{ from?: number }>).detail?.from;
      if (Number.isInteger(from) && from! >= 0 && from! <= handle.value.length)
        open.current(from!);
    };
    const root = handle.view.dom;
    // Handle modifier-click before CodeMirror's multi-selection/platform handlers.
    // Scope it to this editor, including retained but inactive document sessions.
    const modifierClick = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        !(event.ctrlKey || event.metaKey) ||
        !(event.target instanceof Element) ||
        !event.target.closest(".cm-content")
      )
        return;
      const position = handle.view.posAtCoords({
        x: event.clientX,
        y: event.clientY,
      });
      if (position === null) return;
      const range = selectSourceWordAt(handle.view, position);
      if (!range) return;
      event.preventDefault();
      event.stopPropagation();
      open.current(range.from);
    };
    root.addEventListener("mousedown", modifierClick, true);
    root.addEventListener("nr:source-word-open", request);
    return () => {
      root.removeEventListener("mousedown", modifierClick, true);
      root.removeEventListener("nr:source-word-open", request);
    };
  }, [handle, enabled]);
  const groups = useMemo(
    () => groupSourceWordMatchesByLine(state?.matches ?? []),
    [state?.matches],
  );
  return { state, groups };
}

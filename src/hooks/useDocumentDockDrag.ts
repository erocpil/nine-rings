import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  isDockPanel,
  type DockDrop,
  type DockPanel,
} from "../lib/document-dock-layout";

export const DOCUMENT_DOCK_HEADER =
  ".document-outline-header, .document-bookmark-header, .vr-panel > h3";

interface DockTarget {
  panel: DockPanel;
  row: DockPanel;
  drop: DockDrop;
}

function dockTarget(
  root: HTMLElement,
  source: DockPanel,
  x: number,
  y: number,
): DockTarget | null {
  const row = document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>("[data-dock-target]");
  if (!row || !root.contains(row) || !isDockPanel(row.dataset.dockTarget))
    return null;
  const rect = row.getBoundingClientRect();
  const edge = Math.min(10, rect.height / 6);
  const header = row
    .querySelector<HTMLElement>(`.document-dock-tabs, ${DOCUMENT_DOCK_HEADER}`)
    ?.getBoundingClientRect();
  const drop =
    y < rect.top + edge
      ? "before"
      : y > rect.bottom - edge
        ? "after"
        : header && y >= header.top && y <= header.bottom
          ? "tab"
          : y < rect.top + rect.height / 2
            ? "before"
            : "after";
  const rowPanel = row.dataset.dockTarget;
  if (rowPanel !== source) return { panel: rowPanel, row: rowPanel, drop };
  const peer = row.dataset.dockPeer;
  return drop !== "tab" && isDockPanel(peer)
    ? { panel: peer, row: rowPanel, drop }
    : null;
}

export function useDocumentDockDrag(
  root: RefObject<HTMLElement>,
  enabled: boolean,
  movePanel: (source: DockPanel, target: DockTarget) => void,
  onDragStart: () => void,
) {
  const [target, setTarget] = useState<DockTarget | null>(null);
  const stop = useRef<() => void>();
  const clearClick = useRef<() => void>();
  const moveRef = useRef(movePanel);
  moveRef.current = movePanel;
  const dragStart = useRef(onDragStart);
  dragStart.current = onDragStart;

  const begin = useCallback(
    (source: DockPanel, down: PointerEvent) => {
      if (down.button !== 0 || down.pointerType === "touch" || !root.current)
        return;
      stop.current?.();
      clearClick.current?.();
      const pointer = down.pointerId;
      let dragging = false;
      const from = down.target instanceof Element ? down.target : null;
      const swallow = (click: MouseEvent) => {
        if (!click.detail) return;
        if (
          click.target instanceof Node &&
          (from?.contains(click.target) || click.target.contains(from))
        ) {
          click.preventDefault();
          click.stopImmediatePropagation();
        }
        releaseClick();
      };
      const releaseClick = () => {
        window.removeEventListener("click", swallow, true);
        window.removeEventListener("pointerdown", releaseClick, true);
        window.removeEventListener("blur", releaseClick);
        clearClick.current = undefined;
      };
      const findTarget = (event: PointerEvent) =>
        root.current &&
        dockTarget(root.current, source, event.clientX, event.clientY);
      const move = (event: PointerEvent) => {
        if (event.pointerId !== pointer) return;
        if (
          !dragging &&
          Math.hypot(
            event.clientX - down.clientX,
            event.clientY - down.clientY,
          ) < 6
        )
          return;
        if (!dragging) {
          dragStart.current();
          clearClick.current = releaseClick;
          window.addEventListener("click", swallow, true);
          window.addEventListener("pointerdown", releaseClick, true);
          window.addEventListener("blur", releaseClick);
        }
        dragging = true;
        event.preventDefault();
        const found = findTarget(event);
        setTarget((current) =>
          current?.row === found?.row &&
          current?.panel === found?.panel &&
          current?.drop === found?.drop
            ? current
            : found,
        );
      };
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key, true);
        window.removeEventListener("blur", finish);
        setTarget(null);
        stop.current = undefined;
      };
      const up = (event: PointerEvent) => {
        if (event.pointerId !== pointer) return;
        const destination = dragging && findTarget(event);
        finish();
        if (destination) moveRef.current(source, destination);
      };
      const cancel = (event: PointerEvent) => {
        if (event.pointerId === pointer) finish();
      };
      const key = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || !dragging) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        finish();
      };
      stop.current = finish;
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key, true);
      window.addEventListener("blur", finish);
    },
    [root],
  );
  useEffect(
    () => () => {
      stop.current?.();
      clearClick.current?.();
    },
    [enabled],
  );
  return { begin, target };
}

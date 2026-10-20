import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { DesktopDocumentPanelController } from "../hooks/useDesktopDocumentPanels";
import { saveWorkspaceLayout } from "../lib/workspace-layout";
export function desktopPanelStyle(
  controller: DesktopDocumentPanelController,
): CSSProperties {
  return {
    "--document-dock-width": `${controller.dockWidth}px`,
  } as CSSProperties;
}
export function desktopPanelClass(
  controller: DesktopDocumentPanelController,
  hasOutline: boolean,
  hasTransientPanel = false,
): string {
  if (!controller.enabled) return "";
  return (
    "desktop-document-panels " +
    ((hasOutline && controller.pinned("outline")) ||
    controller.pinned("bookmark")
      || (hasTransientPanel && controller.enabled)
      ? `document-panels-pinned document-panels-${controller.layout.panelsSide}`
      : "")
  );
}
export function DesktopDocumentPanels({
  controller,
  outline,
  bookmark,
  matches,
  matchesOpen = false,
}: {
  controller: DesktopDocumentPanelController;
  outline: ReactNode;
  bookmark: ReactNode;
  matches?: ReactNode;
  matchesOpen?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const cleanup = useRef<() => void>();
  const [ratio, setRatio] = useState(controller.layout.panelRatio);
  const [matchesRatio, setMatchesRatio] = useState(controller.layout.matchesRatio);
  const [width, setWidth] = useState<number | null>(null);
  const [error, setError] = useState("");
  useEffect(
    () => setRatio(controller.layout.panelRatio),
    [controller.layout.panelRatio],
  );
  useEffect(() => setMatchesRatio(controller.layout.matchesRatio), [controller.layout.matchesRatio]);
  useEffect(() => () => cleanup.current?.(), []);
  const horizontal = controller.layout.panelsArrangement === "horizontal";
  const first = controller.pinned("outline") && outline;
  const second = controller.pinned("bookmark") && bookmark;
  const hasPinned = Boolean(first || second);
  const showMatches = controller.enabled && matchesOpen && matches;
  const saveRatio = (value: number) => {
    setError("");
    if (!saveWorkspaceLayout({ panelRatio: value })) {
      setRatio(controller.layout.panelRatio);
      setError("面板比例保存失败，请重试。");
    }
  };
  const drag = (event: PointerEvent<HTMLDivElement>, mode: "panel" | "width" | "matches" = "panel") => {
    if (event.button !== 0 || !root.current) return;
    event.preventDefault();
    event.stopPropagation();
    setError("");
    cleanup.current?.();
    controller.cancel();
    const handle = event.currentTarget;
    const pointer = event.pointerId;
    const rect = root.current.getBoundingClientRect();
    // The outline/bookmark split occupies only the main grid when matches
    // are open. Preserve the grab offset instead of snapping to the pointer.
    const mainRect = handle.parentElement!.getBoundingClientRect();
    const startRatio = mode === "matches" ? matchesRatio : ratio;
    const owner = root.current.closest<HTMLElement>(".note-editor");
    const oldCursor = document.body.style.cursor,
      oldSelect = document.body.style.userSelect,
      oldWebkitSelect = document.body.style.webkitUserSelect;
    document.body.style.cursor =
      (horizontal && mode === "panel") || mode === "width" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
    let nextRatio = mode === "matches" ? matchesRatio : ratio,
      nextWidth = rect.width;
    try {
      handle.setPointerCapture(pointer);
    } catch {
      /* older WebViews */
    }
    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointer) return;
      if (mode === "width") {
        nextWidth = Math.min(
          (owner?.clientWidth ?? 1200) * 0.5,
          Math.max(
            horizontal ? 280 : 180,
            Math.min(
              horizontal ? 900 : 600,
              rect.width +
                (e.clientX - event.clientX) *
                  (controller.layout.panelsSide === "left" ? 1 : -1),
            ),
          ),
        );
        setWidth(nextWidth);
        owner?.style.setProperty("--document-dock-width", `${nextWidth}px`);
      } else if (mode === "matches") {
        nextRatio = Math.max(0.15, Math.min(0.85, startRatio - (e.clientY - event.clientY) / Math.max(1, rect.height - 6)));
        setMatchesRatio(nextRatio);
      } else {
        nextRatio = Math.max(
          0.15,
          Math.min(
            0.85,
            startRatio + (horizontal
              ? (e.clientX - event.clientX) / Math.max(1, mainRect.width - 6)
              : (e.clientY - event.clientY) / Math.max(1, mainRect.height - 6)),
          ),
        );
        setRatio(nextRatio);
      }
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", finish);
      document.body.style.cursor = oldCursor;
      document.body.style.userSelect = oldSelect;
      document.body.style.webkitUserSelect = oldWebkitSelect;
      if (handle.hasPointerCapture(pointer))
        handle.releasePointerCapture(pointer);
      cleanup.current = undefined;
      if (mode === "width") {
        if (
          !saveWorkspaceLayout(
            horizontal
              ? { horizontalPanelWidth: nextWidth }
              : { panelWidth: nextWidth },
          )
        ) {
          owner?.style.setProperty(
            "--document-dock-width",
            `${controller.dockWidth}px`,
          );
          setError("面板宽度保存失败，请重试。");
        }
        setWidth(null);
      } else if (mode === "matches") {
        if (!saveWorkspaceLayout({ matchesRatio: nextRatio })) {
          setMatchesRatio(controller.layout.matchesRatio);
          setError("匹配列表高度保存失败，请重试。");
        }
      } else saveRatio(nextRatio);
    };
    const up = (e: globalThis.PointerEvent) => {
      if (e.pointerId === pointer) finish();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", finish);
    cleanup.current = finish;
  };
  return (
    <>
      {!controller.pinned("outline") && outline}
      {!controller.pinned("bookmark") && bookmark}
      {(hasPinned || showMatches) && (
        <aside
          ref={root}
          className={`document-panel-dock dock-${controller.layout.panelsSide} dock-${horizontal ? "horizontal" : "vertical"}`}
          aria-label="固定阅读面板"
          style={{
            ...(width === null ? {} : { width: `min(${width}px, 50%)` }),
          }}
        >
          <div
            className="document-dock-width-handle"
            role="separator"
            aria-label="调整阅读面板宽度"
            aria-orientation="vertical"
            onPointerDown={(event) => drag(event, "width")}
          />
          {hasPinned && <div
            className={`document-panel-dock-main dock-${horizontal ? "horizontal" : "vertical"}${showMatches ? " has-matches" : ""}`}
            style={{
              [horizontal ? "gridTemplateColumns" : "gridTemplateRows"]:
              first && second
                ? `${ratio}fr 6px ${1 - ratio}fr`
                : "minmax(0, 1fr)",
              ...(showMatches ? { flex: `0 0 calc(${(1 - matchesRatio) * 100}% - 3px)` } : {}),
            }}
          >
          {first && (
            <div className="document-panel-slot" data-panel="outline">
              {first}
            </div>
          )}
          {first && second && (
            <div
              className="document-panel-divider"
              role="separator"
              tabIndex={0}
              aria-label="调整目录与书签比例"
              aria-orientation={horizontal ? "vertical" : "horizontal"}
              aria-valuemin={15}
              aria-valuemax={85}
              aria-valuenow={Math.round(ratio * 100)}
              onPointerDown={(event) => drag(event)}
              onKeyDown={(event) => {
                const delta =
                  event.key === (horizontal ? "ArrowRight" : "ArrowDown")
                    ? 0.05
                    : event.key === (horizontal ? "ArrowLeft" : "ArrowUp")
                      ? -0.05
                      : 0;
                if (!delta && event.key !== "Home" && event.key !== "End")
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0.15
                    : event.key === "End"
                      ? 0.85
                      : Math.max(0.15, Math.min(0.85, ratio + delta));
                setRatio(next);
                saveRatio(next);
              }}
            />
          )}
          {second && (
            <div className="document-panel-slot" data-panel="bookmark">
              {second}
            </div>
          )}
          </div>}
          {showMatches && <>
            {hasPinned && <div
              className="document-panel-matches-divider"
              role="separator"
              tabIndex={0}
              aria-label="调整匹配列表高度"
              aria-orientation="horizontal"
              aria-valuemin={15}
              aria-valuemax={85}
              aria-valuenow={Math.round(matchesRatio * 100)}
              onPointerDown={(event) => drag(event, "matches")}
              onKeyDown={(event) => {
                const delta = event.key === "ArrowUp" ? 0.05 : event.key === "ArrowDown" ? -0.05 : 0;
                if (!delta && event.key !== "Home" && event.key !== "End") return;
                event.preventDefault();
                const next = event.key === "Home" ? 0.15 : event.key === "End" ? 0.85 : Math.max(0.15, Math.min(0.85, matchesRatio + delta));
                setMatchesRatio(next);
                if (!saveWorkspaceLayout({ matchesRatio: next })) setError("匹配列表高度保存失败，请重试。");
              }}
            />}
            <div className={`document-panel-matches-slot${hasPinned ? " has-pinned-panels" : ""}`} data-panel="matches" style={hasPinned ? { flex: `0 0 calc(${matchesRatio * 100}% - 3px)` } : undefined}>{matches}</div>
          </>}
        </aside>
      )}
      {(controller.error || error) && (
        <div role="alert" className="document-panel-error">
          {controller.error || error}
          <button
            type="button"
            aria-label="关闭布局提示"
            onClick={() => {
              setError("");
              controller.clearError();
            }}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}

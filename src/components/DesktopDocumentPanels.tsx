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
): string {
  if (!controller.enabled) return "";
  return (
    "desktop-document-panels " +
    ((hasOutline && controller.pinned("outline")) ||
    controller.pinned("bookmark")
      ? `document-panels-pinned document-panels-${controller.layout.panelsSide}`
      : "")
  );
}
export function DesktopDocumentPanels({
  controller,
  outline,
  bookmark,
}: {
  controller: DesktopDocumentPanelController;
  outline: ReactNode;
  bookmark: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const cleanup = useRef<() => void>();
  const [ratio, setRatio] = useState(controller.layout.panelRatio);
  const [width, setWidth] = useState<number | null>(null);
  const [error, setError] = useState("");
  useEffect(
    () => setRatio(controller.layout.panelRatio),
    [controller.layout.panelRatio],
  );
  useEffect(() => () => cleanup.current?.(), []);
  const horizontal = controller.layout.panelsArrangement === "horizontal";
  const first = controller.pinned("outline") && outline;
  const second = controller.pinned("bookmark") && bookmark;
  const saveRatio = (value: number) => {
    setError("");
    if (!saveWorkspaceLayout({ panelRatio: value })) {
      setRatio(controller.layout.panelRatio);
      setError("面板比例保存失败，请重试。");
    }
  };
  const drag = (event: PointerEvent<HTMLDivElement>, resizingWidth = false) => {
    if (event.button !== 0 || !root.current) return;
    event.preventDefault();
    event.stopPropagation();
    setError("");
    cleanup.current?.();
    controller.cancel();
    const handle = event.currentTarget;
    const pointer = event.pointerId;
    const rect = root.current.getBoundingClientRect();
    const owner = root.current.closest<HTMLElement>(".note-editor");
    const oldCursor = document.body.style.cursor,
      oldSelect = document.body.style.userSelect,
      oldWebkitSelect = document.body.style.webkitUserSelect;
    document.body.style.cursor =
      horizontal || resizingWidth ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
    let nextRatio = ratio,
      nextWidth = rect.width;
    try {
      handle.setPointerCapture(pointer);
    } catch {
      /* older WebViews */
    }
    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointer) return;
      if (resizingWidth) {
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
      } else {
        nextRatio = Math.max(
          0.15,
          Math.min(
            0.85,
            horizontal
              ? (e.clientX - rect.left) / rect.width
              : (e.clientY - rect.top) / rect.height,
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
      if (resizingWidth) {
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
      {(first || second) && (
        <aside
          ref={root}
          className={`document-panel-dock dock-${controller.layout.panelsSide} dock-${horizontal ? "horizontal" : "vertical"}`}
          aria-label="固定阅读面板"
          style={{
            ...(width === null ? {} : { width: `min(${width}px, 50%)` }),
            [horizontal ? "gridTemplateColumns" : "gridTemplateRows"]:
              first && second
                ? `${ratio}fr 6px ${1 - ratio}fr`
                : "minmax(0, 1fr)",
          }}
        >
          <div
            className="document-dock-width-handle"
            role="separator"
            aria-label="调整阅读面板宽度"
            aria-orientation="vertical"
            onPointerDown={(event) => drag(event, true)}
          />
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

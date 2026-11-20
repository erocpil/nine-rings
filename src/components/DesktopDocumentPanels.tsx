import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { DesktopDocumentPanelController } from "../hooks/useDesktopDocumentPanels";
import { DOCUMENT_DOCK_HEADER, useDocumentDockDrag } from "../hooks/useDocumentDockDrag";
import { isDockPanel, moveDockPanel, type DockDrop, type DockPanel, type DocumentDockLayout } from "../lib/document-dock-layout";
import { CustomDocumentDock } from "./CustomDocumentDock";
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
    `desktop-document-panels document-workspace-${controller.mode} ` +
    ((hasOutline && controller.pinned("outline")) ||
    controller.pinned("bookmark")
      || (hasTransientPanel && controller.enabled)
      ? `document-panels-pinned document-panels-${controller.layout.panelsSide}`
      : "")
  );
}

function visibleChromeElement(root: HTMLElement, selector: string): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>(selector)].find((element) => {
    const style = getComputedStyle(element);
    return element.getClientRects().length > 0 && style.display !== "none" && style.visibility !== "hidden";
  }) ?? null;
}

export function DesktopDocumentPanels({
  controller,
  outline,
  bookmark,
  matches,
  matchesOpen = false,
  bookmarkEmpty = false,
  outlineLabel = "目录",
}: {
  controller: DesktopDocumentPanelController;
  outline: ReactNode;
  bookmark: ReactNode;
  matches?: ReactNode;
  matchesOpen?: boolean;
  bookmarkEmpty?: boolean;
  outlineLabel?: string;
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
  useEffect(() => { cleanup.current?.(); setWidth(null); }, [controller.mode]);
  useLayoutEffect(() => {
    const dock = root.current, owner = dock?.closest<HTMLElement>(".note-editor");
    if (!dock || !owner) return;
    const observed = new WeakSet<Element>();
    const measure = () => {
      const chromeHost = owner.closest<HTMLElement>(".local-file-view, .vr-note") ?? owner;
      const title = visibleChromeElement(owner,
        ".note-title-row, .markdown-source-title-row, .local-file-titlebar, .vr-title",
      ) ?? visibleChromeElement(chromeHost,
        ".note-title-row, .markdown-source-title-row, .local-file-titlebar, .vr-title",
      );
      // Fixed panels start below the title row in every host. A tag row is
      // document content and must not push the dock down in database notes,
      // where tags exist but disk-backed editors have no equivalent row.
      const top = title?.getBoundingClientRect().bottom ?? owner.getBoundingClientRect().top;
      dock.style.top = `${Math.max(0, top - owner.getBoundingClientRect().top)}px`;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(owner);
    const bindChrome = () => {
      for (const child of owner.querySelectorAll<HTMLElement>(".note-title-row, .markdown-source-title-row, .local-file-titlebar, .vr-title")) {
        if (!observed.has(child)) { observed.add(child); observer.observe(child); }
      }
      const chromeHost = owner.closest<HTMLElement>(".local-file-view, .vr-note");
      for (const child of chromeHost?.querySelectorAll<HTMLElement>(".local-file-titlebar, .vr-title") ?? []) {
        if (!observed.has(child)) { observed.add(child); observer.observe(child); }
      }
      measure();
    };
    // Lazy/retained editors can mount their title after the dock. Resolve the
    // current title on every measurement instead of retaining a missing node.
    const mounted = new MutationObserver(records => {
      const selector = ".note-title-row, .markdown-source-title-row, .local-file-titlebar, .vr-title";
      if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches(selector) || node.querySelector(selector))))) bindChrome();
    });
    mounted.observe(owner, { childList: true, subtree: true });
    bindChrome();
    return () => { mounted.disconnect(); observer.disconnect(); dock.style.top = ""; };
  });
  const horizontal = controller.layout.panelsArrangement === "horizontal";
  const first = controller.pinned("outline") && outline;
  const second = controller.pinned("bookmark") && bookmark;
  const hasPinned = Boolean(first || second);
  const compactBookmarks = Boolean(second && bookmarkEmpty);
  const compactMain = compactBookmarks && !first;
  const showMatches = controller.enabled && matchesOpen && matches;
  // Seed the first move from the panels actually docked in the old layout.
  const legacyDock = (): DocumentDockLayout => {
    const mainWeight = showMatches && hasPinned ? 1 - controller.layout.matchesRatio : 1;
    const groups: DocumentDockLayout["groups"] = [];
    if (first) groups.push({ panels: ["outline"], active: "outline", weight: second ? mainWeight * ratio : mainWeight });
    if (second) groups.push({ panels: ["bookmark"], active: "bookmark", weight: first ? mainWeight * (1 - ratio) : mainWeight });
    if (showMatches) groups.push({ panels: ["matches"], active: "matches", weight: hasPinned ? controller.layout.matchesRatio : 1 });
    return { groups, closed: [] };
  };
  const movePanel = (source: DockPanel, destination: { panel: DockPanel; drop: DockDrop }) => {
    controller.dismiss();
    controller.changeDock(current => {
      const layout = current ?? legacyDock();
      const next = moveDockPanel(layout, source, destination.panel, destination.drop);
      return next === layout ? current : next;
    });
  };
  const { begin, target } = useDocumentDockDrag(root, controller.enabled, movePanel, controller.dismiss);
  const { connectDockDrag } = controller;
  useLayoutEffect(() => {
    connectDockDrag(begin);
    return () => connectDockDrag();
  }, [begin, connectDockDrag]);
  const hint = (panel: DockPanel) => target?.row === panel ? target.drop : undefined;

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
          !controller.saveWidth(nextWidth)
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
          onPointerDown={event => {
            if (!(event.target instanceof Element) || event.target.closest(".document-dock-tabs")) return;
            const header = event.target.closest(DOCUMENT_DOCK_HEADER);
            const button = event.target.closest("button, input, select, textarea");
            if (!header || (button && !button.matches(".document-panel-title"))) return;
            const panel = header.closest<HTMLElement>("[data-panel]")?.dataset.panel;
            if (isDockPanel(panel)) begin(panel, event.nativeEvent);
          }}
          onKeyDown={event => {
            if (!event.altKey || !(event.target instanceof HTMLElement)) return;
            const key = event.key;
            if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "Enter") return;
            const row = event.target.closest<HTMLElement>("[data-dock-target]");
            const source = event.target.dataset.dockPanel ?? event.target.closest<HTMLElement>("[data-panel]")?.dataset.panel;
            if (!row || !isDockPanel(source) || !event.target.closest(`.document-dock-tabs, ${DOCUMENT_DOCK_HEADER}`)) return;
            const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-dock-target]")];
            const index = rows.indexOf(row);
            const adjacent = rows[index + (key === "ArrowDown" ? 1 : -1)] ?? (key === "Enter" ? rows[index + 1] : undefined);
            const peer = row.dataset.dockTarget === source ? row.dataset.dockPeer : row.dataset.dockTarget;
            const panel = key !== "Enter" && isDockPanel(peer) ? peer : adjacent?.dataset.dockTarget;
            if (!isDockPanel(panel)) return;
            event.preventDefault();
            event.stopPropagation();
            movePanel(source, { panel, drop: key === "Enter" ? "tab" : key === "ArrowUp" ? "before" : "after" });
            requestAnimationFrame(() => {
              if (document.activeElement !== document.body) return;
              root.current?.querySelector<HTMLElement>(`[data-dock-panel="${source}"], [data-panel="${source}"] .document-panel-title`)?.focus();
            });
          }}
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
          {controller.dock ? <CustomDocumentDock
            controller={controller} layout={controller.dock}
            panels={{ outline: first, bookmark: second, matches: showMatches }}
            labels={{ outline: outlineLabel, bookmark: "书签", matches: "同词匹配" }}
            hint={hint}
          /> : <>
          {hasPinned && <div
            className={`document-panel-dock-main dock-${horizontal ? "horizontal" : "vertical"}${showMatches ? " has-matches" : ""}`}
            style={{
              [horizontal ? "gridTemplateColumns" : "gridTemplateRows"]:
              first && second
                ? compactBookmarks && !horizontal ? "minmax(0, 1fr) 6px max-content" : `${ratio}fr 6px ${1 - ratio}fr`
                : compactMain ? "max-content" : "minmax(0, 1fr)",
              ...(compactMain ? { flex: "0 0 auto" } : showMatches ? { flex: `0 0 calc(${(1 - matchesRatio) * 100}% - 3px)` } : {}),
            }}
          >
          {first && (
            <div className="document-panel-slot" data-panel="outline" data-dock-target="outline" data-dock-drop={hint("outline")}>
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
            <div className={`document-panel-slot${compactBookmarks ? " is-empty-bookmark" : ""}`} data-panel="bookmark" data-dock-target="bookmark" data-dock-drop={hint("bookmark")}>
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
            <div className={`document-panel-matches-slot${hasPinned ? " has-pinned-panels" : ""}`} data-panel="matches" data-dock-target="matches" data-dock-drop={hint("matches")} style={hasPinned && !compactMain ? { flex: `0 0 calc(${matchesRatio * 100}% - 3px)` } : undefined}>{matches}</div>
          </>}
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

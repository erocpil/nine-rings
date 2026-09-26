import { readWorkspaceLayout } from "../lib/workspace-layout";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { MOBILE_VIEWPORT_QUERY } from "./useEdgeDrawer";

type SidebarPanel = "tree" | "list" | "reader";
interface Options {
  desktopPanel: SidebarPanel;
  setDesktopPanel: Dispatch<SetStateAction<SidebarPanel>>;
  sidebarHidden: boolean;
  setSidebarHidden: Dispatch<SetStateAction<boolean>>;
}
const DESKTOP_ACTIVITY_BAR_WIDTH = 44;
const SIDEBAR_MIN_WIDTH = 360;
const SIDEBAR_MOBILE_MIN_WIDTH = 240;
const READER_SIDEBAR_MIN_WIDTH = 240;
const READER_SIDEBAR_WIDTH_KEY = "nr:readerSidebarW";
const READER_SIDEBAR_RATIO_KEY = "nr:readerSidebarRatio";
export const RESET_READER_SIDEBAR_BOUNDARY_EVENT = "nr:reset-reader-sidebar-boundary";
const readerAvailableWidth = () =>
  Math.max(
    READER_SIDEBAR_MIN_WIDTH,
    window.innerWidth - DESKTOP_ACTIVITY_BAR_WIDTH - 4,
  );
const TREE_SIDEBAR_WIDTH_KEY = "nr:treeSidebarW";
const LIST_SIDEBAR_WIDTH_KEY = "nr:listSidebarW";
const sidebarWidthKey = (panel: "tree" | "list" | "reader") =>
  panel === "reader"
    ? READER_SIDEBAR_WIDTH_KEY
    : panel === "list"
      ? LIST_SIDEBAR_WIDTH_KEY
      : TREE_SIDEBAR_WIDTH_KEY;

export function useWorkspaceSidebar({
  desktopPanel,
  setDesktopPanel,
  sidebarHidden,
  setSidebarHidden,
}: Options) {
  const sidebarPanelRef = useRef<HTMLElement>(null);
  // Keep the preferred ratio through intermediate native fullscreen animation
  // sizes and minimum-width clamps. Only dragging changes the preference.
  const readerRatioRef = useRef<number | null>(null);
  // ── 侧栏可拖拽分隔条 ──
  const computeDefaultSidebarWidth = useCallback(() => {
    const mobile = window.matchMedia(MOBILE_VIEWPORT_QUERY).matches;
    if (mobile) return SIDEBAR_MOBILE_MIN_WIDTH;
    return SIDEBAR_MIN_WIDTH;
  }, []);
  const clampSidebarWidth = useCallback((width: number, min = 0) => {
    const viewport = window.innerWidth;
    // The reader may occupy the complete document area. Keep only the
    // activity bar and the 4px splitter visible at the right edge.
    const maxWidth = Math.max(240, viewport - DESKTOP_ACTIVITY_BAR_WIDTH - 4);
    const safeMin = Math.min(min, maxWidth);
    return Math.max(safeMin, Math.min(maxWidth, width));
  }, []);
  const computeReaderSidebarWidth = useCallback(() => {
    const available = readerAvailableWidth();
    if (readerRatioRef.current === null) {
      const ratio = Number(localStorage.getItem(READER_SIDEBAR_RATIO_KEY));
      const saved = Number(localStorage.getItem(READER_SIDEBAR_WIDTH_KEY));
      // Migrate the old pixel preference at the first desktop opening.
      readerRatioRef.current =
        Number.isFinite(ratio) && ratio > 0 && ratio <= 1
          ? ratio
          : Number.isFinite(saved) && saved > 0
            ? Math.min(1, saved / available)
            : 0.5;
    }
    const width = Math.round(available * readerRatioRef.current);
    return clampSidebarWidth(width, READER_SIDEBAR_MIN_WIDTH);
  }, [clampSidebarWidth]);
  const computePanelSidebarWidth = useCallback(
    (panel: typeof desktopPanel) => {
      if (panel === "reader") return computeReaderSidebarWidth();
      const saved = Number(localStorage.getItem(sidebarWidthKey(panel)));
      const width =
        Number.isFinite(saved) && saved > 0
          ? saved
          : computeDefaultSidebarWidth();
      return clampSidebarWidth(width, 0);
    },
    [clampSidebarWidth, computeDefaultSidebarWidth, computeReaderSidebarWidth],
  );
  const applyPanelSidebarWidth = useCallback(
    (panel: typeof desktopPanel) => {
      if (window.matchMedia(MOBILE_VIEWPORT_QUERY).matches) return;
      const nextWidth = computePanelSidebarWidth(panel);
      sideDragWidthRef.current = nextWidth;
      setSidebarWidth(nextWidth);
    },
    [computePanelSidebarWidth],
  );
  const setSidebarPanel = useCallback(
    (panel: typeof desktopPanel, toggle = false) => {
      if (window.matchMedia(MOBILE_VIEWPORT_QUERY).matches) {
        setDesktopPanel(panel);
        return;
      }
      const isCurrent = toggle && desktopPanel === panel && !sidebarHidden;
      if (isCurrent) {
        setSidebarHidden(true);
        return;
      }
      setDesktopPanel(panel);
      setSidebarHidden(false);
      applyPanelSidebarWidth(panel);
    },
    [
      applyPanelSidebarWidth,
      desktopPanel,
      sidebarHidden,
      setDesktopPanel,
      setSidebarHidden,
    ],
  );
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(TREE_SIDEBAR_WIDTH_KEY);
    if (!saved || !Number.isFinite(Number(saved)) || Number(saved) <= 0) {
      return window.matchMedia(MOBILE_VIEWPORT_QUERY).matches
        ? SIDEBAR_MOBILE_MIN_WIDTH
        : SIDEBAR_MIN_WIDTH;
    }
    const candidate = Number(saved);
    return window.matchMedia(MOBILE_VIEWPORT_QUERY).matches
      ? Math.max(SIDEBAR_MOBILE_MIN_WIDTH, candidate)
      : clampSidebarWidth(candidate, 0);
  });
  const [sidebarWidthHint, setSidebarWidthHint] = useState<string | null>(null);
  const sidebarHintTimerRef = useRef<number | null>(null);
  const showSidebarWidthHint = useCallback(() => {
    setSidebarWidthHint(`阅读分栏最小宽度为 ${READER_SIDEBAR_MIN_WIDTH}px`);
    if (sidebarHintTimerRef.current !== null)
      window.clearTimeout(sidebarHintTimerRef.current);
    sidebarHintTimerRef.current = window.setTimeout(
      () => setSidebarWidthHint(null),
      2200,
    );
  }, []);
  useEffect(() => {
    if (sidebarHidden) return;
    const resize = () => applyPanelSidebarWidth(desktopPanel);
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [applyPanelSidebarWidth, sidebarHidden, desktopPanel]);
  useEffect(() => {
    const reset = () => {
      localStorage.removeItem(READER_SIDEBAR_WIDTH_KEY);
      localStorage.removeItem(READER_SIDEBAR_RATIO_KEY);
      readerRatioRef.current = null;
      localStorage.removeItem(TREE_SIDEBAR_WIDTH_KEY);
      localStorage.removeItem(LIST_SIDEBAR_WIDTH_KEY);
      applyPanelSidebarWidth(desktopPanel);
    };
    window.addEventListener("nr:reset-sidebar-widths", reset);
    const resetReaderBoundary = () => {
      localStorage.removeItem(READER_SIDEBAR_WIDTH_KEY);
      localStorage.removeItem(READER_SIDEBAR_RATIO_KEY);
      readerRatioRef.current = null;
      if (desktopPanel === "reader") applyPanelSidebarWidth("reader");
    };
    window.addEventListener(RESET_READER_SIDEBAR_BOUNDARY_EVENT, resetReaderBoundary);
    return () => {
      window.removeEventListener("nr:reset-sidebar-widths", reset);
      window.removeEventListener(RESET_READER_SIDEBAR_BOUNDARY_EVENT, resetReaderBoundary);
    };
  }, [applyPanelSidebarWidth, desktopPanel]);
  useEffect(
    () => () => {
      if (sidebarHintTimerRef.current !== null)
        window.clearTimeout(sidebarHintTimerRef.current);
    },
    [],
  );
  const sideDragRef = useRef(false);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const sideStartXRef = useRef(0);
  const sideStartWRef = useRef(0);
  const sideDragPanelRef = useRef<typeof desktopPanel>(desktopPanel);
  const sideDragWidthRef = useRef(sidebarWidth);
  const sideDragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => sideDragCleanupRef.current?.(), []);

  const handleSidePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (sideDragRef.current || (e.pointerType === "mouse" && e.button !== 0))
      return;
    e.preventDefault();
    e.stopPropagation();
    sideDragRef.current = true;
    // Capture the panel at pointer-down. React may render a different panel
    // before pointerup; saving from the latest closure could then overwrite
    // another panel's preference.
    sideDragPanelRef.current = desktopPanel;
    const direction = !window.matchMedia(MOBILE_VIEWPORT_QUERY).matches && readWorkspaceLayout().sidebarSide === "right" ? -1 : 1;
    sideStartXRef.current = e.clientX;
    sideStartWRef.current = sidebarWidth;
    sideDragWidthRef.current = sidebarWidth;
    setSidebarResizing(true);
    // Keep the editor's layout stable while it is clipped by the moving pane.
    // Rewrapping a long document at every intermediate width can block WebView2.
    const editorWidth =
      document.querySelector<HTMLElement>(".app-main")?.getBoundingClientRect()
        .width ?? 320;
    document.body.style.setProperty(
      "--sidebar-drag-editor-width",
      `${Math.max(320, editorWidth)}px`,
    );
    // Freeze the whole reader, not only PDF raster jobs: EPUB iframes, page
    // geometry and toolbar wrapping must also ignore intermediate pane sizes.
    const readerBounds = sidebarPanelRef.current
      ?.querySelector<HTMLElement>(".desktop-reader-panel:not([hidden])")
      ?.getBoundingClientRect();
    if (readerBounds) {
      document.body.style.setProperty(
        "--sidebar-drag-reader-width",
        `${readerBounds.width}px`,
      );
      document.body.style.setProperty(
        "--sidebar-drag-reader-height",
        `${readerBounds.height}px`,
      );
    }
    document.body.classList.add("app-sidebar-dragging");
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    const previousWebkitUserSelect = document.body.style.webkitUserSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
    const pointerId = e.pointerId;
    const divider = e.currentTarget;
    let widthFrame = 0;
    let finished = false;
    try {
      divider.setPointerCapture(pointerId);
    } catch {
      // Synthetic events and older WebViews may not expose an active pointer to capture.
    }

    const handlePointerMove = (pe: PointerEvent) => {
      if (!sideDragRef.current || pe.pointerId !== pointerId) return;
      if (pe.cancelable) pe.preventDefault();
      const delta = (pe.clientX - sideStartXRef.current) * direction;
      const minimum =
        sideDragPanelRef.current === "reader" ? READER_SIDEBAR_MIN_WIDTH : 0;
      const rawWidth = Math.min(
        window.innerWidth - DESKTOP_ACTIVITY_BAR_WIDTH - 4,
        sideStartWRef.current + delta,
      );
      // Once the handle is dragged clearly past the usable edge, collapse the
      // panel instead of leaving a narrow sliver that cannot be operated.
      const collapseThreshold =
        sideDragPanelRef.current === "reader" ? minimum - 32 : 24;
      if (rawWidth <= collapseThreshold) {
        setSidebarHidden(true);
        finishSideDrag();
        return;
      }
      if (sideDragPanelRef.current === "reader" && rawWidth < minimum)
        showSidebarWidthHint();
      const newW = clampSidebarWidth(rawWidth, minimum);
      sideDragWidthRef.current = Math.round(newW);
      if (!widthFrame)
        widthFrame = window.requestAnimationFrame(() => {
          widthFrame = 0;
          setSidebarWidth(sideDragWidthRef.current);
        });
    };

    const finishSideDrag = () => {
      if (finished) return;
      finished = true;
      sideDragRef.current = false;
      window.cancelAnimationFrame(widthFrame);
      sideDragWidthRef.current = clampSidebarWidth(sideDragWidthRef.current, sideDragPanelRef.current === "reader" ? READER_SIDEBAR_MIN_WIDTH : 0);
      setSidebarWidth(sideDragWidthRef.current);
      setSidebarResizing(false);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerEnd);
      document.removeEventListener("pointercancel", handlePointerEnd);
      divider.removeEventListener("lostpointercapture", handlePointerEnd);
      window.removeEventListener("blur", finishSideDrag);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      try {
        if (divider.hasPointerCapture(pointerId))
          divider.releasePointerCapture(pointerId);
      } catch {
        /* The host may already have released capture at the window edge. */
      }
      document.body.classList.remove("app-sidebar-dragging");
      document.body.style.removeProperty("--sidebar-drag-editor-width");
      document.body.style.removeProperty("--sidebar-drag-reader-width");
      document.body.style.removeProperty("--sidebar-drag-reader-height");
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      document.body.style.webkitUserSelect = previousWebkitUserSelect;
      const key = sidebarWidthKey(sideDragPanelRef.current);
      localStorage.setItem(key, String(sideDragWidthRef.current));
      if (sideDragPanelRef.current === "reader") {
        readerRatioRef.current = Math.min(1, Math.max(0.1,
          sideDragWidthRef.current / readerAvailableWidth()));
        localStorage.setItem(
          READER_SIDEBAR_RATIO_KEY,
          String(readerRatioRef.current),
        );
      }
      sideDragCleanupRef.current = null;
    };

    const handlePointerEnd = (pe: PointerEvent) => {
      if (pe.pointerId !== pointerId) return;
      if (pe.cancelable) pe.preventDefault();
      finishSideDrag();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") finishSideDrag();
    };

    sideDragCleanupRef.current = finishSideDrag;
    document.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    document.addEventListener("pointerup", handlePointerEnd);
    document.addEventListener("pointercancel", handlePointerEnd);
    divider.addEventListener("lostpointercapture", handlePointerEnd);
    window.addEventListener("blur", finishSideDrag);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  };

  return {
    sidebarPanelRef,
    sidebarWidth,
    sidebarWidthHint,
    sidebarResizing,
    setSidebarPanel,
    handleSidePointerDown,
  };
}

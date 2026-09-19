import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceLayout } from "./useWorkspaceLayout";
import {
  DEFAULT_WORKSPACE_LAYOUT,
  saveWorkspaceLayout,
} from "../lib/workspace-layout";
export type DocumentPanelKind = "outline" | "bookmark";
const EMPTY_ITEMS: never[] = [];
export function useDesktopDocumentPanels(
  enabled: boolean,
  outline: readonly { text: string; level: number }[] = EMPTY_ITEMS,
  bookmarks: readonly { label?: string; preview?: string }[] = EMPTY_ITEMS,
) {
  const layout = useWorkspaceLayout();
  const [preview, setPreview] = useState<DocumentPanelKind | null>(null);
  const [error, setError] = useState("");
  const visible =
    enabled &&
    Boolean(preview || layout.outlinePinned || layout.bookmarkPinned);
  const widths = useMemo(() => {
    const sizes = { outline: 280, bookmark: 280 };
    if (!visible) return sizes;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return sizes;
    context.font = `400 13px ${getComputedStyle(document.documentElement).getPropertyValue("--font")}`;
    // Measure the full data, including headings outside the virtual list window.
    const base = outline.reduce(
      (level, item) => Math.min(level, item.level),
      6,
    );
    for (const item of outline)
      sizes.outline = Math.max(
        sizes.outline,
        Math.ceil(context.measureText(item.text).width) +
          76 +
          (item.level - base) * 14,
      );
    for (const item of bookmarks)
      sizes.bookmark = Math.max(
        sizes.bookmark,
        Math.ceil(
          context.measureText(item.label || item.preview || "书签").width,
        ) + 136,
      );
    return sizes;
  }, [visible, outline, bookmarks]);
  const autoWidth =
    layout.panelsArrangement === "horizontal" &&
    layout.outlinePinned &&
    layout.bookmarkPinned
      ? Math.max(
          widths.outline / layout.panelRatio,
          widths.bookmark / (1 - layout.panelRatio),
        )
      : Math.max(
          layout.outlinePinned ? widths.outline : 0,
          layout.bookmarkPinned ? widths.bookmark : 0,
          280,
        );
  const savedWidth =
    layout.panelsArrangement === "horizontal"
      ? layout.horizontalPanelWidth
      : layout.panelWidth;
  const defaultWidth =
    layout.panelsArrangement === "horizontal"
      ? DEFAULT_WORKSPACE_LAYOUT.horizontalPanelWidth
      : DEFAULT_WORKSPACE_LAYOUT.panelWidth;
  // Default sizing follows content; preserve a width explicitly adjusted by dragging.
  const dockWidth =
    savedWidth === defaultWidth ? Math.max(savedWidth, autoWidth) : savedWidth;
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pinned = useCallback(
    (kind: DocumentPanelKind) =>
      enabled &&
      (kind === "outline" ? layout.outlinePinned : layout.bookmarkPinned),
    [enabled, layout],
  );
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
  }, []);
  const dismiss = useCallback(() => {
    cancel();
    setPreview(null);
  }, [cancel]);
  const openPreview = useCallback(
    (kind: DocumentPanelKind) => {
      cancel();
      if (enabled && !pinned(kind)) setPreview(kind);
    },
    [cancel, enabled, pinned],
  );
  const enter = (kind: DocumentPanelKind, pointerType: string) => {
    if (pointerType !== "mouse" || !enabled || pinned(kind)) return;
    cancel();
    timer.current = setTimeout(() => openPreview(kind), 140);
  };
  const leave = useCallback(() => {
    cancel();
    timer.current = setTimeout(() => {
      const active = document.activeElement;
      if (
        active instanceof Element &&
        active.closest("[data-document-preview]") &&
        active.matches("input, textarea, select, [contenteditable=true]")
      )
        return;
      setPreview(null);
    }, 220);
  }, [cancel]);
  const toggle = useCallback(
    (kind: DocumentPanelKind) => {
      dismiss();
      if (
        !saveWorkspaceLayout(
          kind === "outline"
            ? { outlinePinned: !layout.outlinePinned }
            : { bookmarkPinned: !layout.bookmarkPinned },
        )
      )
        setError("面板设置保存失败，请检查本机存储权限。");
      else setError("");
    },
    [dismiss, layout],
  );
  useEffect(() => {
    if (!enabled) dismiss();
    return cancel;
  }, [enabled, dismiss, cancel]);
  useEffect(() => {
    if (!preview) return;
    const outside = (event: MouseEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(
          "[data-document-preview], [data-document-panel-trigger]",
        )
      )
        dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("click", outside);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [preview, dismiss]);
  return {
    enabled,
    layout,
    widths,
    dockWidth,
    preview: enabled && preview && !pinned(preview) ? preview : null,
    pinned,
    toggle,
    enter,
    leave,
    cancel,
    dismiss,
    openPreview,
    error,
    clearError: () => setError(""),
  };
}
export type DesktopDocumentPanelController = ReturnType<
  typeof useDesktopDocumentPanels
>;

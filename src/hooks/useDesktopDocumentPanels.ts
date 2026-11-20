import { sourceVimOwnsEscape } from "../lib/vim-escape";
import { outlineLabel } from "../lib/heading-links";
import { useDocumentWorkspace } from "./useDocumentWorkspace";
import { saveCompactPanel, saveDocumentDock, type DocumentWorkspaceOrigin } from "../lib/document-workspace-layout";
import { useDocumentActive } from "../components/RetainedDocument";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceLayout } from "./useWorkspaceLayout";
import {
  DEFAULT_WORKSPACE_LAYOUT,
  saveWorkspaceLayout,
} from "../lib/workspace-layout";
import { openDockPanel, visibleDockGroups, type DockPanel, type DocumentDockLayout } from "../lib/document-dock-layout";

export type DocumentPanelKind = "outline" | "bookmark";
const EMPTY_ITEMS: never[] = [];
export function useDesktopDocumentPanels(
  enabled: boolean,
  outline: readonly { text: string; displayText?: string; level: number }[] = EMPTY_ITEMS,
  bookmarks: readonly { label?: string; preview?: string }[] = EMPTY_ITEMS,
  annotations: readonly { exact?: string; note?: string }[] = EMPTY_ITEMS,
  outlineSingleLineLimit?: number,
  origin: DocumentWorkspaceOrigin = "database",
  compactOnly = false,
  outlineEnabled = true,
  matchesEnabled = false,
) {
  const active = useDocumentActive();
  enabled = enabled && active;
  const baseLayout = useWorkspaceLayout();
  const preferences = useDocumentWorkspace();
  const mode = compactOnly ? "compact" : preferences[origin];
  const compact = preferences.compact[origin];
  const dock = preferences.docks?.[origin];
  const available = (kind: DockPanel) => kind === "outline" ? outlineEnabled : kind === "matches" ? matchesEnabled : true;
  const dockActive = useMemo(() => dock && visibleDockGroups(
    dock, kind => kind === "outline" ? outlineEnabled : kind === "matches" ? matchesEnabled : true,
  ), [dock, outlineEnabled, matchesEnabled]);
  const dragHandler = useRef<(kind: DockPanel, event: PointerEvent) => void>();
  const connectDockDrag = useCallback((handler?: (kind: DockPanel, event: PointerEvent) => void) => {
    dragHandler.current = handler;
  }, []);
  const startDockDrag = (kind: DockPanel, event: PointerEvent) => {
    if (enabled && available(kind)) dragHandler.current?.(kind, event);
  };
  const layout = useMemo(() => {
    const next = mode === "compact" ? { ...baseLayout, panelsArrangement: "vertical" as const, outlinePinned: compact.active === "outline", bookmarkPinned: compact.active === "bookmark", panelWidth: compact.width } : baseLayout;
    if (dock) return {
      ...next, panelsArrangement: "vertical" as const,
      outlinePinned: outlineEnabled && dock.groups.some(group => group.panels.includes("outline")) && !dock.closed.includes("outline"),
      bookmarkPinned: dock.groups.some(group => group.panels.includes("bookmark")) && !dock.closed.includes("bookmark"),
    };
    // Mask unavailable navigation without destroying the user's pinned preference.
    return outlineEnabled ? next : { ...next, outlinePinned: false };
  }, [baseLayout, compact.active, compact.width, dock, mode, outlineEnabled]);
  const [preview, setPreview] = useState<DocumentPanelKind | null>(null);
  const [error, setError] = useState("");
  const changeDock = useCallback((change: (current: DocumentDockLayout | undefined) => DocumentDockLayout | undefined) => {
    const saved = saveDocumentDock(origin, change);
    setError(saved ? "" : "面板布局保存失败，请检查本机存储权限。");
    return saved;
  }, [origin]);
  const showDockPanel = useCallback((kind: DockPanel, close = false) => {
    return changeDock(current => current && openDockPanel(current, kind, close));
  }, [changeDock]);
  const visible =
    enabled &&
    Boolean(preview || layout.outlinePinned || layout.bookmarkPinned);
  const [widths, previewWidths] = useMemo(() => {
    const sizes = { outline: 280, bookmark: 280 };
    const previews = { ...sizes };
    if (!visible) return [sizes, previews];
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return [sizes, previews];
    context.font = `400 13px ${getComputedStyle(document.documentElement).getPropertyValue("--font")}`;
    // Measure the full data, including headings outside the virtual list window.
    const base = outline.reduce(
      (level, item) => Math.min(level, item.level),
      6,
    );
    for (const item of outline) {
      previews.outline = Math.max(previews.outline, Math.ceil(context.measureText(outlineLabel(item.displayText ?? item.text)).width) + 76 + (item.level - base) * 14);
      sizes.outline = Math.max(
        sizes.outline,
        Math.ceil(context.measureText(Array.from(item.displayText ?? item.text).slice(0, outlineSingleLineLimit).join("")).width) +
          76 +
          (item.level - base) * 14,
      );
    }
    for (const item of bookmarks)
      sizes.bookmark = Math.max(
        sizes.bookmark,
        Math.ceil(
          context.measureText(item.label || item.preview || "书签").width,
        ) + 136,
      );
    for (const item of annotations)
      sizes.bookmark = Math.max(
        sizes.bookmark,
        Math.ceil(context.measureText(item.note || item.exact || "高亮").width) + 136,
      );
    previews.bookmark = sizes.bookmark;
    return [sizes, previews];
  }, [visible, outline, bookmarks, annotations, outlineSingleLineLimit]);
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
    mode === "compact" ? compact.width : savedWidth === defaultWidth ? Math.max(savedWidth, autoWidth) : savedWidth;
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pinned = useCallback(
    (kind: DocumentPanelKind) =>
      enabled &&
      (kind === "outline" ? layout.outlinePinned : layout.bookmarkPinned),
    [enabled, layout],
  );
  const selected = useCallback((kind: DockPanel) =>
    enabled && (dockActive ? dockActive.some(group => group.active === kind) : kind !== "matches" && pinned(kind)),
  [enabled, dockActive, pinned]);
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
      if (!enabled || (kind === "outline" && !outlineEnabled)) return;
      if (!pinned(kind)) setPreview(kind);
      else if (dock && !selected(kind)) showDockPanel(kind);
    },
    [cancel, dock, enabled, pinned, outlineEnabled, selected, showDockPanel],
  );
  const enter = (kind: DocumentPanelKind, pointerType: string) => {
    if (kind === "outline" && !outlineEnabled) return;
    // Placement controls docking, not access to a transient desktop preview.
    if (pointerType !== "mouse" || !enabled || pinned(kind) ||
      !window.matchMedia("(min-width: 769px) and (pointer: fine)").matches) return;
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
      if (kind === "outline" && !outlineEnabled) return;
      dismiss();
      if (dock) {
        showDockPanel(kind, dockActive?.some(group => group.active === kind));
        return;
      }
      if (
        !(mode === "compact" ? saveCompactPanel(origin, { active: compact.active === kind ? null : kind }) : saveWorkspaceLayout(
          kind === "outline"
            ? { outlinePinned: !layout.outlinePinned }
            : { bookmarkPinned: !layout.bookmarkPinned },
        ))
      )
        setError("面板设置保存失败，请检查本机存储权限。");
      else setError("");
    },
    [dismiss, dock, dockActive, showDockPanel, layout, mode, origin, compact.active, outlineEnabled],
  );
  useEffect(() => {
    dismiss();
    return cancel;
  }, [enabled, mode, outlineEnabled, dismiss, cancel]);
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
      if (event.key === "Escape" && !sourceVimOwnsEscape(event) && !event.defaultPrevented
        && !(event.target instanceof Element && event.target.closest(".cm-vimMode, .vim-mode-enabled"))) dismiss();
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
    dock,
    dockActive,
    changeDock,
    showDockPanel,
    connectDockDrag,
    startDockDrag,
    mode,
    origin,
    saveWidth: (width: number) => mode === "compact" ? saveCompactPanel(origin, { width }) : saveWorkspaceLayout(layout.panelsArrangement === "horizontal" ? { horizontalPanelWidth: width } : { panelWidth: width }),
    layout,
    widths,
    previewWidths,
    dockWidth,
    preview: enabled && preview && (preview !== "outline" || outlineEnabled) && !pinned(preview) ? preview : null,
    pinned,
    selected,
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

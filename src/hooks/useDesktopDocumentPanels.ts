import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceLayout } from "./useWorkspaceLayout";
import { saveWorkspaceLayout } from "../lib/workspace-layout";
export type DocumentPanelKind = "outline" | "bookmark";
export function useDesktopDocumentPanels(enabled: boolean) {
  const layout = useWorkspaceLayout();
  const [preview, setPreview] = useState<DocumentPanelKind | null>(null);
  const [error, setError] = useState("");
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

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { ToolbarIcon } from "./ToolbarIcon";
import "./ReaderToolbar.css";

export type ReaderToolPanel = "search" | "appearance" | "annotations" | null;

interface Props {
  format: "PDF" | "EPUB";
  title: string;
  onClose: () => void;
  navigation: ReactNode;
  libraryActions: ReactNode;
  focusAction: ReactNode;
  appearance: ReactNode;
  annotations?: ReactNode;
  search: ReactNode;
  activePanel: ReaderToolPanel;
  onPanelChange: (panel: ReaderToolPanel) => void;
  notice?: ReactNode;
  activeTool?: ReactNode;
}

/** Shared reader chrome only. Panels stay inside the reader's fullscreen root,
 * overlay (never resize) the page viewport, and never own reading state. */
export function ReaderToolbar({
  format, title, onClose, navigation, libraryActions, focusAction,
  appearance, annotations, search, activePanel, onPanelChange, notice, activeTool,
}: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const panelId = useId();
  const changeRef = useRef(onPanelChange);
  changeRef.current = onPanelChange;
  const panels: { key: Exclude<ReaderToolPanel, null>; label: string; content: ReactNode }[] = [
    { key: "search", label: "搜索", content: search },
    { key: "appearance", label: "阅读设置", content: appearance },
    ...(annotations ? [{ key: "annotations" as const, label: "批注工具", content: annotations }] : []),
  ];

  useLayoutEffect(() => {
    if (!activePanel) return;
    const panel = rootRef.current?.querySelector<HTMLElement>(`[data-reader-panel="${activePanel}"]`);
    // Direct focus during the opening click keeps iOS's keyboard activation.
    const target = panel?.querySelector<HTMLElement>(activePanel === "search" ? "input" : "button");
    target?.focus({ preventScroll: true });
  }, [activePanel]);

  useEffect(() => {
    if (!activePanel) return;
    const close = (restoreFocus: boolean) => {
      changeRef.current(null);
      if (restoreFocus) rootRef.current?.querySelector<HTMLElement>(`[data-reader-trigger="${activePanel}"]`)?.focus({ preventScroll: true });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation(); // First Escape closes tools, not the entire book.
      close(true);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) close(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [activePanel]);

  return <header ref={rootRef} className={`pdf-reader-toolbar reader-toolbar${format === "EPUB" ? " epub-reader-toolbar" : ""}`}>
    <div className="reader-toolbar-main">
      <button type="button" className="pdf-reader-close" onClick={onClose} aria-label={`关闭 ${format} 阅读器`} title="返回 Nine Rings">←</button>
      <strong className="pdf-reader-title" title={title}>{title}</strong>
      <div className="reader-library-actions" onClick={() => onPanelChange(null)}>{libraryActions}</div>
      <span className="reader-focus-action" onClick={() => onPanelChange(null)}>{focusAction}</span>
    </div>
    <div className="reader-toolbar-controls">
      <div className="reader-navigation" onClick={() => onPanelChange(null)}>{navigation}</div>
      <div className="reader-panel-triggers">
        {panels.map(({ key, label }) => <button
          key={key} type="button" data-reader-trigger={key}
          className={activePanel === key ? "active" : undefined}
          aria-label={`${format} ${label}`} title={`${format} ${label}`}
          aria-expanded={activePanel === key} aria-controls={`${panelId}-${key}`}
          onClick={() => onPanelChange(activePanel === key ? null : key)}
        >
          {key === "search" ? <ToolbarIcon name="search" /> : key === "annotations" ? <ToolbarIcon name="annotate" /> : format === "EPUB" ? <span aria-hidden="true" className="reader-type-icon">Aa</span> : <ToolbarIcon name="sliders" />}
          <span className="reader-action-label">{label}</span>
        </button>)}
      </div>
    </div>
    {activeTool && <div className="reader-active-tool">{activeTool}</div>}
    {notice && !activePanel && <div className="reader-toolbar-notice" role="status" aria-live="polite">{notice}</div>}
    {activePanel && activePanel !== "search" && <button
      type="button" className="reader-panel-backdrop" tabIndex={-1} aria-label="关闭阅读工具面板"
      onPointerDown={(event) => event.preventDefault()} onClick={() => {
        onPanelChange(null);
        rootRef.current?.querySelector<HTMLElement>(`[data-reader-trigger="${activePanel}"]`)?.focus({ preventScroll: true });
      }}
    />}
    {panels.map(({ key, label, content }) => <section
      key={key} id={`${panelId}-${key}`} data-reader-panel={key}
      className="reader-tool-panel" hidden={activePanel !== key}
      aria-label={`${format} ${label}`}
    >
      <div className="reader-tool-panel-heading"><strong>{label}</strong><button type="button" aria-label={`关闭 ${format} ${label}`} onClick={() => {
        onPanelChange(null);
        rootRef.current?.querySelector<HTMLElement>(`[data-reader-trigger="${key}"]`)?.focus({ preventScroll: true });
      }}>×</button></div>
      {content}
      {notice && activePanel === key && <div className="reader-panel-notice" role="status" aria-live="polite">{notice}</div>}
    </section>)}
  </header>;
}

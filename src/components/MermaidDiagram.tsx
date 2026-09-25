import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { BLOCK_WORKSPACE_DISPLAY_EVENT } from "../lib/block-display-settings";
import { renderMermaid } from "../lib/mermaid-render";

export type MermaidViewTransform = { scale: number; x: number; y: number };
type PointerPosition = { x: number; y: number };
const defaultView: MermaidViewTransform = { scale: 1, x: 0, y: 0 };
const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.05;

function distance(a: PointerPosition, b: PointerPosition) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function MermaidDiagram({ source, interactive = false, initialView = defaultView, onViewChange }: {
  source: string;
  interactive?: boolean;
  initialView?: MermaidViewTransform;
  onViewChange?: (view: MermaidViewTransform) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [toolbar, setToolbar] = useState<Element | null>(null);
  const inlineBaseWidth = useRef(0);
  const pointers = useRef(new Map<number, PointerPosition>());
  const viewRef = useRef<MermaidViewTransform>(initialView);
  const initialViewRef = useRef(initialView);
  const [view, setView] = useState<MermaidViewTransform>(initialView);
  const [result, setResult] = useState<{ svg?: string; error?: string }>({});

  const applyView = useCallback((next: MermaidViewTransform) => {
    if (interactive) {
      const viewport = viewportRef.current;
      const svg = viewport?.querySelector("svg");
      if (viewport && svg) {
        // SVG client size excludes our transform. Allow panning only over the
        // overflow, keeping smaller diagrams centered in the viewport.
        const width = svg.clientWidth * next.scale;
        const height = svg.clientHeight * next.scale;
        const limitX = Math.max(0, (width - viewport.clientWidth) / 2);
        const limitY = Math.max(0, (height - viewport.clientHeight) / 2);
        next = { ...next, x: Math.max(-limitX, Math.min(limitX, next.x)), y: Math.max(-limitY, Math.min(limitY, next.y)) };
      }
    }
    viewRef.current = next;
    setView(next);
    onViewChange?.(next);
  }, [onViewChange, interactive]);

  const zoomAt = useCallback((factor: number, point?: PointerPosition) => {
    if (!interactive) {
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, viewRef.current.scale * factor));
      applyView({ scale, x: 0, y: 0 });
      return;
    }
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const current = viewRef.current;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.scale * factor));
    const ratio = scale / current.scale;
    const x = (point?.x ?? rect.left + rect.width / 2) - (rect.left + rect.width / 2);
    const y = (point?.y ?? rect.top + rect.height / 2) - (rect.top + rect.height / 2);
    applyView({ scale, x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio });
  }, [applyView, interactive]);

  useEffect(() => {
    const viewport = interactive ? viewportRef.current : rootRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      if (!interactive && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomAt(event.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP, { x: event.clientX, y: event.clientY });
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, [interactive, result.svg, zoomAt]);

  useEffect(() => {
    if (interactive) return;
    const root = rootRef.current;
    if (!root) return;
    let previousDistance: number | null = null;
    const pinch = (event: TouchEvent) => {
      if (event.touches.length !== 2) { previousDistance = null; return; }
      event.preventDefault();
      const [a, b] = [event.touches[0], event.touches[1]];
      const nextDistance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (previousDistance && event.type === "touchmove") zoomAt(nextDistance / previousDistance);
      previousDistance = nextDistance;
    };
    root.addEventListener("touchstart", pinch, { passive: false });
    root.addEventListener("touchmove", pinch, { passive: false });
    root.addEventListener("touchend", pinch);
    root.addEventListener("touchcancel", pinch);
    return () => {
      root.removeEventListener("touchstart", pinch);
      root.removeEventListener("touchmove", pinch);
      root.removeEventListener("touchend", pinch);
      root.removeEventListener("touchcancel", pinch);
    };
  }, [interactive, zoomAt]);

  useLayoutEffect(() => {
    if (!interactive) setToolbar(rootRef.current?.closest(".code-block-wrap")?.querySelector("[data-mermaid-controls]") ?? null);
  }, [interactive]);

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.buttons === 0) {
      pointers.current.clear();
      return;
    }
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    event.preventDefault();
    const next = { x: event.clientX, y: event.clientY };
    const positions = [...pointers.current.entries()];
    pointers.current.set(event.pointerId, next);
    if (positions.length === 1) {
      const current = viewRef.current;
      applyView({ ...current, x: current.x + next.x - previous.x, y: current.y + next.y - previous.y });
      return;
    }
    const other = positions.find(([id]) => id !== event.pointerId)?.[1];
    if (!other) return;
    const oldMiddle = { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 };
    const newMiddle = { x: (next.x + other.x) / 2, y: (next.y + other.y) / 2 };
    zoomAt(distance(next, other) / Math.max(1, distance(previous, other)), oldMiddle);
    const current = viewRef.current;
    applyView({ ...current, x: current.x + newMiddle.x - oldMiddle.x, y: current.y + newMiddle.y - oldMiddle.y });
  };
  const pointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  useEffect(() => {
    let cancelled = false;
    const element = rootRef.current;
    if (!element) return;
    applyView(initialViewRef.current);
    setResult(previous => ({ svg: previous.svg }));
    void renderMermaid(source).then(
      svg => { if (!cancelled) setResult({ svg }); },
      error => {
        if (!cancelled) setResult(previous => ({ ...previous, error: error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "无法渲染图表" }));
      },
    );
    return () => { cancelled = true; };
  }, [source, applyView]);

  useLayoutEffect(() => {
    if (interactive) return;
    const root = rootRef.current;
    const svg = root?.querySelector("svg");
    const width = svg?.viewBox.baseVal.width;
    if (!root || !width || !Number.isFinite(width) || width <= 0) return;
    root.style.setProperty("--mermaid-natural-width", `${width}px`);
    const resize = () => {
      const style = getComputedStyle(root);
      const available = root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (available <= 0) return;
      const base = style.getPropertyValue("--mermaid-inline-max-width").trim() === "none"
        ? width : Math.min(width, available);
      inlineBaseWidth.current = base;
      root.style.setProperty("--mermaid-zoom-width", `${base * viewRef.current.scale}px`);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    window.addEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, resize);
    window.addEventListener("storage", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, resize);
      window.removeEventListener("storage", resize);
    };
  }, [interactive, result.svg]);

  useLayoutEffect(() => {
    if (!interactive && inlineBaseWidth.current > 0)
      rootRef.current?.style.setProperty("--mermaid-zoom-width", `${inlineBaseWidth.current * view.scale}px`);
  }, [interactive, view.scale]);

  useLayoutEffect(() => {
    if (!interactive || !viewportRef.current || !result.svg) return;
    const observer = new ResizeObserver(() => applyView(viewRef.current));
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, [interactive, result.svg, applyView]);

  const controls = result.svg ? <div className="mermaid-diagram-controls" role="toolbar" aria-label="图表缩放">
      <button type="button" aria-label="缩小图表" disabled={view.scale <= MIN_SCALE} onClick={() => zoomAt(1 / ZOOM_STEP)}>−</button>
      <span role="status">{Math.round(view.scale * 100)}%</span>
      <button type="button" aria-label="放大图表" disabled={view.scale >= MAX_SCALE} onClick={() => zoomAt(ZOOM_STEP)}>+</button>
      <button type="button" aria-label="适应窗口" onClick={() => applyView(defaultView)}>适应</button>
    </div> : null;
  return <div ref={rootRef} className={`mermaid-diagram ${interactive ? "mermaid-diagram-interactive" : view.scale !== 1 ? "mermaid-diagram-zoomed" : ""}`} contentEditable={false} aria-label="Mermaid 图表">
    {interactive ? controls : toolbar && controls ? createPortal(controls, toolbar) : null}
    {result.svg && result.error && <div className="mermaid-diagram-error" role="status">图表无法更新，保留上一次图形：{result.error}</div>}
    {result.svg
      ? interactive
        ? <div ref={viewportRef} className="mermaid-diagram-viewport" aria-label="可拖动图表" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}>
            <div className="mermaid-diagram-canvas mermaid-diagram-svg" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} dangerouslySetInnerHTML={{ __html: result.svg }} />
          </div>
        : <div className="mermaid-diagram-svg" dangerouslySetInnerHTML={{ __html: result.svg }} />
      : result.error
        ? <div className="mermaid-diagram-error" role="status">图表无法渲染：{result.error}。可切换到源码修改。</div>
        : <div className="mermaid-diagram-loading" role="status">正在绘制图表…</div>}
  </div>;
}

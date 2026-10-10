import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MermaidTypographyContext } from "./ReadingTypographyProvider";
import { createPortal } from "react-dom";
import { BLOCK_WORKSPACE_DISPLAY_EVENT } from "../lib/block-display-settings";
import { diagramWheelDelta, pinchScale, pinchView, touchCenter, wheelZoomFactor } from "../lib/diagram-gesture";
import { renderMermaid } from "../lib/mermaid-render";

export type MermaidViewTransform = { scale: number; x: number; y: number };
type PointerPosition = { x: number; y: number };
const defaultView: MermaidViewTransform = { scale: 1, x: 0, y: 0 };
const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.05;

type PinchStart = { ids: number[]; points: PointerPosition[]; view: MermaidViewTransform };

export function MermaidDiagram({ source, interactive = false, initialView = defaultView, onViewChange }: {
  source: string;
  interactive?: boolean;
  initialView?: MermaidViewTransform;
  onViewChange?: (view: MermaidViewTransform) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const typography = useContext(MermaidTypographyContext);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [toolbar, setToolbar] = useState<Element | null>(null);
  const inlineBaseWidth = useRef(0);
  const pointerPinch = useRef<PinchStart | null>(null);
  const directTouchActive = useRef(false);
  const inlineAnchor = useRef<{ x: number; y: number; center: PointerPosition } | null>(null);
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
      const bounds = rootRef.current?.querySelector("svg")?.getBoundingClientRect();
      if (point && bounds?.width && bounds.height) {
        inlineAnchor.current = { x: (point.x - bounds.left) / bounds.width, y: (point.y - bounds.top) / bounds.height, center: point };
      }
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
    let nativeGesture: { scale: number; point: PointerPosition } | null = null;
    const wheel = (event: WheelEvent) => {
      const delta = diagramWheelDelta(event, { width: viewport.clientWidth, height: viewport.clientHeight });
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        if (!nativeGesture && !directTouchActive.current && pointers.current.size === 0 && delta.y !== 0) {
          zoomAt(wheelZoomFactor(delta.y), { x: event.clientX, y: event.clientY });
        }
        return;
      }
      if (interactive) {
        const before = viewRef.current;
        applyView({ ...before, x: before.x - delta.x, y: before.y - delta.y });
        event.preventDefault();
        event.stopPropagation();
      } else {
        // Consume only when the diagram can move. At its boundary, leave the
        // native wheel available to scroll the document instead of trapping it.
        const left = viewport.scrollLeft, top = viewport.scrollTop;
        viewport.scrollLeft += delta.x;
        viewport.scrollTop += delta.y;
        if (viewport.scrollLeft !== left || viewport.scrollTop !== top) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    };
    // Safari/WKWebView can report native GestureEvents instead of ctrl+wheel.
    // Touchscreen pinch already has its own handler; do not apply it twice.
    const gesture = (event: Event) => {
      if (directTouchActive.current || pointers.current.size > 0 || !result.svg) return;
      const native = event as Event & { scale?: number; clientX?: number; clientY?: number };
      const bounds = viewport.getBoundingClientRect();
      const point = {
        x: native.clientX !== undefined && native.clientX >= bounds.left && native.clientX <= bounds.right ? native.clientX : bounds.left + bounds.width / 2,
        y: native.clientY !== undefined && native.clientY >= bounds.top && native.clientY <= bounds.bottom ? native.clientY : bounds.top + bounds.height / 2,
      };
      if (event.type === "gesturestart") nativeGesture = { scale: viewRef.current.scale, point };
      if (!nativeGesture) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.type === "gestureend") { nativeGesture = null; return; }
      if (event.type === "gesturechange" && native.scale !== undefined && Number.isFinite(native.scale) && native.scale > 0) {
        zoomAt(nativeGesture.scale * native.scale / viewRef.current.scale, nativeGesture.point);
      }
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) viewport.addEventListener(type, gesture, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", wheel);
      for (const type of ["gesturestart", "gesturechange", "gestureend"]) viewport.removeEventListener(type, gesture);
    };
  }, [interactive, result.svg, zoomAt, applyView]);

  useEffect(() => {
    if (interactive) return;
    const root = rootRef.current;
    if (!root) return;
    let gesture: (PinchStart & { anchorX: number; anchorY: number }) | null = null;
    let consumed = false;
    const pinch = (event: TouchEvent) => {
      directTouchActive.current = event.type !== "touchcancel" && event.touches.length > 0;
      if (event.touches.length >= 2 || consumed) {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
      }
      if (event.type === "touchcancel" || event.touches.length !== 2) {
        gesture = null;
        consumed = event.touches.length > 0 && consumed;
        return;
      }
      const touches = [...event.touches];
      const points = touches.map(touch => ({ x: touch.clientX, y: touch.clientY }));
      if (!gesture || !gesture.ids.every(id => touches.some(touch => touch.identifier === id))) {
        const svg = root.querySelector("svg");
        const bounds = svg?.getBoundingClientRect();
        if (!bounds?.width || !bounds.height) return;
        const center = touchCenter(points[0], points[1]);
        gesture = {
          ids: touches.map(touch => touch.identifier), points, view: viewRef.current,
          anchorX: (center.x - bounds.left) / bounds.width,
          anchorY: (center.y - bounds.top) / bounds.height,
        };
        consumed = true;
        return;
      }
      if (event.type !== "touchmove") return;
      const next = gesture.ids.map(id => {
        const touch = touches.find(touch => touch.identifier === id)!;
        return { x: touch.clientX, y: touch.clientY };
      });
      inlineAnchor.current = { x: gesture.anchorX, y: gesture.anchorY, center: touchCenter(next[0], next[1]) };
      applyView({ scale: pinchScale(gesture.view.scale, gesture.points[0], gesture.points[1], next[0], next[1]), x: 0, y: 0 });
    };
    root.addEventListener("touchstart", pinch, { passive: false });
    root.addEventListener("touchmove", pinch, { passive: false });
    root.addEventListener("touchend", pinch, { passive: false });
    root.addEventListener("touchcancel", pinch, { passive: false });
    return () => {
      directTouchActive.current = false;
      inlineAnchor.current = null;
      root.removeEventListener("touchstart", pinch);
      root.removeEventListener("touchmove", pinch);
      root.removeEventListener("touchend", pinch);
      root.removeEventListener("touchcancel", pinch);
    };
  }, [interactive, result.svg, applyView]);

  useLayoutEffect(() => {
    if (!interactive) setToolbar(rootRef.current?.closest(".code-block-wrap")?.querySelector("[data-mermaid-controls]") ?? null);
  }, [interactive]);

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      pointerPinch.current = { ids: [...pointers.current.keys()], points: [...pointers.current.values()], view: viewRef.current };
    } else pointerPinch.current = null;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Synthetic or expired pointer. */ }
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.buttons === 0) {
      pointers.current.clear();
      pointerPinch.current = null;
      return;
    }
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    event.preventDefault();
    const next = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, next);
    if (pointers.current.size === 1) {
      const current = viewRef.current;
      applyView({ ...current, x: current.x + next.x - previous.x, y: current.y + next.y - previous.y });
      return;
    }
    const gesture = pointerPinch.current;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!gesture || !rect || pointers.current.size !== 2) return;
    const nextPoints = gesture.ids.map(id => pointers.current.get(id)!);
    applyView(pinchView(gesture.view, gesture.points[0], gesture.points[1], nextPoints[0], nextPoints[1], { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }));
  };
  const pointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    pointerPinch.current = pointers.current.size === 2
      ? { ids: [...pointers.current.keys()], points: [...pointers.current.values()], view: viewRef.current }
      : null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  useEffect(() => {
    let cancelled = false;
    const element = rootRef.current;
    if (!element) return;
    applyView(initialViewRef.current);
    setResult(previous => ({ svg: previous.svg }));
    void renderMermaid(source, undefined, typography).then(
      svg => { if (!cancelled) setResult({ svg }); },
      error => {
        if (!cancelled) setResult(previous => ({ ...previous, error: error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "无法渲染图表" }));
      },
    );
    return () => { cancelled = true; };
  }, [source, applyView, typography]);

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
    if (interactive || inlineBaseWidth.current <= 0) return;
    const root = rootRef.current;
    root?.style.setProperty("--mermaid-zoom-width", `${inlineBaseWidth.current * view.scale}px`);
    const anchor = inlineAnchor.current;
    const bounds = root?.querySelector("svg")?.getBoundingClientRect();
    if (root && anchor && bounds) {
      // Use the final SVG geometry after React applies the zoom class. Scrolling
      // keeps the touch anchor visible without translating content out of reach.
      root.scrollLeft += bounds.left + anchor.x * bounds.width - anchor.center.x;
      root.scrollTop += bounds.top + anchor.y * bounds.height - anchor.center.y;
      inlineAnchor.current = null;
    }
  }, [interactive, view]);

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
        ? <div ref={viewportRef} className="mermaid-diagram-viewport" aria-label="可拖动图表" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd}>
            <div className="mermaid-diagram-canvas mermaid-diagram-svg" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} dangerouslySetInnerHTML={{ __html: result.svg }} />
          </div>
        : <div className="mermaid-diagram-svg" dangerouslySetInnerHTML={{ __html: result.svg }} />
      : result.error
        ? <div className="mermaid-diagram-error" role="status">图表无法渲染：{result.error}。可切换到源码修改。</div>
        : <div className="mermaid-diagram-loading" role="status">正在绘制图表…</div>}
  </div>;
}

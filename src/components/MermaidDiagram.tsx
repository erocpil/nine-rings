import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { mermaidPalette, renderMermaid } from "../lib/mermaid-render";

type ViewTransform = { scale: number; x: number; y: number };
type PointerPosition = { x: number; y: number };
const initialView: ViewTransform = { scale: 1, x: 0, y: 0 };
const MIN_SCALE = 0.25;
const MAX_SCALE = 8;

function distance(a: PointerPosition, b: PointerPosition) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function MermaidDiagram({ source, interactive = false }: { source: string; interactive?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, PointerPosition>());
  const viewRef = useRef<ViewTransform>(initialView);
  const [view, setView] = useState<ViewTransform>(initialView);
  const [result, setResult] = useState<{ svg?: string; error?: string }>({});
  const [themeKey, setThemeKey] = useState(() => JSON.stringify(mermaidPalette(document.documentElement)));

  const applyView = useCallback((next: ViewTransform) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const zoomAt = useCallback((factor: number, point?: PointerPosition) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const current = viewRef.current;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.scale * factor));
    const ratio = scale / current.scale;
    const x = (point?.x ?? rect.left + rect.width / 2) - (rect.left + rect.width / 2);
    const y = (point?.y ?? rect.top + rect.height / 2) - (rect.top + rect.height / 2);
    applyView({ scale, x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio });
  }, [applyView]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!interactive || !viewport) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAt(Math.exp(-event.deltaY * 0.0015), { x: event.clientX, y: event.clientY });
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, [interactive, result.svg, zoomAt]);

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
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
    const observer = new MutationObserver(() => {
      const next = JSON.stringify(mermaidPalette(document.documentElement));
      setThemeKey(current => current === next ? current : next);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const element = rootRef.current;
    if (!element) return;
    applyView(initialView);
    setResult({});
    void renderMermaid(source, mermaidPalette(element)).then(
      svg => { if (!cancelled) setResult({ svg }); },
      error => {
        if (!cancelled) setResult({ error: error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "无法渲染图表" });
      },
    );
    return () => { cancelled = true; };
  }, [source, themeKey, applyView]);

  return <div ref={rootRef} className={`mermaid-diagram ${interactive ? "mermaid-diagram-interactive" : ""}`} contentEditable={false} aria-label="Mermaid 图表">
    {interactive && result.svg && <div className="mermaid-diagram-controls" role="toolbar" aria-label="图表缩放">
      <button type="button" aria-label="缩小图表" disabled={view.scale <= MIN_SCALE} onClick={() => zoomAt(1 / 1.25)}>−</button>
      <span role="status">{Math.round(view.scale * 100)}%</span>
      <button type="button" aria-label="放大图表" disabled={view.scale >= MAX_SCALE} onClick={() => zoomAt(1.25)}>+</button>
      <button type="button" aria-label="适应窗口" onClick={() => applyView(initialView)}>适应</button>
    </div>}
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

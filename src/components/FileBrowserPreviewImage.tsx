import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { imageFitScale } from "../lib/image-library/view-transform";
import { wheelZoomFactor } from "../lib/diagram-gesture";

/** Scroll-based pan keeps both axes bounded by the actual image extent. Zoom is
 * measured against original pixels, not an arbitrary multiple of fit scale. */
export function FileBrowserPreviewImage({ src, name }: { src: string; name: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const fit = imageFitScale(size.width, size.height, Math.max(1, bounds.width - 16), Math.max(1, bounds.height - 16), 0);
  const scale = zoom ?? fit;
  const latest = useRef(scale); latest.current = scale;
  const changeZoom = useCallback((value: number) => {
    const next = Math.max(.01, Math.min(4, value));
    latest.current = next; setZoom(next);
  }, []);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setBounds({ width: element.clientWidth, height: element.clientHeight });
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let nativeGesture = false;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault(); event.stopPropagation();
      if (nativeGesture) return;
      changeZoom(latest.current * wheelZoomFactor(event.deltaY));
    };
    let initial = 1;
    const gesture = (event: Event) => {
      const value = event as Event & { scale?: number };
      event.preventDefault(); event.stopPropagation();
      if (event.type === "gesturestart") { initial = latest.current; nativeGesture = true; }
      else if (event.type === "gestureend") nativeGesture = false;
      else if (event.type === "gesturechange" && value.scale !== undefined && Number.isFinite(value.scale) && value.scale > 0) changeZoom(initial * value.scale);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) element.addEventListener(type, gesture, { passive: false });
    return () => { element.removeEventListener("wheel", wheel); for (const type of ["gesturestart", "gesturechange", "gestureend"]) element.removeEventListener(type, gesture); };
  }, [changeZoom]);
  useLayoutEffect(() => {
    // Changing only the preview recipe never writes to the file or the viewer.
    if (zoom === null && viewport.current) { viewport.current.scrollTop = 0; viewport.current.scrollLeft = 0; }
  }, [zoom, bounds]);
  return <>
    <div className="file-browser-preview-zoom" role="group" aria-label="预览图片缩放">
      <button type="button" aria-pressed={zoom === null} onClick={() => setZoom(null)}>适窗</button>
      <button type="button" aria-pressed={zoom === 1} onClick={() => setZoom(1)}>100%</button>
      <button type="button" aria-pressed={zoom === 2} onClick={() => setZoom(2)}>200%</button>
      <button type="button" aria-label="缩小预览图片" disabled={scale <= .01} onClick={() => changeZoom(scale / 1.25)}>−</button>
      <span aria-label="预览缩放比例">{Math.round(scale * 100)}%</span>
      <button type="button" aria-label="放大预览图片" disabled={scale >= 4} onClick={() => changeZoom(scale * 1.25)}>＋</button>
    </div>
    <div ref={viewport} className="file-browser-preview-image" tabIndex={0} aria-label="预览图片可滚动区域">
      <div style={{ width: size.width ? size.width * scale + 16 : "100%", height: size.height ? size.height * scale + 16 : "100%" }}>
        {failed ? <p role="status">无法解码此图片，请直接打开文件检查。</p> : <img src={src} alt={name} draggable={false} onError={() => setFailed(true)} onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} style={{ width: size.width ? size.width * scale : undefined, height: size.height ? size.height * scale : undefined }} />}
      </div>
    </div>
  </>;
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { diagramWheelDelta } from "../lib/diagram-gesture";
import type { ViewedImage } from "../lib/image-library/viewer-request";
import { ImageThumbnail } from "./ImageThumbnail";

const ITEM_WIDTH = 92;
export function ImageFilmstrip({
  images,
  index,
  active,
  onSelect,
}: {
  images: readonly ViewedImage[];
  index: number;
  active: boolean;
  onSelect: (index: number) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [range, setRange] = useState({ left: 0, width: 800 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const measure = () =>
      setRange({ left: el.scrollLeft, width: el.clientWidth });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [active]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    el.scrollLeft = Math.max(
      0,
      index * ITEM_WIDTH - (el.clientWidth - ITEM_WIDTH) / 2,
    );
    setRange({ left: el.scrollLeft, width: el.clientWidth });
  }, [index, active]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      const delta = diagramWheelDelta(event, {
        width: el.clientWidth,
        height: el.clientHeight,
      });
      const before = el.scrollLeft;
      el.scrollLeft +=
        Math.abs(delta.x) >= Math.abs(delta.y) ? delta.x : delta.y;
      if (el.scrollLeft !== before) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [active]);
  const start = Math.max(0, Math.floor(range.left / ITEM_WIDTH) - 2);
  const end = Math.min(
    images.length,
    Math.ceil((range.left + range.width) / ITEM_WIDTH) + 2,
  );
  return (
    <nav
      ref={ref}
      className="image-viewer-filmstrip"
      aria-label="图片缩略图导航"
      onScroll={(event) =>
        setRange({
          left: event.currentTarget.scrollLeft,
          width: event.currentTarget.clientWidth,
        })
      }
    >
      <div
        className="image-filmstrip-items"
        style={{ width: Math.max(0, images.length * ITEM_WIDTH - 6) }}
      >
        {images.slice(start, end).map((item, offset) => {
          const itemIndex = start + offset;
          return (
            <button
              key={`${item.rootId}:${item.nodeId}:${item.src}`}
              type="button"
              style={{ left: itemIndex * ITEM_WIDTH }}
              title={item.name}
              aria-label={`查看图片 ${item.name}`}
              aria-current={itemIndex === index ? "true" : undefined}
              onClick={() => onSelect(itemIndex)}
            >
              <ImageThumbnail image={item} active={active} />
              <span>{item.name}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

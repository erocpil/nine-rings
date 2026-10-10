import { useRef, useState } from "react";

/** A tap opens actions; a right swipe previews the type until release. */
export function BlockNumber({ number, displayNumber = number, format, className = "", style, onOpen }: {
  number: number; displayNumber?: number; format: string; className?: string; style?: React.CSSProperties;
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  const gesture = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(0);
  const [preview, setPreview] = useState(false);
  return <button type="button" className={`editor-block-number ${className}${preview ? " block-type-preview" : ""}`}
    style={style} data-block-index={number} data-block-format={format}
    aria-label={`第 ${number} 块操作`} aria-haspopup="menu"
    onMouseDown={event => event.preventDefault()}
    onTouchStart={event => {
      const touch = event.touches[0];
      gesture.current = event.touches.length === 1 ? { id: touch.identifier, x: touch.clientX, y: touch.clientY, moved: false } : null;
      if (event.touches.length !== 1) suppressClick.current = Date.now() + 2000;
    }}
    onTouchMove={event => {
      const start = gesture.current;
      const touch = Array.from(event.touches).find(item => item.identifier === start?.id);
      if (!start || !touch) return;
      const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
      if (event.touches.length !== 1 || Math.hypot(dx, dy) > 12) start.moved = true;
      setPreview(event.touches.length === 1 && dx > 12 && dx > Math.abs(dy));
    }}
    onTouchCancel={() => { gesture.current = null; setPreview(false); suppressClick.current = Date.now() + 2000; }}
    onTouchEnd={event => {
      const start = gesture.current;
      const touch = Array.from(event.changedTouches).find(item => item.identifier === start?.id);
      gesture.current = null;
      setPreview(false);
      suppressClick.current = Date.now() + 2000;
      if (!start || start.moved || !touch || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 12) return;
      event.preventDefault(); event.stopPropagation(); onOpen(event.currentTarget);
    }}
    onClick={event => {
      event.stopPropagation();
      if (Date.now() < suppressClick.current || (event.nativeEvent as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents) return;
      onOpen(event.currentTarget);
    }}
  >{displayNumber}</button>;
}

import { useRef, type MouseEventHandler } from "react";
import { EditorFoldIcon } from "./EditorFoldIcon";
import { ToolbarIcon } from "./ToolbarIcon";
import { blockquoteCaption } from "../lib/structured-block-display";

export function BlockquoteToolbar({ text, collapsed, toggle, onOpen, position }: {
  text: string;
  collapsed: boolean;
  toggle: () => void;
  onOpen?: MouseEventHandler<HTMLButtonElement>;
  position?: number;
}) {
  const suppressClickUntilRef = useRef(0);
  const lastTouchActionAtRef = useRef(0);
  const touchRef = useRef<{ identifier: number; x: number; y: number; moved: boolean } | null>(null);
  return (
      <div className="blockquote-toolbar" data-pdf-exclude contentEditable={false}>
        <span>{blockquoteCaption(text, collapsed)}</span>
        <button type="button" className="block-workspace-open" title="放大阅读引用块" aria-label="放大阅读引用块"
          onMouseDown={event => event.preventDefault()}
          data-workspace-position={position} onClick={onOpen}><ToolbarIcon name="expand" /></button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onTouchStart={(event) => {
            const touch = event.changedTouches[0];
            if (!touch) return;
            touchRef.current = {
              identifier: touch.identifier,
              x: touch.clientX,
              y: touch.clientY,
              moved: false,
            };
          }}
          onTouchMove={(event) => {
            const gesture = touchRef.current;
            if (!gesture) return;
            const touch = Array.from(event.touches)
              .find((item) => item.identifier === gesture.identifier);
            if (!touch || Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) > 12) {
              gesture.moved = true;
            }
          }}
          onTouchCancel={() => { touchRef.current = null; }}
          onTouchEnd={(event) => {
            const gesture = touchRef.current;
            touchRef.current = null;
            if (!gesture || gesture.moved) return;
            const touch = Array.from(event.changedTouches)
              .find((item) => item.identifier === gesture.identifier);
            if (!touch || Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) > 12) return;
            const now = Date.now();
            if (now - lastTouchActionAtRef.current < 32) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            lastTouchActionAtRef.current = now;
            suppressClickUntilRef.current = now + 500;
            toggle();
          }}
          onPointerUp={(event) => {
            if (event.pointerType !== "touch") return;
            const gesture = touchRef.current;
            if (!gesture || gesture.moved || Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 12) return;
            event.preventDefault();
            event.stopPropagation();
            const now = Date.now();
            if (now - lastTouchActionAtRef.current < 32) return;
            lastTouchActionAtRef.current = now;
            suppressClickUntilRef.current = now + 500;
            toggle();
          }}
          onClick={() => {
            if (Date.now() < suppressClickUntilRef.current) return;
            toggle();
          }}
          aria-label={collapsed ? "展开引用块" : "折叠引用块"}
          aria-expanded={!collapsed}
          title={collapsed ? "展开引用块" : "折叠引用块"}
        ><span className="blockquote-fold-icon" aria-hidden="true"><EditorFoldIcon expanded={!collapsed} /></span></button>
      </div>
  );
}

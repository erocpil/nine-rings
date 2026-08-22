import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { createPortal } from "react-dom";

interface MobileActionSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  className?: string;
  dismissAnchor?: HTMLElement | null;
  children: ReactNode;
}

const TAP_SUPPRESSION_MS = 450;
const DRAG_CLOSE_DISTANCE = 72;

/**
 * Mobile-only modal action sheet.
 *
 * It lives outside toolbar stacking/overflow contexts, owns a real backdrop,
 * and suppresses the synthetic click that mobile Safari can emit after a
 * scroll or dismiss gesture.
 */
export function MobileActionSheet({ open, title, onClose, className = "", dismissAnchor, children }: MobileActionSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const touchMovedRef = useRef(false);
  const suppressClickUntilRef = useRef(0);
  const dragOffsetRef = useRef(0);
  const [dragOffset, setDragOffset] = useState(0);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown, true);
      returnFocusRef.current?.focus({ preventScroll: true });
    };
  }, [onClose, open]);

  if (!open) return null;

  const onTouchStartCapture = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) return;
    touchStartYRef.current = event.touches[0].clientY;
    touchMovedRef.current = false;
  };

  const onTouchMoveCapture = (event: TouchEvent<HTMLDivElement>) => {
    const startY = touchStartYRef.current;
    if (startY === null || event.touches.length !== 1) return;
    const deltaY = event.touches[0].clientY - startY;
    if (Math.abs(deltaY) > 8) touchMovedRef.current = true;
    if (deltaY > 0 && event.target instanceof Element && event.target.closest(".mobile-action-sheet-header")) {
      event.preventDefault();
      const nextOffset = Math.min(deltaY, 140);
      dragOffsetRef.current = nextOffset;
      setDragOffset(nextOffset);
    }
  };

  const onTouchEndCapture = () => {
    touchStartYRef.current = null;
    if (touchMovedRef.current) suppressClickUntilRef.current = Date.now() + TAP_SUPPRESSION_MS;
    if (dragOffsetRef.current >= DRAG_CLOSE_DISTANCE) {
      onClose();
      return;
    }
    dragOffsetRef.current = 0;
    setDragOffset(0);
  };

  const sheet = (
    <div
      className="mobile-action-sheet-layer"
      role="presentation"
      onClick={onClose}
    >
      <section
        className={`mobile-action-sheet ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ transform: `translateY(${dragOffset}px)` }}
        onClick={(event) => event.stopPropagation()}
        onClickCapture={(event) => {
          const anchorRect = dismissAnchor?.getBoundingClientRect();
          if (
            anchorRect
            && event.clientX >= anchorRect.left
            && event.clientX <= anchorRect.right
            && event.clientY >= anchorRect.top
            && event.clientY <= anchorRect.bottom
          ) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          if (Date.now() >= suppressClickUntilRef.current) return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onTouchStartCapture={onTouchStartCapture}
        onTouchMoveCapture={onTouchMoveCapture}
        onTouchEndCapture={onTouchEndCapture}
        onTouchCancelCapture={onTouchEndCapture}
      >
        <header className="mobile-action-sheet-header">
          <span className="mobile-action-sheet-handle" aria-hidden="true" />
          <strong>{title}</strong>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={`关闭${title}`}>×</button>
        </header>
        <div className="mobile-action-sheet-content">{children}</div>
      </section>
    </div>
  );

  return createPortal(sheet, document.body);
}

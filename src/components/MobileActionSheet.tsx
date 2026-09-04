import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { createPortal } from "react-dom";

interface MobileActionSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  className?: string;
  dismissAnchor?: HTMLElement | null;
  placementAnchor?: HTMLElement | null;
  placementGap?: number;
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
export function MobileActionSheet({
  open,
  title,
  onClose,
  className = "",
  dismissAnchor,
  placementAnchor,
  placementGap = 4,
  children,
}: MobileActionSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const touchStartYRef = useRef<number | null>(null);
  const touchMovedRef = useRef(false);
  const suppressClickUntilRef = useRef(0);
  const dragOffsetRef = useRef(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [anchorPlacement, setAnchorPlacement] = useState<{ top: number; maxHeight: number } | null>(null);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open || !placementAnchor) {
      setAnchorPlacement(null);
      return;
    }

    const updatePlacement = () => {
      const anchorRect = placementAnchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const appRect = placementAnchor.closest<HTMLElement>(".app")?.getBoundingClientRect();
      const viewportTop = appRect?.top ?? viewport?.offsetTop ?? 0;
      const viewportBottom = appRect?.bottom
        ?? viewportTop + (viewport?.height ?? window.innerHeight);
      const top = Math.max(viewportTop, anchorRect.bottom + placementGap);
      setAnchorPlacement({
        top: Math.round(top),
        maxHeight: Math.max(80, Math.floor(viewportBottom - top - 8)),
      });
    };

    updatePlacement();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updatePlacement);
    observer?.observe(placementAnchor);
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    window.visualViewport?.addEventListener("resize", updatePlacement);
    window.visualViewport?.addEventListener("scroll", updatePlacement);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
      window.visualViewport?.removeEventListener("resize", updatePlacement);
      window.visualViewport?.removeEventListener("scroll", updatePlacement);
    };
  }, [open, placementAnchor, placementGap]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown, true);
      const returnTarget = returnFocusRef.current;
      returnFocusRef.current = null;
      // An action can open another dialog or an inline editor while the sheet
      // unmounts. Preserve that newly assigned focus; only restore the trigger
      // after a passive dismissal whose focus fell back to the document.
      window.requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body && active !== document.documentElement) return;
        returnTarget?.focus({ preventScroll: true });
      });
    };
  }, [open]);

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
      className={`mobile-action-sheet-layer${placementAnchor ? " mobile-action-sheet-layer-anchored" : ""}`}
      role="presentation"
      onClick={onClose}
    >
      <section
        className={`mobile-action-sheet ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          transform: `translateY(${dragOffset}px)`,
          ...(placementAnchor
            ? anchorPlacement
              ? { marginTop: `${anchorPlacement.top}px`, maxHeight: `${anchorPlacement.maxHeight}px` }
              : { visibility: "hidden" }
            : {}),
        }}
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

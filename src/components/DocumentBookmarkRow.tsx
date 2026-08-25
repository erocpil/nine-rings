import { useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { DocumentBookmark } from "../types/models";

const ACTIONS_WIDTH = 104;
const SWIPE_DECISION_DISTANCE = 10;

interface Props {
  bookmark: DocumentBookmark;
  blockNumber: number;
  mobile: boolean;
  open: boolean;
  onOpenChange: (bookmarkId: string | null) => void;
  onJump: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

interface SwipeGesture {
  pointerId: number;
  startX: number;
  startY: number;
  startOffset: number;
  offset: number;
  axis: "pending" | "horizontal";
}

export function DocumentBookmarkRow({
  bookmark,
  blockNumber,
  mobile,
  open,
  onOpenChange,
  onJump,
  onEdit,
  onDelete,
}: Props) {
  const gestureRef = useRef<SwipeGesture | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const offset = dragOffset ?? (open ? -ACTIONS_WIDTH : 0);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!mobile || event.pointerType === "mouse" || event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".document-bookmark-actions")) return;
    if (!open) onOpenChange(null);
    const startOffset = open ? -ACTIONS_WIDTH : 0;
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset,
      offset: startOffset,
      axis: "pending",
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;

    if (gesture.axis === "pending") {
      if (Math.abs(deltaY) > SWIPE_DECISION_DISTANCE && Math.abs(deltaY) > Math.abs(deltaX)) {
        gestureRef.current = null;
        return;
      }
      if (Math.abs(deltaX) < SWIPE_DECISION_DISTANCE || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
      gesture.axis = "horizontal";
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic test events and older WebKit builds may not expose pointer capture.
      }
    }

    event.preventDefault();
    gesture.offset = Math.max(-ACTIONS_WIDTH, Math.min(0, gesture.startOffset + deltaX));
    setDragOffset(gesture.offset);
  };

  const finishSwipe = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    if (gesture.axis === "horizontal") {
      onOpenChange(!cancelled && gesture.offset <= -ACTIONS_WIDTH / 2 ? bookmark.id : null);
      suppressClickUntilRef.current = Date.now() + 350;
    }
    setDragOffset(null);
  };

  const label = bookmark.label || bookmark.preview;

  return (
    <div
      className={`document-bookmark-item${open ? " swipe-open" : ""}${dragOffset !== null ? " swiping" : ""}`}
      style={{ "--bookmark-swipe-offset": `${offset}px` } as CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => finishSwipe(event)}
      onPointerCancel={(event) => finishSwipe(event, true)}
    >
      <button
        className="document-bookmark-jump"
        type="button"
        onClick={() => {
          if (Date.now() < suppressClickUntilRef.current) return;
          if (open) {
            onOpenChange(null);
            return;
          }
          onJump();
        }}
        title={bookmark.preview}
      >
        <span className="document-bookmark-index" title={`第 ${blockNumber} 块`}>
          {blockNumber}
        </span>
        <span>{label}</span>
      </button>
      <span className="document-bookmark-actions">
        <button
          className="document-bookmark-action document-bookmark-edit"
          type="button"
          onFocus={() => onOpenChange(bookmark.id)}
          onClick={onEdit}
          title="重命名书签"
          aria-label={`重命名书签 ${label}`}
        >✎</button>
        <button
          className="document-bookmark-action document-bookmark-delete"
          type="button"
          onFocus={() => onOpenChange(bookmark.id)}
          onClick={onDelete}
          title="删除书签"
          aria-label={`删除书签 ${label}`}
        >×</button>
      </span>
    </div>
  );
}

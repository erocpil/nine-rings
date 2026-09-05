// 左右边缘共用原侧栏的判定标准，不限制手势时长或绝对纵向偏移。
export function isWithinSwipeEdge(distanceFromEdge: number): boolean {
  return distanceFromEdge >= 0 && distanceFromEdge < 30;
}

export function horizontalSwipeDirection(dx: number, dy: number): "left" | "right" | null {
  if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) <= 60) return null;
  return dx > 0 ? "right" : "left";
}

type SwipeAction = { direction: "left" | "right"; run: () => void };

/** 在第一个有位移的 touchmove 决定归属，不能等到 60px 才拦截原生滚动。 */
export function bindEdgeSwipe(
  host: HTMLElement | Window,
  resolve: (touch: Touch) => SwipeAction | null,
  options: { withinPanel?: boolean; swipeButtonSelector?: string } = {},
): () => void {
  let gesture: { id: number; x: number; y: number; locked: boolean; action: SwipeAction } | null = null;
  const cancel = () => { gesture = null; };
  const start = (raw: Event) => {
    cancel();
    const event = raw as TouchEvent;
    if (event.defaultPrevented || event.touches.length !== 1) return;
    const target = event.target;
    if (target instanceof Element) {
      if (target.closest("input, textarea, select, [role='slider'], .editor-menu")) return;
      if (!options.withinPanel && target.closest(".document-outline-panel, .document-bookmark-panel")) return;
      if (target.closest("button, a") && !(options.swipeButtonSelector && target.closest(options.swipeButtonSelector))) return;
      const selection = target.ownerDocument.getSelection();
      if (selection && !selection.isCollapsed) return;
    }
    const touch = event.touches[0];
    const action = resolve(touch);
    if (!action) return;
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, locked: false, action };
    // 右侧编辑器手势不再同时落入 App 的侧栏手势识别器。
    event.stopPropagation();
  };
  const move = (raw: Event) => {
    const event = raw as TouchEvent;
    const current = gesture;
    if (!current) return;
    const touch = Array.from(event.touches).find((item) => item.identifier === current.id);
    if (event.touches.length !== 1 || !touch || !event.cancelable || event.defaultPrevented) {
      cancel();
      return;
    }
    const dx = touch.clientX - current.x;
    const dy = touch.clientY - current.y;
    if (!current.locked) {
      if (dx === 0 && dy === 0) return;
      const forward = current.action.direction === "right" ? dx : -dx;
      if (forward <= 0 || Math.abs(dy) > Math.abs(dx)) {
        // 已交给纵向滚动（或反向手势），本次触摸不得再次抢回。
        cancel();
        return;
      }
      current.locked = true;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const end = (raw: Event) => {
    const event = raw as TouchEvent;
    const current = gesture;
    cancel();
    if (!current?.locked || event.touches.length !== 0 || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    if (touch.identifier !== current.id) return;
    // 横向锁定后即使手指上下漂移，也不再滚动正文或重新切换方向。
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    const dx = touch.clientX - current.x;
    if (horizontalSwipeDirection(dx, 0) === current.action.direction) current.action.run();
  };
  host.addEventListener("touchstart", start, { passive: true });
  host.addEventListener("touchmove", move, { passive: false });
  host.addEventListener("touchend", end, { passive: false });
  host.addEventListener("touchcancel", cancel, { passive: true });
  window.addEventListener("blur", cancel);
  return () => {
    cancel();
    host.removeEventListener("touchstart", start);
    host.removeEventListener("touchmove", move);
    host.removeEventListener("touchend", end);
    host.removeEventListener("touchcancel", cancel);
    window.removeEventListener("blur", cancel);
  };
}

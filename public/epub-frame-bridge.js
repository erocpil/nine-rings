(() => {
  "use strict";

  const MESSAGE_TYPE = "nine-rings:epub-frame";
  let touchStart = null;
  let pointerStart = null;
  let lastTouchStart = 0;
  let lastTouchEnd = 0;

  const post = (action) => {
    window.parent.postMessage({ type: MESSAGE_TYPE, action }, "*");
  };

  const hasSelection = () => {
    const selection = window.getSelection();
    return Boolean(selection && !selection.isCollapsed);
  };

  const finish = (start, x, y) => {
    if (!start || hasSelection()) return;
    const dx = x - start.x;
    const dy = y - start.y;
    const elapsed = Date.now() - start.time;
    if (elapsed <= 900 && Math.abs(dx) < 18 && Math.abs(dy) < 18) {
      post("tap");
      return;
    }
    if (elapsed > 900 || Math.abs(dx) < 52 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    post(dx < 0 ? "swipe-left" : "swipe-right");
  };

  document.addEventListener("touchstart", (event) => {
    lastTouchStart = Date.now();
    pointerStart = null;
    if (event.touches.length !== 1) {
      touchStart = null;
      return;
    }
    const touch = event.touches[0];
    touchStart = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, { passive: true, capture: true });

  document.addEventListener("touchmove", (event) => {
    if (!touchStart || event.touches.length !== 1 || Date.now() - touchStart.time > 900) return;
    const touch = event.touches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) event.preventDefault();
  }, { passive: false, capture: true });

  document.addEventListener("touchend", (event) => {
    const start = touchStart;
    touchStart = null;
    if (!start || event.changedTouches.length !== 1) return;
    lastTouchEnd = Date.now();
    const touch = event.changedTouches[0];
    finish(start, touch.clientX, touch.clientY);
  }, { passive: true, capture: true });

  document.addEventListener("touchcancel", () => {
    touchStart = null;
  }, { passive: true, capture: true });

  // 部分 Android WebView 只提供 Pointer Events；iOS 同时提供两套事件时，
  // touchend 后的时间门限会阻止同一次手势被处理两次。
  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    pointerStart = { x: event.clientX, y: event.clientY, time: Date.now() };
  }, { passive: true, capture: true });

  document.addEventListener("pointerup", (event) => {
    const start = pointerStart;
    pointerStart = null;
    if (!start || Date.now() - lastTouchStart < 1200 || Date.now() - lastTouchEnd < 120) return;
    finish(start, event.clientX, event.clientY);
  }, { passive: true, capture: true });

  document.addEventListener("pointercancel", () => {
    pointerStart = null;
  }, { passive: true, capture: true });

  document.addEventListener("click", () => {
    if (Date.now() - lastTouchEnd > 500 && !hasSelection()) post("tap");
  }, { passive: true, capture: true });

  const ready = () => post("ready");
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
  else ready();
  window.setTimeout(ready, 100);
  window.setTimeout(ready, 500);
})();

import { useEffect, useLayoutEffect, type RefObject } from "react";
import { addLog } from "../lib/debugLog";
import type { ReadingAnchor } from "../lib/readonly-rendering";
import { patchReadingState, readRenderedScrollTop } from "../lib/reading-state";
export const EDITOR_NAVIGATION_EVENT = "nr:editor-navigation";

interface Options {
  noteId: string;
  sensitive?: boolean;
  scrollRef: RefObject<HTMLElement>;
  scrollPositionRef: RefObject<HTMLElement>;
  rendererHandoffRef: RefObject<ReadingAnchor | undefined>;
  showStatusBar: boolean;
  isMobileToolbarViewport: boolean;
}

/** Own only persistent scroll/position status; renderer handoffs take priority. */
export function useEditorScrollPersistence({
  noteId,
  sensitive = false,
  scrollRef,
  scrollPositionRef,
  rendererHandoffRef,
  showStatusBar,
  isMobileToolbarViewport,
}: Options) {
  // 挂载时恢复滚动位置
  // 出处：SO #54195164 https://stackoverflow.com/questions/54195164
  // useLayoutEffect 在浏览器绘制前执行，比 useEffect 更早恢复位置
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (rendererHandoffRef.current) return;
    const saved = sensitive ? null : readRenderedScrollTop(noteId);
    addLog(`[加载] id=${noteId.slice(0, 8)} 恢复位置=${saved ?? "无"}`);
    if (saved === null) {
      return;
    }
    const scrollTop = Math.max(0, Number(saved) || 0);
    const startedAt = performance.now();
    const deadline = performance.now() + 10000;
    let frame = 0;
    let settledFrames = 0;
    let stopped = false;
    let observer: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    // Restoring is best-effort: stale positions and slow NodeViews must never
    // fight wheel/touch/scrollbar input while the document is opening.
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      mutationObserver?.disconnect();
      el.removeEventListener("wheel", stop);
      el.removeEventListener("touchstart", stop);
      el.removeEventListener("pointerdown", stop);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener(EDITOR_NAVIGATION_EVENT, stop);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      )
        stop();
    };
    el.addEventListener("wheel", stop, { passive: true });
    el.addEventListener("touchstart", stop, { passive: true });
    el.addEventListener("pointerdown", stop, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener(EDITOR_NAVIGATION_EVENT, stop);
    const restore = () => {
      if (stopped) return;
      const maximum = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = Math.min(scrollTop, maximum);
      const targetIsReachable = maximum >= scrollTop;
      const targetIsApplied = Math.abs(el.scrollTop - scrollTop) <= 1;
      settledFrames =
        targetIsReachable && targetIsApplied ? settledFrames + 1 : 0;
      const minimumRestoreWindowElapsed = performance.now() - startedAt >= 600;
      if (
        (settledFrames >= 4 && minimumRestoreWindowElapsed) ||
        performance.now() >= deadline
      ) {
        stop();
        return;
      }
      frame = requestAnimationFrame(restore);
    };
    observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (stopped) return;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(restore);
          })
        : null;
    observer?.observe(el);
    mutationObserver =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => {
            if (stopped) return;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(restore);
          })
        : null;
    mutationObserver?.observe(el, { childList: true, subtree: true });
    frame = requestAnimationFrame(restore);
    return stop;
  }, [noteId, sensitive, rendererHandoffRef, scrollRef]);

  // 滚动时保存位置 & 更新位置显示
  // 出处：TipTap #2342 https://github.com/ueberdosis/tiptap/issues/2342
  // cleanup 只写入滚动事件记录的位置，不读取销毁阶段可能已归零的 DOM。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let statusTimer = 0;
    let persistTimer = 0;
    let maximumScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    let lastKnownScrollTop = sensitive
      ? 0
      : (readRenderedScrollTop(noteId) ?? 0);
    const showLivePosition = showStatusBar && !isMobileToolbarViewport;
    const persistPosition = () => {
      if (sensitive) return;
      patchReadingState(noteId, {
        rendered: { scrollTop: lastKnownScrollTop },
      });
      try {
        localStorage.setItem(`scrollPos:${noteId}`, String(lastKnownScrollTop));
      } catch {
        /* best effort, like the unified reading-state record */
      }
    };
    const updateStatusPosition = () => {
      const percentage =
        maximumScroll > 0
          ? Math.max(
              0,
              Math.min(
                100,
                Math.round((lastKnownScrollTop / maximumScroll) * 100),
              ),
            )
          : 0;
      if (scrollPositionRef.current) {
        scrollPositionRef.current.textContent = `位置 ${percentage}%`;
      }
    };
    const scheduleStatusPosition = () => {
      if (!showLivePosition || statusTimer) return;
      // 状态文字无需 60Hz 更新；10Hz 足够跟手，并且这里完全复用缓存的
      // 可滚动高度，不在滚动热路径读取 scrollHeight 触发布局。
      statusTimer = window.setTimeout(() => {
        statusTimer = 0;
        updateStatusPosition();
      }, 100);
    };
    const refreshMaximumScroll = () => {
      maximumScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      if (showLivePosition) scheduleStatusPosition();
    };
    const flushPosition = () => {
      if (persistTimer) window.clearTimeout(persistTimer);
      persistTimer = 0;
      persistPosition();
    };
    const handler = () => {
      lastKnownScrollTop = el.scrollTop;
      scheduleStatusPosition();
      if (persistTimer) window.clearTimeout(persistTimer);
      persistTimer = window.setTimeout(flushPosition, 220);
    };
    const persistWhenHidden = () => {
      if (document.visibilityState === "hidden") flushPosition();
    };
    updateStatusPosition();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(refreshMaximumScroll);
    resizeObserver?.observe(el);
    const contentShell = el.querySelector<HTMLElement>(".editor-content-shell");
    if (contentShell) resizeObserver?.observe(contentShell);
    el.addEventListener("scroll", handler, { passive: true });
    window.addEventListener("pagehide", flushPosition);
    window.addEventListener("nine-rings:main-window-hide", flushPosition);
    document.addEventListener("visibilitychange", persistWhenHidden);
    return () => {
      el.removeEventListener("scroll", handler);
      window.removeEventListener("pagehide", flushPosition);
      window.removeEventListener("nine-rings:main-window-hide", flushPosition);
      document.removeEventListener("visibilitychange", persistWhenHidden);
      resizeObserver?.disconnect();
      // 快速切换可能早于 220ms 防抖；必须提交最后一次已捕获的位置。
      // 不从 DOM 重读，避免卸载时高度收缩把正确位置覆盖成零。
      if (persistTimer) flushPosition();
      addLog(`[离开] ${noteId.slice(0, 8)} 保存位置=${lastKnownScrollTop}`);
      if (statusTimer) window.clearTimeout(statusTimer);
    };
  }, [
    isMobileToolbarViewport,
    noteId,
    sensitive,
    showStatusBar,
    scrollPositionRef,
    scrollRef,
  ]);
}

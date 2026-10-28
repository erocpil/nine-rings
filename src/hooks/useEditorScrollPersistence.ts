import type { Editor } from "@tiptap/core";
import { captureRenderedReadingAnchor } from "../lib/editor-reading-position";
import { useDocumentActive } from "../components/RetainedDocument";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { addLog } from "../lib/debugLog";
import type { ReadingAnchor } from "../lib/readonly-rendering";
import { READING_POSITION_FLUSH_EVENT, patchReadingState, readReadingState, readRenderedScrollTop } from "../lib/reading-state";
import { restoreDocumentViewport, EDITOR_NAVIGATION_EVENT } from "../lib/document-reading-restoration";
export { EDITOR_NAVIGATION_EVENT };

interface Options {
  editor: Editor | null;
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
  editor,
  noteId,
  sensitive = false,
  scrollRef,
  scrollPositionRef,
  rendererHandoffRef,
  showStatusBar,
  isMobileToolbarViewport,
}: Options) {
  const active = useDocumentActive();
  const restoration = useRef({ pending: false });
  // 挂载时恢复滚动位置
  // 出处：SO #54195164 https://stackoverflow.com/questions/54195164
  // useLayoutEffect 在浏览器绘制前执行，比 useEffect 更早恢复位置
  useLayoutEffect(() => {
    if (!active) return;
    const state = { pending: false };
    restoration.current = state;
    const el = scrollRef.current;
    if (!el) return;
    if (rendererHandoffRef.current) return;
    const saved = sensitive ? null : readRenderedScrollTop(noteId);
    addLog(`[加载] id=${noteId.slice(0, 8)} 恢复位置=${saved ?? "无"}`);
    if (saved === null) {
      return;
    }
    state.pending = true;
    const savedAnchor = sensitive ? undefined : readReadingState(noteId).rendered?.anchor;
    return restoreDocumentViewport({ root: el, editor, scrollTop: Math.max(0, Number(saved) || 0), anchor: savedAnchor, onFinish: () => {
      state.pending = false;
      el.dispatchEvent(new Event("scroll"));
    } });
  }, [editor, noteId, sensitive, rendererHandoffRef, scrollRef, active]);

  // 滚动时保存位置 & 更新位置显示
  // 出处：TipTap #2342 https://github.com/ueberdosis/tiptap/issues/2342
  // cleanup 只写入滚动事件记录的位置，不读取销毁阶段可能已归零的 DOM。
  useEffect(() => {
    if (!active) return;
    const el = scrollRef.current;
    if (!el) return;
    const state = restoration.current;
    let statusTimer = 0;
    let persistTimer = 0;
    let maximumScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    let lastKnownScrollTop = sensitive
      ? 0
      : (readRenderedScrollTop(noteId) ?? 0);
    const showLivePosition = showStatusBar && !isMobileToolbarViewport;
    let lastAnchor = sensitive ? undefined : readReadingState(noteId).rendered?.anchor;
    const persistPosition = () => {
      if (sensitive) return;
      patchReadingState(noteId, {
        rendered: { scrollTop: lastKnownScrollTop, anchor: lastAnchor },
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
    const capturePosition = () => {
      if (state.pending || !el.isConnected || el.closest("[inert]") || !el.clientWidth || !el.clientHeight) return;
      lastKnownScrollTop = el.scrollTop;
      if (!sensitive && editor) lastAnchor = captureRenderedReadingAnchor(editor, el);
    };
    const flushPosition = () => {
      if (persistTimer) window.clearTimeout(persistTimer);
      persistTimer = 0;
      capturePosition();
      persistPosition();
    };
    const handler = () => {
      // Mounting may clamp the target while NodeViews are still taking shape.
      // Never replace the saved target with those intermediate positions.
      if (state.pending || !el.isConnected || el.closest("[inert]") || document.visibilityState === "hidden" || el.clientWidth === 0 || el.clientHeight === 0) return;
      lastKnownScrollTop = el.scrollTop;
      // A new pixel position must never be paired with an older text anchor.
      // Fast switches flush this pixel fallback before the idle capture runs.
      lastAnchor = undefined;
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
    window.addEventListener("beforeunload", flushPosition);
    window.addEventListener(READING_POSITION_FLUSH_EVENT, flushPosition);
    window.addEventListener("nine-rings:main-window-hide", flushPosition);
    document.addEventListener("visibilitychange", persistWhenHidden);
    return () => {
      el.removeEventListener("scroll", handler);
      window.removeEventListener("pagehide", flushPosition);
      window.removeEventListener("beforeunload", flushPosition);
      window.removeEventListener(READING_POSITION_FLUSH_EVENT, flushPosition);
      window.removeEventListener("nine-rings:main-window-hide", flushPosition);
      document.removeEventListener("visibilitychange", persistWhenHidden);
      resizeObserver?.disconnect();
      // 快速切换可能早于 220ms 防抖；必须提交最后一次已捕获的位置。
      // 不从 DOM 重读，避免卸载时高度收缩把正确位置覆盖成零。
      if (persistTimer) {
        window.clearTimeout(persistTimer);
        persistPosition();
      }
      addLog(`[离开] ${noteId.slice(0, 8)} 保存位置=${lastKnownScrollTop}`);
      if (statusTimer) window.clearTimeout(statusTimer);
    };
  }, [
    editor,
    active,
    isMobileToolbarViewport,
    noteId,
    sensitive,
    showStatusBar,
    scrollPositionRef,
    scrollRef,
  ]);
}

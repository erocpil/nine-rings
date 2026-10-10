/**
 * useAutoSave — 自动保存 Hook
 *
 * 职责：
 * - 接收内容变化，执行 debounce 后自动保存
 * - 管理保存状态（clean / dirty / saving / saved / error）
 * - 串行队列防止乱序覆盖
 * - 提供 flush 方法（失焦 / 切换笔记 / 关闭窗口时调用）
 *
 * 与版本策略的边界：
 * - 本 hook 只做自动保存，不创建版本快照。
 * - 版本 checkpoint 由调用方在切换笔记 / 显式保存时单独触发。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { DeltaOps } from "../types/models";

import { AutoSaveQueue } from "../lib/auto-save-queue";
import type {
  AutoSaveChanges,
  PendingAutoSaveChanges,
  SaveStatus,
} from "../lib/auto-save-queue";
export { materializeAutoSaveChanges } from "../lib/auto-save-queue";
export type { AutoSaveChanges, SaveStatus } from "../lib/auto-save-queue";

export interface AutoSaveHandle {
  /** 当前保存状态 */
  status: SaveStatus;
  /** 通知内容已变化（自动触发 debounce 保存） */
  markDirty: (content: DeltaOps) => void;
  /** 延迟读取最新内容；只在真正保存或紧急导出时执行昂贵的全文序列化。 */
  markContentDirty: (readContent: () => DeltaOps, batch?: object) => void;
  /** 通知标题已变化 */
  markTitleDirty: (title: string) => void;
  /** 通知标签已变化 */
  markTagsDirty: (tags: string[]) => void;
  /** 等待所有文档的待保存数据（不等待 debounce）；写入失败会拒绝。 */
  flush: () => Promise<void>;
  /** 设置 noteId（切换笔记时调用，自动 flush 旧笔记） */
  setNoteId: (id: string | null) => Promise<void>;
  /** 返回当前笔记尚未持久化的变更，供紧急备份合并。 */
  getPendingData: () => { noteId: string; changes: AutoSaveChanges } | null;
  /** 放弃当前笔记尚未持久化的变更（仅用于用户确认载入外部版本）。 */
  discardPending: () => void;
}

interface Props {
  /** 保存回调：接收 noteId 和变更数据 */
  onSave: (noteId: string, data: AutoSaveChanges) => Promise<void>;
  /** debounce 毫秒数（默认 600） */
  debounceMs?: number;
}

export function useAutoSave({
  onSave,
  debounceMs = 600,
}: Props): AutoSaveHandle {
  const [status, setStatus] = useState<SaveStatus>("clean");
  const noteIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const queueRef = useRef<AutoSaveQueue | null>(null);
  if (!queueRef.current) {
    queueRef.current = new AutoSaveQueue(
      (id, data) => onSaveRef.current(id, data),
      () => setStatus(queueRef.current!.status(noteIdRef.current)),
    );
  }
  const queue = queueRef.current;

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const setNoteId = useCallback(
    (id: string | null): Promise<void> => {
      const oldId = noteIdRef.current;
      if (oldId === id) return Promise.resolve();
      clearTimer();
      // Freeze the outgoing editor before synchronously changing the active id.
      const pending = oldId ? queue.flushNote(oldId) : Promise.resolve();
      noteIdRef.current = id;
      setStatus(queue.status(id));
      return pending;
    },
    [clearTimer, queue],
  );

  const mark = useCallback(
    <K extends keyof PendingAutoSaveChanges>(
      key: K,
      value: PendingAutoSaveChanges[K],
      batch?: object,
    ) => {
      const id = noteIdRef.current;
      if (!id) return;
      queue.mark(id, key, value, batch);
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void queue.flushNote(id).catch((error) => {
          console.error("[useAutoSave] 保存失败:", error);
        });
      }, debounceMs);
    },
    [clearTimer, debounceMs, queue],
  );

  const markDirty = useCallback(
    (content: DeltaOps) => mark("content", content),
    [mark],
  );
  const markContentDirty = useCallback(
    (reader: () => DeltaOps, batch?: object) => mark("content", reader, batch),
    [mark],
  );
  const markTitleDirty = useCallback(
    (title: string) => mark("title", title),
    [mark],
  );
  const markTagsDirty = useCallback(
    (tags: string[]) => mark("tags", tags),
    [mark],
  );
  const flush = useCallback(() => {
    clearTimer();
    return queue.flushAll();
  }, [clearTimer, queue]);
  const getPendingData = useCallback(() => {
    const noteId = noteIdRef.current;
    if (!noteId) return null;
    const changes = queue.pending(noteId);
    return changes ? { noteId, changes } : null;
  }, [queue]);
  const discardPending = useCallback(() => {
    clearTimer();
    if (noteIdRef.current) queue.discard(noteIdRef.current);
  }, [clearTimer, queue]);

  useEffect(() => {
    const onHide = () => {
      void flush().catch((error) => {
        console.error("[useAutoSave] 页面离开前保存失败:", error);
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onHide);
      clearTimer();
    };
  }, [clearTimer, flush]);

  return {
    status,
    markDirty,
    markContentDirty,
    markTitleDirty,
    markTagsDirty,
    flush,
    setNoteId,
    getPendingData,
    discardPending,
  };
}

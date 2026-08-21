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

export type SaveStatus = "clean" | "dirty" | "saving" | "saved" | "error";

export interface AutoSaveHandle {
  /** 当前保存状态 */
  status: SaveStatus;
  /** 通知内容已变化（自动触发 debounce 保存） */
  markDirty: (content: any) => void;
  /** 通知标题已变化 */
  markTitleDirty: (title: string) => void;
  /** 通知标签已变化 */
  markTagsDirty: (tags: string[]) => void;
  /** 立即 flush 当前脏数据（不等待 debounce） */
  flush: () => Promise<void>;
  /** 设置 noteId（切换笔记时调用，自动 flush 旧笔记） */
  setNoteId: (id: string | null) => Promise<void>;
  /** 返回当前笔记尚未持久化的变更，供紧急备份合并。 */
  getPendingData: () => { noteId: string; changes: Record<string, any> } | null;
}

interface Props {
  /** 保存回调：接收 noteId 和变更数据 */
  onSave: (noteId: string, data: Record<string, any>) => Promise<void>;
  /** debounce 毫秒数（默认 600） */
  debounceMs?: number;
}

export function useAutoSave({ onSave, debounceMs = 600 }: Props): AutoSaveHandle {
  const [status, setStatus] = useState<SaveStatus>("clean");
  const [, setNoteIdState] = useState<string | null>(null);

  // 每个笔记的脏数据
  const dirtyRef = useRef<Map<string, Record<string, any>>>(new Map());
  // 串行保存队列
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  // debounce timer
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 保存回调引用
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  // noteId 引用（setState 异步，ref 同步）
  const noteIdRef = useRef<string | null>(null);

  const setNoteId = useCallback((id: string | null): Promise<void> => {
    const oldId = noteIdRef.current;
    if (oldId === id) {
      return Promise.resolve();
    }

    // 旧笔记按 id 入队后立即同步切换 ref，确保后续新编辑不会记到旧笔记。
    const pending =
      oldId && dirtyRef.current.has(oldId) ? flushNote(oldId) : queueRef.current;
    noteIdRef.current = id;
    setNoteIdState(id);
    setStatus("clean");
    return pending;
  }, []);

  // 标记脏数据 + 触发 debounce
  const markDirtyRaw = useCallback((noteId: string, key: string, value: any) => {
    const current = dirtyRef.current.get(noteId) ?? {};
    current[key] = value;
    dirtyRef.current.set(noteId, current);
    setStatus("dirty");

    // 清除旧 timer
    if (timerRef.current) clearTimeout(timerRef.current);

    // 设置新 debounce
    timerRef.current = setTimeout(() => {
      void flushNote(noteId).catch(() => {
        // flushNote 已恢复脏数据并更新状态；定时器回调不能产生未处理 rejection。
      });
    }, debounceMs);
  }, [debounceMs]);

  const markDirty = useCallback((content: any) => {
    if (noteIdRef.current) markDirtyRaw(noteIdRef.current, "content", content);
  }, [markDirtyRaw]);

  const markTitleDirty = useCallback((title: string) => {
    if (noteIdRef.current) markDirtyRaw(noteIdRef.current, "title", title);
  }, [markDirtyRaw]);

  const markTagsDirty = useCallback((tags: string[]) => {
    if (noteIdRef.current) markDirtyRaw(noteIdRef.current, "tags", tags);
  }, [markDirtyRaw]);

  // 串行 flush 一个笔记的所有脏数据
  const flushNote = useCallback((id: string): Promise<void> => {
    const dirty = dirtyRef.current.get(id);
    if (!dirty) return queueRef.current;

    // 清除该笔记的脏数据
    dirtyRef.current.delete(id);

    // 清除 timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // 加入串行队列
    setStatus("saving");
    const savePromise = queueRef.current.then(async () => {
      try {
        await onSaveRef.current(id, dirty);
        if (noteIdRef.current === id) {
          setStatus("saved");
        }
      } catch (e) {
        // 保存失败：恢复脏数据（用户新输入优先于本次失败批次）
        const existing = dirtyRef.current.get(id) ?? {};
        dirtyRef.current.set(id, { ...dirty, ...existing });
        if (noteIdRef.current === id) {
          setStatus("error");
        }
        console.error("[useAutoSave] 保存失败:", e);
        throw e;
      }
    });

    // 队列本身吞掉 rejection 以便后续任务继续；调用方仍拿到 savePromise 的失败。
    queueRef.current = savePromise.catch(() => {});
    return savePromise;
  }, []);

  const flush = useCallback(async () => {
    if (noteIdRef.current) {
      await flushNote(noteIdRef.current);
      return;
    }
    await queueRef.current;
  }, [flushNote]);

  const getPendingData = useCallback(() => {
    const noteId = noteIdRef.current;
    if (!noteId) return null;
    const changes = dirtyRef.current.get(noteId);
    return changes ? { noteId, changes: { ...changes } } : null;
  }, []);

  // 页面隐藏 / 卸载时 flush
  useEffect(() => {
    const onHide = () => {
      if (noteIdRef.current && dirtyRef.current.has(noteIdRef.current)) {
        void flushNote(noteIdRef.current).catch(() => {
          // beforeunload/visibilitychange 无法阻塞等待；错误状态已由 flushNote 记录。
        });
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onHide);
    };
  }, [flushNote]);

  return {
    status,
    markDirty,
    markTitleDirty,
    markTagsDirty,
    flush,
    setNoteId,
    getPendingData,
  };
}

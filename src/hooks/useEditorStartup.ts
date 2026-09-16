import { useEffect, useRef, useState, type RefObject } from "react";
import type { Note } from "../types/models";
import { api } from "../lib/api";
import { isDelta } from "../lib/delta-converter";
import { deltaToProseMirrorAsync } from "../lib/data-transform-client";
import {
  cacheEditorDocument,
  getCachedEditorDocument,
} from "../lib/editor-session-cache";
import { readRecentNoteIds } from "../lib/quick-switcher";

interface EditorStartupOptions {
  selectedNoteId: string | null;
  selectedNoteRef: RefObject<Note>;
  startupRestoreComplete: boolean;
  startupDateLoadPending: boolean;
  currentDate: string;
  setDate: (date: string) => Promise<void>;
}

async function prepareEditorDocument(note: Note): Promise<void> {
  if (
    !isDelta(note.content) ||
    getCachedEditorDocument(note.id, note.updated_at)
  )
    return;
  const document = await deltaToProseMirrorAsync(note.content);
  cacheEditorDocument(note.id, note.updated_at, document);
}

/** Stage document preparation, sidebar hydration and idle warming without creating an EditorView. */
export function useEditorStartup({
  selectedNoteId,
  selectedNoteRef,
  startupRestoreComplete,
  startupDateLoadPending,
  currentDate,
  setDate,
}: EditorStartupOptions) {
  // 恢复 GitHub 大备份时，最后打开的文档可能很大。先提交应用框架和加载提示，
  // 下一帧再构造 TipTap，避免同步的 Delta → ProseMirror 转换让窗口一直保持白屏。
  const [editorReadyNoteId, setEditorReadyNoteId] = useState<string | null>(
    null,
  );
  const [secondaryUiReady, setSecondaryUiReady] = useState(false);
  const startupDateHydrationStartedRef = useRef(false);
  useEffect(() => {
    setEditorReadyNoteId(null);
    if (!selectedNoteId || !startupRestoreComplete) return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      const note = selectedNoteRef.current;
      if (!note || note.id !== selectedNoteId) return;
      void prepareEditorDocument(note)
        .catch((error) => {
          // Worker 不可用时 NoteEditor 仍可沿用同步转换路径，不能阻塞打开。
          console.warn("[Editor] 后台准备文档失败，回退到同步转换:", error);
        })
        .finally(() => {
          if (!cancelled && selectedNoteRef.current?.id === selectedNoteId) {
            setEditorReadyNoteId(selectedNoteId);
          }
        });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [selectedNoteId, selectedNoteRef, startupRestoreComplete]);

  // 编辑器完成首次提交后再加载完整侧栏树。即使备份包含大量文档，应用外壳和
  // 最后文档也已经可见，后台树加载不会继续表现为启动白屏。
  useEffect(() => {
    if (!startupRestoreComplete) return;
    if (selectedNoteId && editorReadyNoteId !== selectedNoteId) return;
    const timer = window.setTimeout(() => {
      setSecondaryUiReady(true);
      if (startupDateLoadPending && !startupDateHydrationStartedRef.current) {
        startupDateHydrationStartedRef.current = true;
        void setDate(currentDate);
      }
    }, 100);
    return () => window.clearTimeout(timer);
  }, [
    currentDate,
    editorReadyNoteId,
    selectedNoteId,
    setDate,
    startupDateLoadPending,
    startupRestoreComplete,
  ]);

  // 当前编辑器和次级界面稳定后，在浏览器空闲期预处理最近访问的另一篇
  // 文档。仅保留两份纯 JSON，不驻留额外 TipTap/DOM，适合内存受限的 iOS。
  useEffect(() => {
    if (
      !secondaryUiReady ||
      !selectedNoteId ||
      editorReadyNoteId !== selectedNoteId
    )
      return;
    const candidateId = readRecentNoteIds().find((id) => id !== selectedNoteId);
    if (!candidateId) return;
    let cancelled = false;
    const warm = () => {
      void api.notes
        .get(candidateId)
        .then(async (note) => {
          if (!note || cancelled) return;
          await prepareEditorDocument(note);
        })
        .catch((error) => console.warn("[Editor] 空闲预处理失败:", error));
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let timer: number | undefined;
    let idle: number | undefined;
    if (idleWindow.requestIdleCallback) {
      idle = idleWindow.requestIdleCallback(warm, { timeout: 1800 });
    } else {
      timer = window.setTimeout(warm, 600);
    }
    return () => {
      cancelled = true;
      if (idle !== undefined) idleWindow.cancelIdleCallback?.(idle);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [editorReadyNoteId, secondaryUiReady, selectedNoteId]);

  return { editorReadyNoteId, secondaryUiReady };
}

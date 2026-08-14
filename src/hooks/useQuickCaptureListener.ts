import { useEffect, useRef } from "react";
import { isTauriRuntime } from "../lib/runtime";
import { localDateKey } from "../lib/local-date";
import { addLog } from "../lib/debugLog";
import {
  createTauriQuickCaptureListener,
  createBroadcastQuickCaptureListener,
  type BroadcastChannelCtor,
} from "../lib/quick-capture";

export interface QuickCaptureListenerOptions {
  setDate: (date: string) => Promise<void>;
}

/**
 * 监听 Quick Capture 提交事件，收到后切到当日。
 * - Tauri：监听 Rust 端 emit_to_main 的 quick-capture-created 事件。
 * - Web：监听 BroadcastChannel("nine-rings-qc") 跨标签页通知。
 *
 * 通过 ref 读取最新 setDate，避免闭包旧值；effect 仅挂载一次。
 */
export function useQuickCaptureListener({ setDate }: QuickCaptureListenerOptions): void {
  const setDateRef = useRef(setDate);
  setDateRef.current = setDate;

  useEffect(() => {
    const onMessage = () => {
      addLog("[QC→主窗口] 收到 Quick Capture 提交，切到当日");
      void setDateRef.current(localDateKey());
    };

    if (isTauriRuntime()) {
      const listener = createTauriQuickCaptureListener((event, handler) =>
        import("@tauri-apps/api/event").then(({ listen }) => listen(event, handler)),
      );
      return listener.start(onMessage);
    }

    try {
      const listener = createBroadcastQuickCaptureListener(
        BroadcastChannel as unknown as BroadcastChannelCtor,
      );
      return listener.start(onMessage);
    } catch (e) {
      console.warn("[QC→主窗口] BroadcastChannel 不可用:", e);
      return () => {};
    }
  }, []);
}

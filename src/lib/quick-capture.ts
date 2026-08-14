// ── Quick Capture 跨窗口通知：监听器工厂（可注入依赖，便于单测）──

/** Tauri 端跨窗口事件名 */
export const QUICK_CAPTURE_EVENT = "quick-capture-created";
/** Web 端 BroadcastChannel 通道名 */
export const QUICK_CAPTURE_CHANNEL = "nine-rings-qc";

/** Tauri listen 的最小签名（真实实现来自 @tauri-apps/api/event） */
export interface ListenFn {
  (event: string, handler: (event: unknown) => void): Promise<() => void>;
}

/** BroadcastChannel 的最小接口（避免依赖 DOM 类型） */
export interface BroadcastChannelLike {
  onmessage: ((event: unknown) => void) | null;
  close(): void;
}

export interface BroadcastChannelCtor {
  new (name: string): BroadcastChannelLike;
}

/**
 * 创建 Tauri 事件监听器。
 * start(onMessage) 注册监听并返回清理函数（unlisten）。
 * onError 在 listen 注册失败（reject）时调用，用于诊断。
 */
export function createTauriQuickCaptureListener(
  listen: ListenFn,
  onError?: (e: unknown) => void,
) {
  return {
    start(onMessage: () => void): () => void {
      let unlisten: (() => void) | undefined;
      let stopped = false;
      listen(QUICK_CAPTURE_EVENT, () => onMessage())
        .then((fn) => {
          unlisten = fn;
          // 注册完成前已被清理：立即注销，避免遗留监听器（StrictMode 双挂载）
          if (stopped) fn();
        })
        .catch((e) => {
          onError?.(e);
        });
      return () => {
        stopped = true;
        unlisten?.();
      };
    },
  };
}

/**
 * 创建 BroadcastChannel 监听器。
 * start(onMessage) 注册 onmessage 并返回清理函数（close）。
 */
export function createBroadcastQuickCaptureListener(Ctor: BroadcastChannelCtor) {
  return {
    start(onMessage: () => void): () => void {
      const bc = new Ctor(QUICK_CAPTURE_CHANNEL);
      bc.onmessage = () => onMessage();
      return () => bc.close();
    },
  };
}

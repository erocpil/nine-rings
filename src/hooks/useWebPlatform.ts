import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriRuntime } from "../lib/runtime";
import { watchPwaUpdates, type PwaUpdateStatus } from "../lib/pwa-updates";

export interface WebStorageStatus {
  supported: boolean;
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

type ViewportStatus = {
  viewportHeight: number;
  viewportWidth: number;
  keyboardHeight: number;
  viewportBottomInset: number;
  offsetTop: number;
  offsetLeft: number;
};

const EMPTY_STORAGE_STATUS: WebStorageStatus = {
  supported: false,
  persisted: null,
  usage: null,
  quota: null,
};

export async function inspectWebStorage(
  storage: StorageManager | undefined = typeof navigator === "undefined" ? undefined : navigator.storage,
): Promise<WebStorageStatus> {
  if (!storage) return EMPTY_STORAGE_STATUS;
  const [persisted, estimate]: [boolean | null, StorageEstimate] = await Promise.all([
    storage.persisted?.().catch(() => false) ?? Promise.resolve(null),
    storage.estimate?.().catch((): StorageEstimate => ({})) ?? Promise.resolve({}),
  ]);
  return {
    supported: true,
    persisted,
    usage: typeof estimate.usage === "number" ? estimate.usage : null,
    quota: typeof estimate.quota === "number" ? estimate.quota : null,
  };
}

export function storagePressure(status: WebStorageStatus): number | null {
  if (status.usage === null || status.quota === null || status.quota <= 0) return null;
  return status.usage / status.quota;
}

function clearKeyboardViewportSize() {
  // 清除行内覆盖，恢复 :root 的 100dvh / 100vw；左右抽屉也共用这两个变量。
  const style = document.documentElement.style;
  style.removeProperty("--app-viewport-height");
  style.removeProperty("--app-viewport-width");
}

function syncViewportCSS() {
  const viewport = typeof window.visualViewport === "undefined" ? null : window.visualViewport;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const activeElement = document.activeElement;
  const acceptsKeyboard = activeElement instanceof HTMLElement && (
    activeElement.isContentEditable
    || (activeElement instanceof HTMLTextAreaElement && !activeElement.readOnly && !activeElement.disabled)
    || (activeElement instanceof HTMLInputElement && !activeElement.readOnly && !activeElement.disabled
      && /^(text|search|email|url|tel|password|number)$/.test(activeElement.type))
  );
  // iOS 旋转时 visualViewport 会短暂保留上一方向的宽度。此时高度差
  // 不是软键盘，若误判会把应用外壳锁成旧尺寸，露出大块页面背景。
  // 宽度可能先恢复、而高度仍停在横屏值；仅比较宽度会把只读浏览误判为键盘。
  const orientationSettling = Math.abs(viewportWidth - window.innerWidth) >= 24;
  const useKeyboardViewport = acceptsKeyboard && !orientationSettling;
  const offsetTop = useKeyboardViewport ? (viewport?.offsetTop ?? 0) : 0;
  const offsetLeft = useKeyboardViewport ? (viewport?.offsetLeft ?? 0) : 0;
  const keyboardHeight = !useKeyboardViewport ? 0 : Math.max(
    0,
    Math.round(window.innerHeight - Math.min(viewportHeight, window.innerHeight)),
  );
  // Fixed-position overlays are laid out against the layout viewport on iOS.
  // This is the exact hidden area below the visual viewport; unlike keyboardHeight,
  // it also accounts for Safari panning the visual viewport upward.
  const viewportBottomInset = !useKeyboardViewport ? 0 : Math.max(
    0,
    Math.round(window.innerHeight - Math.min(offsetTop + viewportHeight, window.innerHeight)),
  );
  const status: ViewportStatus = {
    viewportHeight: Math.max(1, Math.round(viewportHeight)),
    viewportWidth: Math.max(1, Math.round(viewportWidth)),
    keyboardHeight,
    viewportBottomInset,
    offsetTop: Math.max(0, Math.round(offsetTop)),
    offsetLeft: Math.max(0, Math.round(offsetLeft)),
  };

  const root = document.documentElement;
  const setPixels = (name: string, value: number) => {
    const pixels = `${value}px`;
    if (root.style.getPropertyValue(name) !== pixels) root.style.setProperty(name, pixels);
  };
  const keyboardOpen = status.keyboardHeight >= 80 || status.offsetTop >= 80;
  // 宽高变量只服务于软键盘布局。普通浏览/旋转时继续写根变量会让长文档
  // 整棵样式树失效，而应用外壳已经由 CSS 动态视口即时覆盖。
  if (keyboardOpen) {
    setPixels("--app-viewport-height", status.viewportHeight);
    setPixels("--app-viewport-width", status.viewportWidth);
  } else {
    // 只停止写入会留下上一次键盘打开时的像素高度：应用外壳已恢复，
    // 抽屉和遮罩却仍被截成半屏。关闭时交还 CSS，避免持续写入触发重排。
    clearKeyboardViewportSize();
  }
  setPixels("--app-keyboard-height", status.keyboardHeight);
  setPixels("--app-visual-viewport-bottom-inset", status.viewportBottomInset);
  setPixels("--app-visual-viewport-offset-top", status.offsetTop);
  setPixels("--app-visual-viewport-offset-left", status.offsetLeft);
  root.classList.toggle("web-keyboard-open", keyboardOpen);
}

export function useWebPlatform() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [updateStatus, setUpdateStatus] = useState<PwaUpdateStatus>({
    checking: false,
    available: false,
    checked: false,
    error: null,
    errorDetails: null,
  });
  const [storage, setStorage] = useState<WebStorageStatus>(EMPTY_STORAGE_STATUS);
  const updaterRef = useRef<ReturnType<typeof watchPwaUpdates> | null>(null);

  useEffect(() => {
    if (isTauriRuntime()) return;

    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);

    syncViewportCSS();
    let animationFrameId = 0;
    const scheduleViewportSync = () => {
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
      animationFrameId = window.requestAnimationFrame(syncViewportCSS);
    };
    const syncAfterOrientation = () => {
      // 旋转开始便退出键盘布局；应用外壳由 CSS 视口立即接管。随后一次
      // rAF 及真实 resize 事件只更新键盘/偏移信息，不再连续强制重排。
      document.documentElement.classList.remove("web-keyboard-open");
      clearKeyboardViewportSize();
      scheduleViewportSync();
    };
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", scheduleViewportSync);
    viewport?.addEventListener("scroll", scheduleViewportSync);
    window.addEventListener("resize", scheduleViewportSync);
    window.addEventListener("orientationchange", syncAfterOrientation);
    document.addEventListener("focusin", scheduleViewportSync);
    document.addEventListener("focusout", scheduleViewportSync);

    let cancelled = false;
    const prepareStorage = async () => {
      if (!navigator.storage) return;
      let status = await inspectWebStorage();
      if (!status.persisted && navigator.storage.persist) {
        await navigator.storage.persist().catch(() => false);
        status = await inspectWebStorage();
      }
      if (!cancelled) setStorage(status);
    };
    void prepareStorage();

    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      updaterRef.current = watchPwaUpdates(setUpdateStatus);
    }

    return () => {
      cancelled = true;
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
      viewport?.removeEventListener("resize", scheduleViewportSync);
      viewport?.removeEventListener("scroll", scheduleViewportSync);
      window.removeEventListener("resize", scheduleViewportSync);
      window.removeEventListener("orientationchange", syncAfterOrientation);
      document.removeEventListener("focusin", scheduleViewportSync);
      document.removeEventListener("focusout", scheduleViewportSync);
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
      updaterRef.current?.dispose();
      updaterRef.current = null;
    };
  }, []);

  const applyUpdate = useCallback(async () => {
    if (!updaterRef.current) throw new Error("当前环境不支持 PWA 更新");
    await updaterRef.current.apply();
  }, []);
  const checkUpdate = useCallback(async () => {
    if (!updaterRef.current) throw new Error("请在已部署的 HTTPS 应用中检查更新");
    await updaterRef.current.check();
  }, []);

  return { online, updateAvailable: updateStatus.available, updateStatus, checkUpdate, storage, storagePressure: storagePressure(storage), applyUpdate };
}

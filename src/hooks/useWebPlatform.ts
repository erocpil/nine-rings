import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriRuntime } from "../lib/runtime";

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

function syncViewportCSS() {
  const viewport = typeof window.visualViewport === "undefined" ? null : window.visualViewport;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const offsetTop = viewport?.offsetTop ?? 0;
  const offsetLeft = viewport?.offsetLeft ?? 0;
  const keyboardHeight = Math.max(
    0,
    Math.round(window.innerHeight - Math.min(viewportHeight, window.innerHeight)),
  );
  const status: ViewportStatus = {
    viewportHeight: Math.max(1, Math.round(viewportHeight)),
    viewportWidth: Math.max(1, Math.round(viewportWidth)),
    keyboardHeight,
    offsetTop: Math.max(0, Math.round(offsetTop)),
    offsetLeft: Math.max(0, Math.round(offsetLeft)),
  };

  const root = document.documentElement;
  root.style.setProperty("--app-viewport-height", `${status.viewportHeight}px`);
  root.style.setProperty("--app-viewport-width", `${status.viewportWidth}px`);
  root.style.setProperty("--app-keyboard-height", `${status.keyboardHeight}px`);
  root.style.setProperty("--app-visual-viewport-offset-top", `${status.offsetTop}px`);
  root.style.setProperty("--app-visual-viewport-offset-left", `${status.offsetLeft}px`);
  root.classList.toggle("web-keyboard-open", status.keyboardHeight >= 80 || status.offsetTop >= 80);
}

export function useWebPlatform() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [storage, setStorage] = useState<WebStorageStatus>(EMPTY_STORAGE_STATUS);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const reloadForUpdateRef = useRef(false);

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
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", scheduleViewportSync);
    viewport?.addEventListener("scroll", scheduleViewportSync);
    window.addEventListener("resize", scheduleViewportSync);
    window.addEventListener("orientationchange", scheduleViewportSync);

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

    let removeControllerListener: (() => void) | undefined;
    let visibilityListener: (() => void) | undefined;
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      const onControllerChange = () => {
        if (reloadForUpdateRef.current) window.location.reload();
      };
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
      removeControllerListener = () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);

      navigator.serviceWorker.register("/sw.js").then((registration) => {
        if (cancelled) return;
        registrationRef.current = registration;
        if (registration.waiting) setUpdateAvailable(true);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              setUpdateAvailable(true);
            }
          });
        });
        const checkWhenVisible = () => {
          if (document.visibilityState === "visible") void registration.update();
        };
        document.addEventListener("visibilitychange", checkWhenVisible);
        visibilityListener = () => document.removeEventListener("visibilitychange", checkWhenVisible);
      }).catch((error) => {
        console.warn("[PWA] Service Worker 注册失败，不影响本地编辑:", error);
      });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
      viewport?.removeEventListener("resize", scheduleViewportSync);
      viewport?.removeEventListener("scroll", scheduleViewportSync);
      window.removeEventListener("resize", scheduleViewportSync);
      window.removeEventListener("orientationchange", scheduleViewportSync);
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
      removeControllerListener?.();
      visibilityListener?.();
    };
  }, []);

  const applyUpdate = useCallback(async () => {
    const registration = registrationRef.current;
    if (!registration) return;
    reloadForUpdateRef.current = true;
    if (!registration.waiting) await registration.update();
    registration.waiting?.postMessage({ type: "SKIP_WAITING" });
  }, []);

  return { online, updateAvailable, storage, storagePressure: storagePressure(storage), applyUpdate };
}

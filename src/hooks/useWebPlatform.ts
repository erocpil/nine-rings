import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriRuntime } from "../lib/runtime";

export interface WebStorageStatus {
  supported: boolean;
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

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

export function useWebPlatform() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [storage, setStorage] = useState<WebStorageStatus>(EMPTY_STORAGE_STATUS);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const reloadForUpdateRef = useRef(false);

  useEffect(() => {
    if (isTauriRuntime()) return;

    const refreshOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", refreshOnline);
    window.addEventListener("offline", refreshOnline);

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
      window.removeEventListener("online", refreshOnline);
      window.removeEventListener("offline", refreshOnline);
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

import { withTimeout } from "./async";

export interface PwaUpdateStatus {
  checking: boolean;
  available: boolean;
  checked: boolean;
  error: string | null;
}

const UPDATE_TIMEOUT = 60_000;
const CHECK_INTERVAL = 5 * 60_000;

/** Observe both an existing installer and future updatefound events. update()
 * resolves before installation finishes, so it is not an activation barrier. */
export function watchPwaUpdates(onStatus: (status: PwaUpdateStatus) => void) {
  let status: PwaUpdateStatus = { checking: false, available: false, checked: false, error: null };
  let disposed = false;
  let registration: ServiceWorkerRegistration | undefined;
  let initialController = navigator.serviceWorker.controller;
  let controllerChanged = false;
  let trackedInstaller: ServiceWorker | null = null;
  let lastCheck = -Infinity;
  let checking: Promise<void> | undefined;
  const cleanups = new Set<() => void>();
  const watched = new Set<ServiceWorker>();
  const publish = (patch: Partial<PwaUpdateStatus>) => {
    status = { ...status, ...patch };
    if (!disposed) onStatus(status);
  };
  const listen = (target: EventTarget, event: string, callback: () => void) => {
    target.addEventListener(event, callback);
    cleanups.add(() => target.removeEventListener(event, callback));
  };
  const reconcile = () => {
    publish({ available: controllerChanged || Boolean(registration?.waiting) });
  };
  const watchInstaller = () => {
    const worker = registration?.installing;
    if (!worker || watched.has(worker)) return;
    watched.add(worker);
    listen(worker, "statechange", () => {
      reconcile();
      if (worker === trackedInstaller && worker.state === "redundant") {
        publish({ error: "新版安装未完成，请检查网络后重试更新。" });
      }
    });
  };
  listen(navigator.serviceWorker, "controllerchange", () => {
    // First install is not an update. Other tabs can activate an update: this
    // tab still needs an explicit save + reload, never an unsolicited reload.
    if (initialController && navigator.serviceWorker.controller !== initialController) {
      controllerChanged = true;
    }
    initialController = navigator.serviceWorker.controller;
    reconcile();
  });

  const ensureRegistration = async () => {
    if (registration) return registration;
    const result = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
    if (disposed) throw new Error("更新检查已取消");
    registration = result;
    listen(result, "updatefound", watchInstaller);
    watchInstaller();
    reconcile();
    return result;
  };

  const waitFor = (worker: ServiceWorker, done: () => boolean): Promise<void> => new Promise((resolve, reject) => {
    let settled = false;
    const cancel = () => finish(new Error("更新检查已取消"));
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanups.delete(cancel);
      worker.removeEventListener("statechange", changed);
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      if (error) reject(error); else resolve();
    };
    const changed = () => {
      if (done()) finish();
      else if (worker.state === "redundant") finish(new Error("新版安装失败，请检查网络后重试。"));
    };
    const timer = setTimeout(() => finish(new Error("更新等待超时，请检查网络后重试；本地数据未清除。")), UPDATE_TIMEOUT);
    worker.addEventListener("statechange", changed);
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    cleanups.add(cancel);
    changed();
  });

  const check = (force = false): Promise<void> => {
    if (checking) return checking;
    if (disposed || (!force && (document.visibilityState !== "visible" || Date.now() - lastCheck < 30_000))) return Promise.resolve();
    if (!navigator.onLine) {
      if (force) publish({ error: "当前离线，联网后再检查更新。" });
      return Promise.resolve();
    }
    lastCheck = Date.now();
    publish({ checking: true, error: null });
    checking = (async () => {
      try {
        const current = await withTimeout(ensureRegistration(), UPDATE_TIMEOUT, "注册更新服务");
        if (!current.installing && !current.waiting) await withTimeout(current.update(), UPDATE_TIMEOUT, "获取新版");
        watchInstaller();
        const worker = current.installing;
        if (worker) {
          trackedInstaller = worker;
          try {
            await waitFor(worker, () => worker.state === "installed" || worker.state === "activated");
          } finally {
            if (trackedInstaller === worker) trackedInstaller = null;
          }
        }
        reconcile();
        publish({ checked: true });
      } catch (error) {
        publish({ error: `检查更新失败：${error instanceof Error ? error.message : String(error)}` });
      } finally {
        checking = undefined;
        trackedInstaller = null;
        publish({ checking: false });
      }
    })();
    return checking;
  };

  listen(document, "visibilitychange", () => { void check(); });
  listen(window, "focus", () => { void check(); });
  listen(window, "pageshow", () => { void check(); });
  listen(window, "online", () => { void check(true); });
  const interval = setInterval(() => { void check(); }, CHECK_INTERVAL);
  void check(true);

  return {
    check: () => check(true),
    /** Caller must flush edits and prevent new edits until this completes. */
    async apply() {
      if (!controllerChanged && !registration?.waiting) await check(true);
      if (disposed) throw new Error("更新已取消");
      if (controllerChanged) { window.location.reload(); return; }
      const worker = registration?.waiting;
      if (!worker) throw new Error(status.error || "新版尚未准备好，请稍后重新检查更新。");
      trackedInstaller = worker;
      const clearTracking = () => {
        if (trackedInstaller === worker) trackedInstaller = null;
      };
      const activated = waitFor(worker, () => navigator.serviceWorker.controller === worker);
      worker.postMessage({ type: "SKIP_WAITING" });
      await activated.finally(clearTracking);
      window.location.reload();
    },
    dispose() {
      disposed = true;
      clearInterval(interval);
      cleanups.forEach((cleanup) => cleanup());
      cleanups.clear();
    },
  };
}

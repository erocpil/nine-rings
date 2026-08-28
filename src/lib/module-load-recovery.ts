const MODULE_LOAD_ERROR = /(?:importing a module script failed|failed to fetch dynamically imported module|error loading dynamically imported module|load failed for module)/i;

export function isModuleLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return MODULE_LOAD_ERROR.test(`${error.name}: ${error.message}\n${error.stack ?? ""}`);
}

async function clearCachedNavigationShells(): Promise<void> {
  if (!("caches" in globalThis)) return;
  const urls = [
    window.location.href,
    new URL(window.location.pathname, window.location.origin).href,
    new URL("/", window.location.origin).href,
    new URL("/index.html", window.location.origin).href,
  ];
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith("nine-rings-")).map(async (key) => {
    const cache = await caches.open(key);
    await Promise.all(urls.map((url) => cache.delete(url)));
  }));
}

async function activateWaitingServiceWorker(registration: ServiceWorkerRegistration): Promise<void> {
  if (!registration.waiting || !("serviceWorker" in navigator)) return;
  const changed = new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, 2000);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
  registration.waiting.postMessage({ type: "SKIP_WAITING" });
  await changed;
}

/** Recover an installed PWA whose cached HTML references a missing hashed module. */
export async function recoverModuleLoad(): Promise<void> {
  if (navigator.onLine === false) throw new Error("当前处于离线状态，请恢复网络后再试");
  try { await clearCachedNavigationShells(); } catch { /* Continue with SW update and a network reload. */ }
  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        try { await registration.update(); } catch { /* The uncached reload below can still recover. */ }
        try { await activateWaitingServiceWorker(registration); } catch { /* Reload can still recover without activation. */ }
      }
    } catch { /* Reload without service-worker coordination. */ }
  }
  window.location.reload();
}

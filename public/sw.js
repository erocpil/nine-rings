/**
 * Nine Rings Service Worker — PWA 离线缓存
 *
 * 策略：
 * - 静态资源（JS/CSS/图标）：Cache First + 预缓存
 * - HTML 入口：Network First（确保拿到最新版本）
 * - IndexedDB 数据：由应用层自行管理，SW 不介入
 */

const CACHE_NAME = "nine-rings-v1";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon-192.svg",
  "/icon-512.svg",
];

// ── Install: 预缓存核心静态资源 ──
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  // 立即激活，不等待旧 SW
  self.skipWaiting();
});

// ── Activate: 清理旧缓存 ──
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    })
  );
  // 立即接管所有页面
  self.clients.claim();
});

// ── Fetch: 缓存策略 ──
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 跳过 chrome-extension 和非 HTTP(S)
  if (!url.protocol.startsWith("http")) return;

  // IndexedDB 相关的内部请求不缓存
  if (url.pathname === "/__import") return;

  // HTML: Network First
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(networkFirst(request));
    return;
  }

  // 静态资源（JS/CSS/字体/图片）: Cache First
  if (
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "font" ||
    request.destination === "image" ||
    url.pathname.match(/\.(js|css|woff2?|svg|png|jpg|ico)$/)
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 其他: Network First 兜底
  event.respondWith(networkFirst(request));
});

// ── 策略函数 ──

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // 离线且无缓存 — 返回空响应
    return new Response("", { status: 408 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response("", { status: 408 });
  }
}

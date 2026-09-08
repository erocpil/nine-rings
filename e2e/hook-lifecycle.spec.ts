import { expect, test } from "@playwright/test";
import type { AutoSaveChanges, AutoSaveHandle } from "../src/hooks/useAutoSave";

test("自动保存回调跨渲染稳定且定时保存调用最新处理器", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const React: typeof import("react") = (await load("/node_modules/.vite/deps/react.js")).default;
    const { createRoot }: typeof import("react-dom/client") = (await load("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { flushSync }: typeof import("react-dom") = (await load("/node_modules/.vite/deps/react-dom.js")).default;
    const { useAutoSave }: typeof import("../src/hooks/useAutoSave") = await load("/src/hooks/useAutoSave.ts");
    let handle!: AutoSaveHandle;
    const writes: { revision: number; id: string; changes: AutoSaveChanges }[] = [];
    let finish!: () => void;
    const saved = new Promise<void>((resolve) => { finish = resolve; });
    function Harness({ revision }: { revision: number }) {
      handle = useAutoSave({ debounceMs: 100, onSave: async (id, changes) => {
        writes.push({ revision, id, changes }); finish();
      } });
      return null;
    }
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const render = (revision: number) => flushSync(() => root.render(React.createElement(React.StrictMode, null, React.createElement(Harness, { revision }))));
    render(1);
    await handle.setNoteId("first");
    const original = handle;
    handle.markTitleDirty("new title");
    render(2);
    const methods = ["flush", "setNoteId", "markDirty", "markContentDirty", "markTitleDirty", "markTagsDirty", "getPendingData", "discardPending"] as const;
    const stable = methods.every((name) => handle[name] === original[name]);
    await saved;
    await handle.flush();
    const pending = handle.getPendingData();
    root.unmount(); host.remove();
    return { stable, writes, pending };
  });
  expect(result.stable).toBe(true);
  expect(result.writes).toEqual([{ revision: 2, id: "first", changes: { title: "new title" } }]);
  expect(result.pending).toBeNull();
});

test("StrictMode 连接检查更换 Token 后重新请求并丢弃旧响应", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 850 });
  let releaseOld!: () => void;
  const blocked = new Promise<void>((resolve) => { releaseOld = resolve; });
  let oldRequests = 0;
  let newRequests = 0;
  let failConnection = false;
  await page.route("https://api.github.com/**", async (route) => {
    const token = route.request().headers().authorization;
    if (token === "Bearer old-test-token") {
      oldRequests++;
      await blocked;
      await route.fulfill({ status: 401, body: "" });
      return;
    }
    newRequests++;
    if (failConnection) { await route.fulfill({ status: 401, body: "" }); return; }
    if (route.request().url().includes("/contents/")) await route.fulfill({ status: 404, body: "" });
    else await route.fulfill({ status: 200, json: { permissions: { push: true } } });
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const React: typeof import("react") = (await load("/node_modules/.vite/deps/react.js")).default;
    const { createRoot }: typeof import("react-dom/client") = (await load("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { flushSync }: typeof import("react-dom") = (await load("/node_modules/.vite/deps/react-dom.js")).default;
    const { saveSyncConfig, loadSyncConfig } = await load("/src/lib/sync/github.ts");
    saveSyncConfig({ ...loadSyncConfig(), token: "old-test-token", owner: "test-owner", repo: "test-repo" });
    const SettingsSync = (await load("/src/components/SettingsSync.tsx")).default;
    const host = document.createElement("div");
    host.dataset.testid = "connection-harness";
    Object.assign(host.style, { position: "fixed", inset: "0", zIndex: "99999", overflow: "auto", background: "white" });
    document.body.append(host);
    const root = createRoot(host);
    flushSync(() => root.render(React.createElement(React.StrictMode, null, React.createElement(SettingsSync))));
  });
  try {
    await expect.poll(() => oldRequests).toBe(1);
    const harness = page.getByTestId("connection-harness");
    await harness.getByPlaceholder("ghp_...").fill("new-test-token");
    await expect(harness.locator(".sync-status")).toContainText("仓库连接正常，远端暂无备份");
    expect(newRequests).toBe(2);
    const oldResponse = page.waitForResponse((response) => response.request().headers().authorization === "Bearer old-test-token");
    releaseOld();
    // checkStatus resolves on 401 headers without consuming a response body.
    await oldResponse;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(harness.locator(".sync-status")).toContainText("仓库连接正常，远端暂无备份");
    await harness.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(harness.locator(".sync-feedback .sync-status")).toContainText("仓库连接正常");
    await expect(harness.locator(".sync-toast")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("sync-unified-status.png") });
    failConnection = true;
    await harness.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(harness.locator(".sync-feedback .sync-err")).toBeVisible();
    await expect(harness.locator(".sync-status")).toHaveCount(1);
    await expect(harness.locator(".sync-toast")).toHaveCount(0);
    await harness.getByRole("button", { name: "Push ↑", exact: true }).click();
    await expect(harness.locator(".sync-feedback").getByRole("alert")).toContainText("推送失败");
    await expect(harness.locator(".sync-status")).toHaveCount(0);
    await harness.getByPlaceholder("ghp_...").fill("");
    await expect(harness.locator(".sync-status")).toHaveCount(0);
  } finally { releaseOld(); }
});

test("虚拟目录实测行高变化后更新后续行的位置", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const React: typeof import("react") = (await load("/node_modules/.vite/deps/react.js")).default;
    const { createRoot }: typeof import("react-dom/client") = (await load("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { flushSync }: typeof import("react-dom") = (await load("/node_modules/.vite/deps/react-dom.js")).default;
    const { DocumentOutlineList } = await load("/src/components/DocumentOutlineList.tsx");
    const entries = Array.from({ length: 200 }, (_, index) => ({ index, folded: false, item: { pos: index * 10, level: 1, text: `章节 ${index}${index % 2 ? "：用于验证长标题滚动时的高度是否稳定。".repeat(4) : ""}` } }));
    const host = document.createElement("div"); host.dataset.testid = "outline-harness";
    Object.assign(host.style, { position: "fixed", width: "320px", height: "400px", top: "0", left: "0", zIndex: "99999" });
    document.body.append(host);
    const root = createRoot(host);
    flushSync(() => root.render(React.createElement(DocumentOutlineList, { entries, activeOutlineIndex: 0, outlineBaseLevel: 1, listRef: { current: null }, onJump() {}, onToggleFold() {} })));
  });
  const list = page.getByTestId("outline-harness");
  await expect(list.locator(".is-virtualized")).toHaveCount(1);
  const first = list.locator('[data-visible-index="0"]');
  const second = list.locator('[data-visible-index="1"]');
  await expect(first).toBeVisible();
  const before = await second.evaluate((element: HTMLElement) => parseFloat(element.style.top));
  await first.evaluate((element: HTMLElement) => { element.style.height = "78px"; element.style.minHeight = "78px"; });
  await expect.poll(() => second.evaluate((element: HTMLElement) => parseFloat(element.style.top))).toBe(78);
  expect(before).toBeLessThan(78);
  await first.evaluate((element: HTMLElement) => { element.style.height = "26px"; element.style.minHeight = "26px"; });
  await expect.poll(() => second.evaluate((element: HTMLElement) => parseFloat(element.style.top))).toBe(26);
  const scroller = list.locator(".document-outline-list");
  await scroller.evaluate((el: HTMLElement) => { el.style.height = "320px"; });
  for (const fraction of [0.8, 0.4, 0.9, 0.2]) {
    const drift = await scroller.evaluate(async (el, ratio) => {
      const beforeHeight = el.scrollHeight;
      el.scrollTop = (el.scrollHeight - el.clientHeight) * ratio;
      const beforeTop = el.scrollTop;
      el.dispatchEvent(new Event("scroll"));
      for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
      return { top: Math.abs(el.scrollTop - beforeTop), height: Math.abs(el.scrollHeight - beforeHeight) };
    }, fraction);
    expect(drift.top).toBeLessThanOrEqual(1);
    expect(drift.height).toBeLessThanOrEqual(1);
  }
});
